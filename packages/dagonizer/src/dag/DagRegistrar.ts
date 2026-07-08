import type { ChildStateFactoryType } from '../contracts/ChildStateFactoryType.js';
import type { DagContainerInterface } from '../contracts/DagContainerInterface.js';
import type { DispatcherBundleType } from '../contracts/DispatcherBundle.js';
import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { DAGType } from '../entities/dag/DAG.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import { DAGError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { ChildStateFactory } from '../runtime/ChildStateFactory.js';
import { DAGShape } from '../validation/DAGShape.js';
import { DAGValidator } from '../validation/DAGValidator.js';

import { ContextResolver } from './ContextResolver.js';

function validateNodeContract<TNodeState extends NodeStateInterface, TOutput extends string>(
  node: NodeInterface<TNodeState, TOutput>,
): void {
  if (node.validate) {
    const result = node.validate();

    if (!result.valid) {
      throw new DAGError(`Invalid node ${node.name}: ${result.errors.join(', ')}`);
    }
  }
  // Structural enforcement: every declared output port must have a schema entry.
  // This check is ALWAYS active (cheap, structural — independent of validateOutputs).
  for (const port of node.outputs) {
    if (!(port in node.outputSchema)) {
      throw new DAGError(
        `Node '${node.name}' declares output port '${String(port)}' but outputSchema has no entry for it`,
      );
    }
  }
}

/**
 * Narrow registry surface the `DagRegistrar` mutates and queries. `Dagonizer`
 * provides a thin source object backed by its public registries (`dags`,
 * `nodes`, `nodeIndex`) plus the container-binding seams (`resolveContainer`,
 * `hasContainers`) so the registrar depends only on these ports — never on the
 * whole dispatcher.
 *
 * The registrar owns DAG/node/bundle registration and the validation passes
 * that gate it (semantic, container-role binding);
 * `Dagonizer` stays the composition root whose public `registerDAG` /
 * `registerNode` / `registerBundle` methods delegate here.
 */
export interface DagRegistrarSourceInterface {
  /** Registered DAGs keyed by expanded IRI. Mutated by `registerDAG`. */
  readonly dags: Map<string, DAGType>;
  /** Registered nodes keyed by expanded IRI. Mutated by `registerNode`. Base-typed so heterogeneous child-node states store without casts. */
  readonly nodes: Map<string, NodeInterface<NodeStateInterface, string>>;
  /** Placement index keyed by `${dagIri}:${placementName}`. Mutated by `registerDAG`. */
  readonly nodeIndex: Map<string, DAGNodeType>;
  /**
   * Child-state factories keyed by expanded DAG IRI. Mutated by `registerDAG`.
   * Every registered DAG has an entry here; `ChildStateFactory.cloneParent` is
   * stored when no override is supplied so the engine never branches on presence.
   */
  readonly stateFactories: Map<string, ChildStateFactoryType>;
  /** Plugin module specifiers keyed by context prefix and namespace IRI. */
  readonly pluginSpecifiers: Map<string, string>;

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
 * `registerDAG` runs four gates in order before mutating the registries:
 * 1. Duplicate-IRI throw (same expanded IRI, different implementation).
 * 2. Shape pass: `DAGShape.validate(dag)` verifies the DAG-local topology.
 * 3. Registry pass: `DAGValidator.validateDAGConfig` verifies node/DAG
 *    references resolve and output routing covers every registered node output.
 * 4. Container-role binding: a dispatcher that opts into containers must bind
 *    every role its placements declare.
 *
 * Every gate throws `DAGError` (or rethrows a thrown `Error`) before any
 * registry mutation, so a rejected DAG leaves no partial registration behind.
 */
export class DagRegistrar {
  readonly #source: DagRegistrarSourceInterface;

