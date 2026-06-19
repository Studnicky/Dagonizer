import type { DagContainerInterface } from '../contracts/DagContainerInterface.js';
import type { DispatcherBundleType } from '../contracts/DispatcherBundle.js';
import type { NodeInterface } from '../contracts/NodeInterface.js';
import { ContractRegistryValidator } from '../derive/ContractRegistryValidator.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import { DAGError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { DAGValidator } from '../validation/DAGValidator.js';
import { Validator } from '../validation/Validator.js';

/**
 * Narrow registry surface the `DagRegistrar` mutates and queries. `Dagonizer`
 * provides a thin source object backed by its public registries (`dags`,
 * `nodes`, `nodeIndex`) plus the container-binding seams (`resolveContainer`,
 * `hasContainers`) so the registrar depends only on these ports — never on the
 * whole dispatcher.
 *
 * The registrar owns DAG/node/bundle registration and the validation passes
 * that gate it (schema, semantic, contract, container-role binding);
 * `Dagonizer` stays the composition root whose public `registerDAG` /
 * `registerNode` / `registerBundle` methods delegate here.
 */
export interface DagRegistrarSourceInterface<TState extends NodeStateInterface, TServices> {
  /** Registered DAGs keyed by name. Mutated by `registerDAG`. */
  readonly dags: Map<string, DAGType>;
  /** Registered nodes keyed by name. Mutated by `registerNode`. */
  readonly nodes: Map<string, NodeInterface<TState, string, TServices>>;
  /** Placement index keyed by `${dagName}:${placementName}`. Mutated by `registerDAG`. */
  readonly nodeIndex: Map<string, DAGNodeType>;

  /** Resolve a bound container by role, or `null` when the role is unbound (in-process). */
  resolveContainer(role: string | undefined): DagContainerInterface<TState> | null;
  /**
   * True when the dispatcher has opted into container dispatch by binding at
   * least one container role. When false, container-role binding is not enforced
   * at registration and every declared role is inert.
   */
  hasContainers(): boolean;
}

/**
 * DAG/node/bundle registration and the validation passes that gate it.
 *
 * Extracts the registration cluster from `Dagonizer` into a single-responsibility
 * module. Depends only on the narrow `DagRegistrarSourceInterface`; the source's
 * registries are the dispatcher's own `dags` / `nodes` / `nodeIndex` maps, so
 * registration mutates the live registries the engine modules read.
 *
 * `registerDAG` runs four gates in order before mutating the registries:
 * 1. Duplicate-name throw (same name, different implementation).
 * 2. Schema pass: `Validator.dag.validate(dag)` checks structure.
 * 3. Semantic pass: `DAGValidator.validateDAGConfig` verifies the entrypoint
 *    exists, node references resolve, and output routing covers every output.
 * 4. Contract pass: `ContractRegistryValidator.validate` runs dangling-read /
 *    dead-write checks across every contract-bearing placement.
 * 5. Container-role binding: a dispatcher that opts into containers must bind
 *    every role its placements declare.
 *
 * Every gate throws `DAGError` (or rethrows a thrown `Error`) before any
 * registry mutation, so a rejected DAG leaves no partial registration behind.
 */
export class DagRegistrar<TState extends NodeStateInterface, TServices> {
  readonly #source: DagRegistrarSourceInterface<TState, TServices>;

  constructor(source: DagRegistrarSourceInterface<TState, TServices>) {
    this.#source = source;
  }

