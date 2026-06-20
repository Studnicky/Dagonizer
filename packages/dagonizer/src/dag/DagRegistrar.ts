import type { ChildStateFactoryType } from '../contracts/ChildStateFactoryType.js';
import type { DagContainerInterface } from '../contracts/DagContainerInterface.js';
import type { DispatcherBundleType } from '../contracts/DispatcherBundle.js';
import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { DAGType } from '../entities/dag/DAG.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import { DAGError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { ChildStateFactory } from '../runtime/ChildStateFactory.js';
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
 * that gate it (schema, semantic, container-role binding);
 * `Dagonizer` stays the composition root whose public `registerDAG` /
 * `registerNode` / `registerBundle` methods delegate here.
 */
export interface DagRegistrarSourceInterface<TServices> {
  /** Registered DAGs keyed by name. Mutated by `registerDAG`. */
  readonly dags: Map<string, DAGType>;
  /** Registered nodes keyed by name. Mutated by `registerNode`. Base-typed so heterogeneous child-node states store without casts. */
  readonly nodes: Map<string, NodeInterface<NodeStateInterface, string, TServices>>;
  /** Placement index keyed by `${dagName}:${placementName}`. Mutated by `registerDAG`. */
  readonly nodeIndex: Map<string, DAGNodeType>;
  /**
   * Child-state factories keyed by DAG name. Mutated by `registerDAG`.
   * Every registered DAG has an entry here; `ChildStateFactory.cloneParent` is
   * stored when no override is supplied so the engine never branches on presence.
   */
  readonly stateFactories: Map<string, ChildStateFactoryType>;

  /** Resolve a bound container by role, or `null` when the role is unbound (in-process). */
  resolveContainer(role: string | undefined): DagContainerInterface | null;
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
 * `registerDAG` runs three gates in order before mutating the registries:
 * 1. Duplicate-name throw (same name, different implementation).
 * 2. Schema pass: `Validator.dag.validate(dag)` checks structure.
 * 3. Semantic pass: `DAGValidator.validateDAGConfig` verifies the entrypoint
 *    exists, node references resolve, and output routing covers every output.
 * 4. Container-role binding: a dispatcher that opts into containers must bind
 *    every role its placements declare.
 *
 * Every gate throws `DAGError` (or rethrows a thrown `Error`) before any
 * registry mutation; a rejected DAG leaves no partial registration behind.
 *
 * Every gate throws `DAGError` (or rethrows a thrown `Error`) before any
 * registry mutation, so a rejected DAG leaves no partial registration behind.
 */
export class DagRegistrar<TServices> {
  readonly #source: DagRegistrarSourceInterface<TServices>;

  constructor(source: DagRegistrarSourceInterface<TServices>) {
    this.#source = source;
  }

  /**
   * Register a DAG configuration with an optional child-state factory.
   *
   * `stateFactory` is the factory the engine calls to produce a fresh child
   * state whenever this DAG runs as an embedded or scatter body. When omitted,
   * `ChildStateFactory.cloneParent` (clone-parent) is used — reproducing the
   * historical semantics exactly. The factory is stored immediately so the
   * engine never checks for its presence; every registered DAG has an entry.
   *
   * Throws `DAGError` immediately when a DAG with the same name is already
   * registered with a different implementation.
   *
   * Runs the schema, semantic, and container-role-binding passes before
   * mutating the registries.
   */
  registerDAG(dag: DAGType, stateFactory: ChildStateFactoryType = ChildStateFactory.cloneParent): void {
    if (this.#source.dags.has(dag.name)) {
      if (this.#source.dags.get(dag.name) === dag) return;
      throw new DAGError(`DAG '${dag.name}' is already registered with a different implementation`);
    }

    // Schema pre-pass: catches malformed JSON (missing fields, wrong
    // node `type`, gather strategy mismatch) before semantic validation
    // surfaces node/DAG cross-references.
    Validator.dag.validate(dag);

    DAGValidator.validateDAGConfig(dag, this.#source.nodes, this.#source.dags);

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
    this.#source.stateFactories.set(dag.name, stateFactory);
    for (const node of dag.nodes) {
      // DAGNodeType = DAG['nodes'][number] — node already satisfies the type.
      this.#source.nodeIndex.set(`${dag.name}:${node.name}`, node);
    }
  }

  /**
   * Register a node. Accepts nodes typed against any `TNodeState extends
   * NodeStateInterface` — including child-state classes that differ from the
   * dispatcher's state type. The node's services type is the dispatcher's
   * `TServices`; services-agnostic nodes (e.g. `ToolInvokeNode<TServices>`) are
   * constructed typed to the dispatcher's `TServices` at bundle time, so they
   * register against the `NodeInterface<NodeStateInterface, string, TServices>`
   * map without a cast (`NodeInterface.execute` is a bivariant method, so the
   * narrower `TNodeState` is structurally assignable).
   *
   * Throws `DAGError` when a node with the same name is already registered.
   */
  registerNode<TNodeState extends NodeStateInterface, TOutput extends string>(
    node: NodeInterface<TNodeState, TOutput, TServices>,
  ): void {
    if (this.#source.nodes.has(node.name)) {
      // Identity check: runtime reference equality is sufficient; no cast needed
      // since Object.is accepts any two values. Both sides are the same object.
      if (Object.is(this.#source.nodes.get(node.name), node)) return;
      throw new DAGError(`Node '${node.name}' is already registered with a different implementation`);
    }
    if (node.validate) {
      const result = node.validate();

      if (!result.valid) {
        throw new DAGError(`Invalid node ${node.name}: ${result.errors.join(', ')}`);
      }
    }
    this.#source.nodes.set(node.name, node);
  }

  /**
   * Register every node, then every DAG, in the supplied bundle. Accepts
   * bundles typed against any `TBundleState extends NodeStateInterface` so
   * child-state bundles (e.g. tool bundles) can be registered on a dispatcher
   * typed for the parent state without casts at the call site.
   *
   * Order is fixed: nodes first so the semantic-pass DAG validator can
   * resolve every node reference. Throws as soon as any individual
   * registration throws (validation failure, duplicate name, etc.);
   * registrations that ran before the failing one remain installed.
   *
   * When `bundle.stateFactories` is present, each DAG's entry is passed to
   * `registerDAG`. A DAG with no entry in the map receives
   * `ChildStateFactory.cloneParent` (clone-parent).
   */
  registerBundle<TBundleState extends NodeStateInterface>(bundle: DispatcherBundleType<TBundleState, TServices>): void {
    for (const node of bundle.nodes) {
      this.registerNode(node);
    }
    for (const dag of bundle.dags) {
      const factory = bundle.stateFactories?.[dag.name];
      this.registerDAG(dag, factory);
    }
  }
}