  constructor(source: DagRegistrarSourceInterface) {
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
   * Throws `DAGError` immediately when a DAG with the same expanded IRI is
   * already registered with a different implementation.
   *
   * Runs the shape, registry-relative, and container-role-binding passes before
   * mutating the registries.
   */
  registerDAG(dag: DAGType, stateFactory: ChildStateFactoryType = ChildStateFactory.cloneParent): void {
    // Extract and validate the DAG's own @context prefix map.
    const dagContext = ContextResolver.contextOf(dag['@context']);
    ContextResolver.validate(dagContext);

    // Expand the DAG name to its IRI key for all registry operations.
    const dagIri = ContextResolver.expand(dag.name, dagContext);

    if (this.#source.dags.has(dagIri)) {
      if (this.#source.dags.get(dagIri) === dag) return;
      throw new DAGError(`DAG '${dag.name}' (IRI: '${dagIri}') is already registered with a different implementation`);
    }

    const stagedDags = new Map(this.#source.dags);
    stagedDags.set(dagIri, dag);
    this.#validateDAGAgainstRegistry(dag, dagContext, this.#source.nodes, stagedDags);
    DAGValidator.validateReferenceGraph(stagedDags);

    this.#source.dags.set(dagIri, dag);
    this.#source.stateFactories.set(dagIri, stateFactory);
    for (const node of dag.nodes) {
      // DAGNodeType = DAG['nodes'][number] — node already satisfies the type.
      // dagIri is the expanded IRI key; placement name stays as declared in the DAG.
      this.#source.nodeIndex.set(`${dagIri}:${node.name}`, node);
    }
  }

  hasDAG(iri: string): boolean {
    return this.#source.dags.has(iri);
  }

  hasNode(iri: string): boolean {
    return this.#source.nodes.has(iri);
  }

  listDAGs(): readonly DAGType[] {
    return [...this.#source.dags.values()];
  }

  listNodes(): readonly NodeInterface<NodeStateInterface, string>[] {
    return [...this.#source.nodes.values()];
  }

  dagIris(): readonly string[] {
    return [...this.#source.dags.keys()];
  }

  nodeIris(): readonly string[] {
    return [...this.#source.nodes.keys()];
  }

  pluginSpecifierForPrefix(prefix: string): string | undefined {
    return this.#source.pluginSpecifiers.get(prefix);
  }

  pluginPrefixSpecifiers(): ReadonlyMap<string, string> {
    return new Map(this.#source.pluginSpecifiers);
  }

  /**
   * Register a node. Accepts nodes typed against any `TNodeState extends
   * NodeStateInterface` — including child-state classes that differ from the
   * dispatcher's state type.
   *
   * Throws `DAGError` when a node with the same expanded IRI is already registered.
   */
  registerNode<TNodeState extends NodeStateInterface, TOutput extends string>(
    node: NodeInterface<TNodeState, TOutput>,
    context: Record<string, unknown> = {},
  ): void {
    const nodeIri = ContextResolver.expand(node.name, context);
    if (this.#source.nodes.has(nodeIri)) {
      // Identity check: runtime reference equality is sufficient; no cast needed
      // since Object.is accepts any two values. Both sides are the same object.
      if (Object.is(this.#source.nodes.get(nodeIri), node)) return;
      throw new DAGError(`Node '${node.name}' (IRI: '${nodeIri}') is already registered with a different implementation`);
    }
    validateNodeContract(node);
    this.#source.nodes.set(nodeIri, node);
  }

  /**
   * Register every node and DAG in the supplied bundle as one transaction. Accepts
   * bundles typed against any `TBundleState extends NodeStateInterface` so
   * child-state bundles (e.g. tool bundles) can be registered on a dispatcher
   * typed for the parent state without casts at the call site.
   *
   * Nodes and DAG documents are installed into the transaction's real registry
   * view before validation, so DAGs in the same bundle may reference each other.
   * If any validation step fails, every node, DAG, placement index,
   * state-factory, and plugin-specifier entry added by this transaction is
   * rolled back before the error is rethrown.
   *
   * When `bundle.stateFactories` is present, each DAG's entry is passed to
   * the transaction. A DAG with no entry in the map receives
   * `ChildStateFactory.cloneParent` (clone-parent).
   */
  registerBundle<TBundleState extends NodeStateInterface>(bundle: DispatcherBundleType<TBundleState>): void {
    const bundleContext = bundle.context ?? {};
    ContextResolver.validate(bundleContext);

    const transaction = new RegistryTransaction(this.#source);
    try {
      transaction.registerPluginSpecifiers(bundleContext, bundle.specifier);
      for (const node of bundle.nodes) {
        transaction.registerNode(node, bundleContext);
      }
      for (const dag of bundle.dags) {
        transaction.registerDAGDocument(dag, bundle.stateFactories);
      }
      for (const dag of bundle.dags) {
        const dagContext = ContextResolver.contextOf(dag['@context']);
        this.#validateDAGAgainstRegistry(dag, dagContext, transaction.nodes, transaction.dags);
      }
      DAGValidator.validateReferenceGraph(transaction.dags);
      transaction.commit();
    } catch (error) {
      transaction.rollback();
      throw error;
    }
  }

  #validateDAGAgainstRegistry<TState extends NodeStateInterface>(
    dag: DAGType,
    dagContext: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
  ): void {
    DAGShape.validate(dag);
    DAGValidator.validateDAGConfig(dag, dagContext, nodes, dags);

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
  }
}

class RegistryTransaction {
  readonly #source: DagRegistrarSourceInterface;
  readonly #addedDagIris: string[] = [];
  readonly #addedNodeIris: string[] = [];
  readonly #addedNodeIndexKeys: string[] = [];
  readonly #addedPluginSpecifierPrefixes: string[] = [];
  readonly #addedStateFactoryIris: string[] = [];

  constructor(source: DagRegistrarSourceInterface) {
    this.#source = source;
  }

  get dags(): Map<string, DAGType> {
    return this.#source.dags;
  }

  get nodes(): Map<string, NodeInterface<NodeStateInterface, string>> {
    return this.#source.nodes;
  }

  registerPluginSpecifiers(context: Record<string, unknown>, specifier: string | undefined): void {
    if (specifier === undefined) return;
    for (const [prefix, namespaceIri] of ContextResolver.prefixes(context)) {
      this.#registerPluginSpecifierKey(
        prefix,
        specifier,
        `Plugin prefix '${prefix}'`,
      );
      this.#registerPluginSpecifierKey(
        namespaceIri,
        specifier,
        `Plugin namespace '${namespaceIri}'`,
      );
    }
  }

  registerNode<TNodeState extends NodeStateInterface, TOutput extends string>(
    node: NodeInterface<TNodeState, TOutput>,
    context: Record<string, unknown>,
  ): void {
    const nodeIri = ContextResolver.expand(node.name, context);
    if (this.#source.nodes.has(nodeIri)) {
      if (Object.is(this.#source.nodes.get(nodeIri), node)) return;
      throw new DAGError(`Node '${node.name}' (IRI: '${nodeIri}') is already registered with a different implementation`);
    }
    validateNodeContract(node);
    this.#source.nodes.set(nodeIri, node);
    this.#addedNodeIris.push(nodeIri);
  }

  registerDAGDocument<TBundleState extends NodeStateInterface>(
    dag: DAGType,
    stateFactories: DispatcherBundleType<TBundleState>['stateFactories'] | undefined,
  ): void {
    const dagContext = ContextResolver.contextOf(dag['@context']);
    ContextResolver.validate(dagContext);
    const dagIri = ContextResolver.expand(dag.name, dagContext);

    if (this.#source.dags.has(dagIri)) {
      if (this.#source.dags.get(dagIri) === dag) return;
      throw new DAGError(`DAG '${dag.name}' (IRI: '${dagIri}') is already registered with a different implementation`);
    }

    this.#source.dags.set(dagIri, dag);
    this.#addedDagIris.push(dagIri);

    const factory = stateFactories?.[dagIri] ?? ChildStateFactory.cloneParent;
    this.#source.stateFactories.set(dagIri, factory);
    this.#addedStateFactoryIris.push(dagIri);

    for (const node of dag.nodes) {
      const indexKey = `${dagIri}:${node.name}`;
      this.#source.nodeIndex.set(indexKey, node);
      this.#addedNodeIndexKeys.push(indexKey);
    }
  }

  rollback(): void {
    for (const key of this.#addedNodeIndexKeys.reverse()) this.#source.nodeIndex.delete(key);
    for (const iri of this.#addedStateFactoryIris.reverse()) this.#source.stateFactories.delete(iri);
    for (const iri of this.#addedDagIris.reverse()) this.#source.dags.delete(iri);
    for (const iri of this.#addedNodeIris.reverse()) this.#source.nodes.delete(iri);
    for (const prefix of this.#addedPluginSpecifierPrefixes.reverse()) this.#source.pluginSpecifiers.delete(prefix);
    this.commit();
  }

  commit(): void {
    this.#addedDagIris.length = 0;
    this.#addedNodeIris.length = 0;
    this.#addedNodeIndexKeys.length = 0;
    this.#addedPluginSpecifierPrefixes.length = 0;
    this.#addedStateFactoryIris.length = 0;
  }

  #registerPluginSpecifierKey(key: string, specifier: string, label: string): void {
    const existing = this.#source.pluginSpecifiers.get(key);
    if (existing !== undefined && existing !== specifier) {
      throw new DAGError(
        `${label} is already registered to '${existing}' and cannot also resolve to '${specifier}'`,
        { 'code': 'PLUGIN_INVALID' },
      );
    }
    if (existing === specifier) return;
    this.#source.pluginSpecifiers.set(key, specifier);
    this.#addedPluginSpecifierPrefixes.push(key);
  }
}