  /**
   * Register a DAG configuration.
   *
   * Throws `DAGError` immediately when a DAG with the same name is already
   * registered with a different implementation.
   *
   * Runs the schema, semantic, contract, and container-role-binding passes
   * before mutating the registries.
   */
  registerDAG(dag: DAGType): void {
    if (this.#source.dags.has(dag.name)) {
      if (this.#source.dags.get(dag.name) === dag) return;
      throw new DAGError(`DAG '${dag.name}' is already registered with a different implementation`);
    }

    // Schema pre-pass: catches malformed JSON (missing fields, wrong
    // node `type`, gather strategy mismatch) before semantic validation
    // surfaces node/DAG cross-references.
    Validator.dag.validate(dag);

    DAGValidator.validateDAGConfig(dag, this.#source.nodes, this.#source.dags);

    // Contract validation: for each placement whose backing operation node
    // carries a co-located `contract`, run dangling-read / dead-write checks.
    // Both dangling reads and dead writes throw DAGError.
    //
    // A `SingleNode` is keyed by its `node` field. An `EmbeddedDAGNode` or
    // `ScatterNode` runs an operation registered under the placement's own
    // name (the deriver names the placement after the operation), so its
    // contract — and therefore its `produces` — is resolved by placement name.
    // Without this, an operation rendered as an embedded/scatter placement
    // would be dropped from the contract graph and a downstream node reading
    // its output would be flagged as a dangling read.
    // Contract validation: only nodes with non-empty contracts participate.
    // `node.contract` is required on `NodeInterface`; nodes without derivation
    // carry `EMPTY_CONTRACT_FRAGMENT` (both arrays empty). Filter those out so
    // the validator only walks nodes that actually declare data-flow edges.
    const contractBearingNodes = dag.nodes
      .map((placement) => {
        if (Placement.isSingle(placement)) return this.#source.nodes.get(placement.node);
        if (Placement.isEmbeddedDAG(placement) || Placement.isScatter(placement)) return this.#source.nodes.get(placement.name);
        return undefined;
      })
      .filter((node): node is NodeInterface<TState, string, TServices> =>
        node !== undefined &&
        (node.contract.hardRequired.length > 0 || node.contract.produces.length > 0),
      );

    if (contractBearingNodes.length > 0) {
      const contracts = contractBearingNodes.map((node: NodeInterface<TState, string, TServices>) => ({
        'name': node.name,
        'outputs': [...node.outputs],
        'hardRequired': node.contract.hardRequired,
        'produces': node.contract.produces,
      }));
      try {
        ContractRegistryValidator.validate(
          contracts,
          { 'entrypointName': dag.entrypoint },
        );
      } catch (err) {
        throw err instanceof Error ? err : new DAGError(String(err));
      }
    }

    // Container-role binding check (D2 = throw). A dispatcher that opts into
    // container dispatch (a non-empty `containers` registry) must bind every
    // role its placements declare; a declared-but-unbound role is a fatal
    // misalignment, not a silent in-process fallback. A pure in-process
    // dispatcher (empty `containers`) runs every body in-process by design and
    // treats declared roles as inert — this is the path the in-isolate `DagHost`
    // relies on when it recurses into container-declaring bodies it executes
    // directly. Checked before mutating registries so a rejected DAG leaves no
    // partial registration behind.
    if (this.#source.hasContainers()) {
      for (const placement of dag.nodes) {
        const containerRole = 'container' in placement ? placement.container : undefined;
        if (containerRole !== undefined && this.#source.resolveContainer(containerRole) === null) {
          throw new DAGError(
            `DAG '${dag.name}' placement '${placement.name}' declares container role '${containerRole}' which is not bound in this dispatcher's containers`,
          );
        }
      }
    }

    this.#source.dags.set(dag.name, dag);
    for (const node of dag.nodes) {
      // DAGNodeType = DAG['nodes'][number] — node already satisfies the type.
      this.#source.nodeIndex.set(`${dag.name}:${node.name}`, node);
    }
  }

  /**
   * Register a node. Accepts narrowly-typed nodes
   * (`NodeInterface<TState, 'success' | 'error', TServices>`) and stores
   * them widened to `NodeInterface<TState, string, TServices>`; narrow
   * wide is sound covariantly on both `outputs` and the result `output`.
   *
   * Throws `DAGError` when a node with the same name is already registered.
   */
  registerNode<TOutput extends string>(
    node: NodeInterface<TState, TOutput, TServices>,
  ): void {
    if (this.#source.nodes.has(node.name)) {
      if (this.#source.nodes.get(node.name) === (node as NodeInterface<TState, string, TServices>)) return;
      throw new DAGError(`Node '${node.name}' is already registered with a different implementation`);
    }
    if (node.validate) {
      const result = node.validate();

      if (!result.valid) {
        throw new DAGError(`Invalid node ${node.name}: ${result.errors.join(', ')}`);
      }
    }
    // Widening cast: TOutput extends string; the registry stores the widened
    // type so the engine can dispatch without knowing TOutput at lookup sites.
    this.#source.nodes.set(node.name, node as NodeInterface<TState, string, TServices>);
  }

  /**
   * Register every node, then every DAG, in the supplied bundle. Order
   * is fixed: nodes first so the semantic-pass DAG validator can
   * resolve every node reference. Throws as soon as any individual
   * registration throws (validation failure, duplicate name, etc.);
   * registrations that ran before the failing one remain installed.
   */
  registerBundle(bundle: DispatcherBundleType<TState, TServices>): void {
    for (const node of bundle.nodes) {
      this.registerNode(node);
    }
    for (const dag of bundle.dags) {
      this.registerDAG(dag);
    }
  }
}
