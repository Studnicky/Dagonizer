import type { DagContainerInterface } from './contracts/DagContainerInterface.js';
import type { DispatcherBundleType } from './contracts/DispatcherBundle.js';
import type { ExecuteOptionsType } from './contracts/ExecuteOptionsType.js';
import type { HandoffChannelInterface } from './contracts/HandoffChannelInterface.js';
import type { NodeInterface } from './contracts/NodeInterface.js';
import type { ObserverRelayInterface } from './contracts/ObserverRelayInterface.js';
import type { StateAccessorInterface } from './contracts/StateAccessorInterface.js';
import { ContractRegistryValidator } from './derive/ContractRegistryValidator.js';
import { Batch } from './entities/batch/Batch.js';
import type { DAGType } from './entities/dag/DAG.js';
import { Placement } from './entities/dag/Placement.js';
import type { DAGNodeType } from './entities/dag/Placement.js';
import type { ExecutionResultType } from './entities/execution/ExecutionResult.js';
import { NodeContextBuilder } from './entities/node/NodeContext.js';
import type { NodeContextType } from './entities/node/NodeContext.js';
import type { NodeResultType } from './entities/node/NodeResult.js';
import { DAGError, ExecutionError, NodeTimeoutError } from './errors/index.js';
import { BodyExecutor } from './execution/BodyExecutor.js';
import type { BodyRunPortInterface } from './execution/BodyExecutor.js';
import { EmbeddedDagExecutor } from './execution/EmbeddedDagExecutor.js';
import type { EmbeddedDagExecutorSourceType } from './execution/EmbeddedDagExecutor.js';
import { Gather } from './execution/Gather.js';
import type { GatherSourceInterface } from './execution/Gather.js';
import { LeafExecutor } from './execution/LeafExecutor.js';
import type { LeafExecutorSourceInterface } from './execution/LeafExecutor.js';
import { NodeScheduler } from './execution/NodeScheduler.js';
import type { NodeSchedulerSourceInterface } from './execution/NodeScheduler.js';
import { PlacementDispatch } from './execution/PlacementDispatch.js';
import type { RunNodeResultType, RunNodesBatchType, RunOptionsType, ScatterDispatchSourceInterface } from './execution/ScatterDispatch.js';
import { ScatterExecutor } from './execution/ScatterExecutor.js';
import { Execution } from './Execution.js';
import type { NodeStateInterface } from './NodeStateBase.js';
import { DispatcherHooks } from './observer/DispatcherHooks.js';
import type { DispatcherRelaySourceInterface } from './observer/DispatcherHooks.js';
import { ObserverRelay } from './observer/ObserverRelay.js';
import type { DispatcherHooksInterface } from './observer/ObserverRelay.js';
import { DottedPathAccessor } from './runtime/DottedPathAccessor.js';
import { Scheduler } from './runtime/Scheduler.js';
import { SignalComposer } from './runtime/SignalComposer.js';
import { StateMapper } from './runtime/StateMapper.js';
import { DAGValidator } from './validation/DAGValidator.js';
import { Validator } from './validation/Validator.js';

/** Default state accessor: installed when the dispatcher is constructed without one. */
const DEFAULT_STATE_ACCESSOR: StateAccessorInterface = new DottedPathAccessor();

/** Registry version used when the dispatcher is constructed without one. */
const DEFAULT_REGISTRY_VERSION = '0';

/**
 * Canonical defaults for `DagonizerOptionsType`.
 *
 * Every field that has a default is present here. The constructor resolves
 * all options in one spread: `{ ...DAGONIZER_OPTION_DEFAULTS, ...options }`.
 * `services` is intentionally absent — it has no meaningful default and
 * requires a type-unsafe cast at the assignment site regardless.
 */
const DAGONIZER_OPTION_DEFAULTS = {
  'accessor': DEFAULT_STATE_ACCESSOR as StateAccessorInterface,
  'containers': {} as Readonly<Record<string, never>>,
  'channels': {} as Readonly<Record<string, never>>,
  'registryVersion': DEFAULT_REGISTRY_VERSION,
} as const;

// Scatter progress types originate in entities/scatter/ScatterProgress.ts;
// re-exported here for public consumers.
export type { ScatterAckedResultType, ScatterInboxItemType, ScatterProgressType, StoredScatterProgressType } from './entities/scatter/ScatterProgress.js';

/**
 * Constructor options for `Dagonizer`.
 *
 * `TServices` is the consumer-defined services bag that the dispatcher
 * passes through every `NodeContextType`. Default `undefined` means
 * nodes receive `context.services === undefined`.
 */
export type DagonizerOptionsType<TState extends NodeStateInterface = NodeStateInterface, TServices = undefined> = {
  /**
   * Path resolver used for scatter source reads, gather writes, and
   * embedded-DAG state mapping. Defaults to a `DottedPathAccessor` that
   * walks `path.split('.')`.
   */
  accessor?: StateAccessorInterface;
  /**
   * Services bag exposed to every node via `context.services`. Construct
   * the dispatcher with `{ services: { logger, db, ... } }` and the same
   * reference flows into every `NodeInterface.execute(state, context)`
   * call.
   */
  services?: TServices;
  /**
   * Named container backends. Keys are logical role names declared on
   * `EmbeddedDAGNode.container` and `ScatterNode.container` (dag-body
   * only). A placement that declares a role not bound here throws a
   * `DAGError` at `registerDAG` time; a consumer wanting in-process
   * execution declares no container role.
   *
   * Containers are optional: an empty registry is the default and
   * means every placement runs in-process.
   */
  containers?: Record<string, DagContainerInterface<TState>>;
  /**
   * Named egress channels keyed by terminal placement name. When a
   * non-embedded run completes at a terminal whose name is bound here,
   * the dispatcher builds a `DAGHandoff` envelope and calls
   * `channel.publish(handoff)` after `onFlowEnd`.
   *
   * An unbound terminal (the default for all terminals) does not publish
   * and leaves the in-process path byte-identical to today. Different
   * terminals may route to different channels (`done` → queue,
   * `escalate` → DLQ).
   */
  channels?: Record<string, HandoffChannelInterface>;
  /**
   * Registry version string included in every `DAGHandoff` envelope.
   * Receivers use this for version-handshake validation. Defaults to
   * `DEFAULT_REGISTRY_VERSION` ('0') when not supplied.
   */
  registryVersion?: string;
}


// DAGNodeType and Placement are re-exported here so consumers who import from
// Dagonizer.ts find them alongside the dispatcher class.
export type { DAGNodeType } from './entities/dag/Placement.js';
export { Placement } from './entities/dag/Placement.js';

/**
 * Interface for Dagonizer. Both `execute()` and `resume()` return an
 * `Execution`, which is async-iterable (each stage as it completes) and
 * awaitable (the final summary).
 *
 * `TServices` flows through every node's `NodeContextType.services`
 * field; defaults to `undefined` when the dispatcher is constructed
 * without a services bag.
 */
export interface DagonizerInterface<
  TState extends NodeStateInterface,
  TServices = undefined,
> {
  /**
   * Clean up all registered nodes.
   */
  destroy(): Promise<void>;

  /**
   * Execute a DAG from its entrypoint.
   */
  execute(
    dagName: string,
    initialState: TState,
    options?: ExecuteOptionsType,
  ): Execution<TState>;

  /**
   * Look up a registered DAG by name.
   */
  getDAG(name: string): DAGType | undefined;

  /**
   * Look up a registered node by name.
   */
  getNode(name: string): NodeInterface<TState, string, TServices> | undefined;

  /**
   * List every registered DAG. Useful for visualization, contract checks,
   * and tooling that needs to walk the registry.
   */
  listDAGs(): readonly DAGType[];

  /**
   * List every registered node. Useful for visualization and tooling.
   */
  listNodes(): readonly NodeInterface<TState, string, TServices>[];

  /**
   * Resume a DAG from a given node name. The caller is responsible for
   * rehydrating `state` before the call (typically via `Checkpoint.load(raw).restoreState(fn)`).
   */
  resume(
    dagName: string,
    state: TState,
    fromStage: string,
    options?: ExecuteOptionsType,
  ): Execution<TState>;

  /**
   * Register a DAG configuration.
   */
  registerDAG(dag: DAGType): void;

  /**
   * Register a DAG node.
   */
  registerNode<TOutput extends string>(
    node: NodeInterface<TState, TOutput, TServices>,
  ): void;

  /**
   * Register every node, then every DAG, in the supplied bundle.
   */
  registerBundle(bundle: DispatcherBundleType<TState, TServices>): void;
}

/**
 * Graph-based DAG dispatcher for state-machine-style multi-step
 * node execution.
 *
 * Subclass to attach observability by overriding `onFlowStart`, `onFlowEnd`,
 * `onNodeStart`, `onNodeEnd`, `onError`, `onPhaseEnter`, `onPhaseExit`.
 * Default implementations are no-ops. These hooks are the ONE canonical
 * observability surface — they fire for both in-process nodes AND for
 * nodes running inside worker/contained sub-DAGs (via the internal relay).
 *
 * Cancellation: pass `{ signal }` (and/or `{ deadlineMs }`) to `execute()`.
 * The dispatcher composes them via `AbortSignal.any()` and marks state
 * `cancelled` / `timed_out` when the signal fires.
 *
 * @example
 * ```ts
 * class MyState extends NodeStateBase { value = 0; }
 *
 * class IncrementNode implements NodeInterface<MyState, 'done'> {
 *   readonly name = 'increment';
 *   readonly outputs = ['done'] as const;
 *   async execute(state: MyState) { state.value++; return { output: 'done' }; }
 * }
 *
 * const dispatcher = new Dagonizer<MyState>();
 * dispatcher.registerNode(new IncrementNode());
 * dispatcher.registerDAG({
 *   '@context': DAG_CONTEXT, '@id': 'urn:noocodex:dag:demo', '@type': 'DAG',
 *   name: 'demo', version: '1', entrypoint: 'increment',
 *   nodes: [
 *     { '@id': 'urn:noocodex:dag:demo/node/increment', '@type': 'SingleNode',
 *       name: 'increment', node: 'increment', outputs: { done: 'end' } },
 *     { '@id': 'urn:noocodex:dag:demo/node/end', '@type': 'TerminalNode',
 *       name: 'end', outcome: 'completed' },
 *   ],
 * });
 *
 * const result = await dispatcher.execute('demo', new MyState());
 * // result.state.value === 1
 * // result.cursor === null (completed via TerminalNode)
 * ```
 */
export class Dagonizer<TState extends NodeStateInterface, TServices = undefined>
implements
  DagonizerInterface<TState, TServices>,
  DispatcherRelaySourceInterface<TState>,
  GatherSourceInterface<TState, TServices>,
  LeafExecutorSourceInterface<TState, TServices>,
  EmbeddedDagExecutorSourceType<TState>,
  BodyRunPortInterface<TState, TServices>,
  ScatterDispatchSourceInterface<TState, TServices>,
  NodeSchedulerSourceInterface<TState, TServices> {
  // Read by NodeScheduler via NodeSchedulerSourceInterface.
  readonly dags = new Map<string, DAGType>();
  // Read by ScatterDispatchAdapter / NodeScheduler via their source interfaces.
  readonly nodes = new Map<string, NodeInterface<TState, string, TServices>>();
  // Read by NodeScheduler via NodeSchedulerSourceInterface.
  readonly nodeIndex = new Map<string, DAGNodeType>();
  // Read by ScatterDispatchAdapter via ScatterDispatchSourceInterface.
  readonly accessor: StateAccessorInterface;
  // Declared as TServices so NodeContextType<TServices>.services is
  // satisfied. When TServices = undefined (the default), the field is undefined.
  // The cast in the constructor is required because options.services is optional
  // (TServices | undefined); when the caller passes undefined for a non-undefined
  // TServices the error surfaces at the call site, not here.
  private readonly services: TServices;
  // Read by ScatterDispatchAdapter via ScatterDispatchSourceInterface.
  readonly stateMapper: StateMapper<TState>;
  private readonly containers: Readonly<Record<string, DagContainerInterface<TState>>>;
  // Read by NodeScheduler via NodeSchedulerSourceInterface (hand-off publish).
  readonly channels: Readonly<Record<string, HandoffChannelInterface>>;
  // Read by NodeScheduler via NodeSchedulerSourceInterface (hand-off envelope).
  readonly registryVersion: string;
  /**
   * Stable `DispatcherHooksInterface` adapter bound to this instance's protected
   * hooks. Created once in the constructor and reused by every `relayFor` call
   * so relay construction allocates only the `ObserverRelay` instance (stable
   * hidden class) without a fresh closure-bearing adapter on each invocation.
   */
  readonly #relayHooks: DispatcherHooksInterface<TState>;
  #correlationSeq = 0;

  /**
   * Shared body-run + transport-branch primitive. Built once per dispatcher
   * instance, bound to this instance via the narrow `BodyRunPortInterface`.
   * Both `EmbeddedDagExecutor` and the scatter per-item DAG-body path run their
   * sub-DAG body through it, so the in-process-vs-container branch and the
   * bufferIntermediates guard live in one place.
   */
  private readonly bodyExecutor: BodyExecutor<TState, TServices>;

  /** Gather execution composer and registered-node invoker for custom gather strategies. */
  private readonly gather: Gather<TState, TServices>;

  /** `SingleNode` placement executor. */
  private readonly leafExecutor: LeafExecutor<TState, TServices>;

  /** `EmbeddedDAGNode` placement executor. */
  private readonly embeddedDagExecutor: EmbeddedDagExecutor<TState, TServices>;

  /** `ScatterNode` placement executor. */
  private readonly scatterExecutor: ScatterExecutor<TState, TServices>;

  /**
   * Per-`@type` execution dispatch. Built once per dispatcher instance (not per
   * node call) so node execution is a single keyed branch with no per-call
   * closure/object allocation in the hot loop. The `PlacementDispatch` class
   * holds a stable shape; routing lives in its `dispatch` method.
   */
  private readonly placementDispatch: PlacementDispatch<TState>;

  /**
   * Work-set node-graph scheduler. Built once per dispatcher instance, bound to
   * this instance via the narrow `NodeSchedulerSourceInterface`. Owns the
   * streaming DAG traversal; `runNodes` delegates to `this.nodeScheduler.run`.
   */
  private readonly nodeScheduler: NodeScheduler<TState, TServices>;

  /**
   * Construct a dispatcher. Subclass and override the protected hooks
   * (`onFlowStart`, `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`)
   * for observability; no factory indirection, no callbacks.
   *
   * `options.accessor` swaps the path resolver used for scatter source
   * reads, gather writes, and embedded-DAG state mapping. Defaults to
   * `DottedPathAccessor`.
   *
   * `options.services` is the typed services bag exposed to every node
   * via `context.services`. Defaults to `undefined`.
   */
  constructor(options: DagonizerOptionsType<TState, TServices> = {}) {
    const resolved = Dagonizer.options<TState, TServices>(options);
    this.accessor = resolved.accessor;
    this.services = resolved.services;
    this.stateMapper = new StateMapper<TState>(this.accessor);
    this.containers = resolved.containers;
    this.channels = resolved.channels;
    this.registryVersion = resolved.registryVersion;
    // Build the relay hooks adapter and placement dispatcher once per instance,
    // bound to `this` here (within the class body, so protected hooks and
    // engine-internal executors are accessible). Each is a named class with a
    // stable hidden class, not an object-literal of arrow closures.
    this.#relayHooks = new DispatcherHooks<TState>(this);
    this.bodyExecutor = new BodyExecutor<TState, TServices>(this);
    this.gather = new Gather<TState, TServices>(this);
    this.leafExecutor = new LeafExecutor<TState, TServices>(this);
    this.embeddedDagExecutor = new EmbeddedDagExecutor<TState, TServices>(this, this.bodyExecutor);
    this.scatterExecutor = new ScatterExecutor<TState, TServices>(this, this.bodyExecutor, this.gather);
    this.placementDispatch = new PlacementDispatch<TState>(this.leafExecutor, this.embeddedDagExecutor, this.scatterExecutor);
    this.nodeScheduler = new NodeScheduler<TState, TServices>(this);
  }

  // ---------------------------------------------------------------------------
  // Observability hooks: protected, no-op defaults. Subclass + override.
  // ---------------------------------------------------------------------------

  protected onFlowStart(_dagName: string, _state: TState): void { /* override */ }
  protected onFlowEnd(_dagName: string, _state: TState, _result: ExecutionResultType<TState>): void { /* override */ }
  /**
   * Fires before a node begins executing. `placementPath` is the ordered
   * list of parent embedded-DAG placement names that led to this node.
   * Empty (`[]`) for top-level placements, `['on-topic-search']` for one
   * level of embedded-DAG nesting, and so on. Use it to disambiguate same-
   * named inner placements across multiple embedded-DAG instances. The
   * dispatcher always passes it; an override may take fewer arguments.
   *
   * This hook fires for BOTH in-process nodes AND for nodes running in
   * worker/contained sub-DAGs (via the internal observer relay).
   */
  protected onNodeStart(_nodeName: string, _state: TState, _placementPath: readonly string[]): void { /* override */ }
  /**
   * Fires after a node completes successfully. See {@link onNodeStart} for
   * `placementPath` semantics. Fires for in-process and worker nodes.
   */
  protected onNodeEnd(_nodeName: string, _output: string | null, _state: TState, _placementPath: readonly string[]): void { /* override */ }
  /**
   * Fires when the dispatcher catches an error from a node (or from the
   * abort/timeout machinery). See {@link onNodeStart} for `placementPath`
   * semantics. Fires for in-process and worker nodes.
   */
  protected onError(_nodeName: string, _error: Error, _state: TState, _placementPath: readonly string[]): void { /* override */ }
  /**
   * Fires before a `pre` or `post` phase placement runs. `placementPath`
   * follows the same semantics as `onNodeStart`. Fires for in-process and
   * worker phases.
   */
  protected onPhaseEnter(_dagName: string, _phase: 'pre' | 'post', _placementName: string, _state: TState, _placementPath: readonly string[]): void { /* override */ }
  /**
   * Fires after a `pre` or `post` phase placement completes (success or
   * collected error). See {@link onPhaseEnter}.
   */
  protected onPhaseExit(_dagName: string, _phase: 'pre' | 'post', _placementName: string, _state: TState, _placementPath: readonly string[]): void { /* override */ }

  // ---------------------------------------------------------------------------
  // Relay seam: public entries the container path (WorkerObserver/ChannelDispatch)
  // and the `DispatcherHooks` adapter drive so worker-side events surface through
  // the same protected observability hooks the in-process path fires. Each relay
  // entry forwards into the matching protected hook, the one place that
  // protected access is in scope. They satisfy `DispatcherRelaySourceInterface`.
  // ---------------------------------------------------------------------------

  /** Relay a flow-start event from the node scheduler into `onFlowStart`. */
  relayFlowStart(dagName: string, state: TState): void {
    this.onFlowStart(dagName, state);
  }

  /** Relay a flow-end event from the node scheduler into `onFlowEnd`. */
  relayFlowEnd(dagName: string, state: TState, result: ExecutionResultType<TState>): void {
    this.onFlowEnd(dagName, state, result);
  }

  /** Relay a node-start event from a worker/contained sub-DAG into `onNodeStart`. */
  relayNodeStart(nodeName: string, state: TState, placementPath: readonly string[]): void {
    this.onNodeStart(nodeName, state, placementPath);
  }

  /** Relay a node-end event from a worker/contained sub-DAG into `onNodeEnd`. */
  relayNodeEnd(nodeName: string, output: string | null, state: TState, placementPath: readonly string[]): void {
    this.onNodeEnd(nodeName, output, state, placementPath);
  }

  /** Relay an error event from a worker/contained sub-DAG into `onError`. */
  relayError(nodeName: string, error: Error, state: TState, placementPath: readonly string[]): void {
    this.onError(nodeName, error, state, placementPath);
  }

  /** Relay a phase-enter event from a worker/contained sub-DAG into `onPhaseEnter`. */
  relayPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState, placementPath: readonly string[]): void {
    this.onPhaseEnter(dagName, phase, placementName, state, placementPath);
  }

  /** Relay a phase-exit event from a worker/contained sub-DAG into `onPhaseExit`. */
  relayPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState, placementPath: readonly string[]): void {
    this.onPhaseExit(dagName, phase, placementName, state, placementPath);
  }

  // ---------------------------------------------------------------------------
  // Container support
  // ---------------------------------------------------------------------------

  /**
   * Resolve a logical container role to its bound `DagContainerInterface`, or
   * return `null` when the role is undefined or not bound (null = in-process path).
   */
  resolveContainer(role: string | undefined): DagContainerInterface<TState> | null {
    if (role === undefined) return null;
    const bound = this.containers[role];
    return bound !== undefined ? bound : null;
  }

  /**
   * True when this dispatcher has opted into container dispatch by binding at
   * least one container role. A dispatcher with no bound containers runs every
   * body in-process and never enforces role binding at registration.
   */
  #hasContainers(): boolean {
    return Object.keys(this.containers).length > 0;
  }

  /**
   * Generate a monotonic correlation id for container requests and hand-off
   * envelopes. Uses a private `#correlationSeq` counter. No randomness; no Date.now.
   */
  nextCorrelationId(dagName: string): string {
    return `${dagName}:${++this.#correlationSeq}`;
  }

  /**
   * Build an `ObserverRelayInterface` bound to this dispatcher instance's protected
   * hooks. The relay is passed to `container.runDag` so worker-side events
   * flow back to the parent's `onNodeStart/onNodeEnd/onError/onPhaseEnter/onPhaseExit`.
   *
   * `onFlowStart`/`onFlowEnd` are deliberately excluded from the relay:
   * those are top-level concerns owned by the parent's own `execute()` call.
   *
   * Returns an `ObserverRelay` instance (stable hidden class) rather than a
   * fresh anonymous object-literal, so V8 inline-caches stay monomorphic on the
   * container dispatch path. The stable `#relayHooks` adapter (a `DispatcherHooks`
   * bound to this dispatcher) supplies the protected-hook forwarding.
   */
  relayFor(state: TState): ObserverRelayInterface {
    return new ObserverRelay<TState>(this.#relayHooks, state);
  }

  /**
   * Build a node context for a sub-DAG body invocation. Forwards to
   * `NodeContextBuilder.of`, substituting a never-firing signal when the run
   * has none. Satisfies both `BodyRunPortInterface` (the embedded/scatter DAG
   * body run) and `ScatterDispatchSourceInterface` (the scatter node body),
   * where the dispatcher's `services` field is otherwise out of scope.
   */
  bodyContext(dagName: string, nodeName: string, signal: AbortSignal | null): NodeContextType<TServices> {
    return NodeContextBuilder.of(dagName, nodeName, signal ?? SignalComposer.never(), this.services);
  }

  /**
   * Build a node context for a placement execution. Substitutes a never-firing
   * signal when the run has none. Satisfies `GatherSourceInterface` and
   * `LeafExecutorSourceInterface` so `Gather` and `LeafExecutor` can build
   * contexts without importing `SignalComposer` directly.
   */
  nodeContext(dagName: string, placementName: string, signal: AbortSignal | null): NodeContextType<TServices> {
    return NodeContextBuilder.of(dagName, placementName, signal ?? SignalComposer.never(), this.services);
  }

  /**
   * Run a node over a single `state` as a size-1 batch. Satisfies
   * `GatherSourceInterface` and `LeafExecutorSourceInterface`, the canonical
   * size-1 node-run primitive the focused executor modules drive.
   *
   * Wraps `state` in `Batch.of(state)`, calls `node.execute(batch, context)`,
   * asserts the size-1 invariant (exactly one route with exactly one item), and
   * returns the single output port key.
   *
   * The node owns error-forwarding: `ScalarNode.execute` forwards per-item
   * errors to `item.state.collectError` during `execute`. Since `Batch.of`
   * wraps the same state reference, mutations are visible after this call.
   *
   * Throws `DAGError` if the returned `RoutedBatchType` does not contain exactly
   * one route with exactly one item (invariant violation for size-1 dispatch).
   */
  async runNodeOnState(
    node: NodeInterface<TState, string, TServices>,
    state: TState,
    context: NodeContextType<TServices>,
  ): Promise<string> {
    const batch = Batch.of(state);
    const routed = await node.execute(batch, context);
    if (routed.size !== 1) {
      throw new DAGError(
        `Node '${node.name}' returned ${routed.size} routes for a size-1 batch (expected exactly 1).`,
      );
    }
    const entry = routed.entries().next().value;
    if (entry === undefined) {
      throw new DAGError(`Node '${node.name}' returned an empty RoutedBatchType for a size-1 batch.`);
    }
    const [output, resultBatch] = entry;
    if (resultBatch.size !== 1) {
      throw new DAGError(
        `Node '${node.name}' route '${output}' contains ${resultBatch.size} items for a size-1 batch (expected exactly 1).`,
      );
    }
    return output;
  }

  /**
   * Run a sub-DAG body in-process through the canonical `runNodes` generator.
   * Satisfies `BodyRunPortInterface`; `BodyExecutor` drives this generator to
   * execute an embedded-DAG or scatter DAG body in-process. Forwards to the
   * private `runNodes`, defaulting the batch tail to `{}`.
   */
  runBodyNodes(
    dagName: string,
    state: TState,
    fromStage: string | null,
    options: ExecuteOptionsType,
    runOptions: RunOptionsType,
    placementPath: readonly string[],
    batch?: RunNodesBatchType<TState>,
  ): AsyncGenerator<NodeResultType<TState>, ExecutionResultType<TState>, void> {
    return this.runNodes(dagName, state, fromStage, options, runOptions, placementPath, batch ?? {});
  }

  /**
   * Run a scatter body sub-DAG through the canonical `runNodes` generator. Part
   * of `ScatterDispatchSourceInterface`; the scatter adapter drives this
   * generator to execute each item's DAG body in-process.
   */
  runScatterNodes(
    dagName: string,
    state: TState,
    fromStage: string | null,
    options: ExecuteOptionsType,
    runOptions: RunOptionsType,
    placementPath: readonly string[],
    batch?: RunNodesBatchType<TState>,
  ): AsyncGenerator<NodeResultType<TState>, ExecutionResultType<TState>, void> {
    return this.runNodes(dagName, state, fromStage, options, runOptions, placementPath, batch ?? {});
  }

  // ---------------------------------------------------------------------------

  async destroy(): Promise<void> {
    // Teardown order: nodes first (they may hold references into containers),
    // then bound containers (worker/child pools), then egress channels. Each
    // backend's `destroy()` is optional; guard the call. Safe to call more than
    // once — the registries are cleared at the end and re-destroying an
    // already-torn-down backend is the backend's own idempotency concern.
    for (const node of this.nodes.values()) {
      if (node.destroy) {
        await node.destroy();
      }
    }
    for (const container of Object.values(this.containers)) {
      if (container.destroy) {
        await container.destroy();
      }
    }
    for (const channel of Object.values(this.channels)) {
      if (channel.destroy) {
        await channel.destroy();
      }
    }
    this.nodes.clear();
    this.dags.clear();
    this.nodeIndex.clear();
  }

  /**
   * Look up a registered DAG by name. Returns `undefined` when the DAG has
   * not been registered.
   */
  getDAG(name: string): DAGType | undefined {
    return this.dags.get(name);
  }

  /**
   * Look up a registered node by name. Returns `undefined` when the node
   * has not been registered.
   */
  getNode(name: string): NodeInterface<TState, string, TServices> | undefined {
    return this.nodes.get(name);
  }

  /**
   * Snapshot of every registered DAG. The returned array is a fresh
   * shallow copy; mutating it does not affect the registry.
   */
  listDAGs(): readonly DAGType[] {
    return [...this.dags.values()];
  }

  /**
   * Snapshot of every registered node. The returned array is a fresh
   * shallow copy; mutating it does not affect the registry.
   */
  listNodes(): readonly NodeInterface<TState, string, TServices>[] {
    return [...this.nodes.values()];
  }

  /**
   * Execute a flow from its entrypoint.
   *
   * Returns an `Execution<TState>` that is both async-iterable (yields
   * each node as it completes) and awaitable (resolves to the final
   * `ExecutionResultType`). Sync-style is just
   * iteration that consumes every node before resolving.
   *
   * On abort (signal aborted, deadline expired, node threw, output
   * unwired) the iterator stops cleanly and the final result's `cursor`
   * carries the next node to run. State lifecycle records what happened.
   */
  execute(
    dagName: string,
    initialState: TState,
    options: ExecuteOptionsType = {},
  ): Execution<TState> {
    return new Execution<TState>(this.runNodes(dagName, initialState, null, options));
  }

  /**
   * Execute the same DAG over multiple item states, returning one
   * `Execution<TState>` per item. Each item runs independently so that
   * abort, lifecycle, and error isolation are per-item. This is the
   * container-side seam: `DagHost` calls it to run a received batch
   * without exposing the batch loop as public API.
   *
   * Each item produces an independent `Execution`; callers iterate them and
   * collect outcomes.
   */
  protected executeBatch(
    dagName: string,
    batchStates: readonly TState[],
    options: ExecuteOptionsType = {},
  ): readonly Execution<TState>[] {
    return batchStates.map((state) =>
      new Execution<TState>(this.runNodes(dagName, state, null, options)),
    );
  }

  /**
   * Resume a flow from `fromStage`. Same generator as `execute()` but
   * begins at the given cursor instead of the flow's entrypoint. Caller
   * is responsible for rehydrating `state` (typically via
   * `Checkpoint.load(raw).restoreState(fn)`) before calling.
   */
  resume(
    dagName: string,
    state: TState,
    fromStage: string,
    options: ExecuteOptionsType = {},
  ): Execution<TState> {
    return new Execution<TState>(this.runNodes(dagName, state, fromStage, options));
  }

  /**
   * Canonical generator. Yields each node result (including the intermediate
   * yields from parallel / scatter nodes) and returns the final
   * `ExecutionResultType` with `cursor` set. Never throws.
   *
   * Thin delegate to `this.nodeScheduler.run`. The scheduler owns the work-set
   * traversal cluster; `Dagonizer` stays the orchestration layer. `execute`,
   * `resume`, `executeBatch`, and the executor modules' `runBodyNodes` /
   * `runScatterNodes` seams all drive the run through this method.
   *
   * `runOptions.embedded` is a private implementation detail for recursive
   * embedded-DAG re-entry. When `true`, lifecycle transitions (`markRunning`,
   * `markCompleted`) and flow hooks (`onFlowStart`, `onFlowEnd`) are suppressed
   * (those are top-level concerns owned by the consumer's `execute()` /
   * `resume()` call). Node hooks (`onNodeStart`, `onNodeEnd`, `onError`) still
   * fire for every child node.
   */
  private runNodes(
    dagName: string,
    state: TState,
    fromStage: string | null,
    options: ExecuteOptionsType,
    runOptions: RunOptionsType = { 'embedded': false },
    placementPath: readonly string[] = [],
    batch: RunNodesBatchType<TState> = {},
  ): AsyncGenerator<NodeResultType<TState>, ExecutionResultType<TState>, void> {
    return this.nodeScheduler.run(dagName, state, fromStage, options, runOptions, placementPath, batch);
  }


  /**
   * Wrap a node execute call with a per-node timeout when `dagNode.timeout`
   * carries a budget. Derives a child `AbortController` from the run's signal,
   * arms a Scheduler timer, and races the node's execute against a deadline
   * rejection.
   *
   * The child signal is passed to the node so signal-aware IO (fetch, retry)
   * also cancels. Nodes that do not observe the signal are hard-stopped by the
   * race. On expiry `NodeTimeoutError` propagates; `executeSingleNode` re-throws
   * so the `runNodes` catch block fires `onError` and marks state failed.
   *
   * Timer and parent-abort listener are cleaned up in `finally`.
   */
  async withNodeTimeout<TResult>(
    dagNode: NodeInterface<TState, string, TServices>,
    parentSignal: AbortSignal | null,
    fn: (signal: AbortSignal) => Promise<TResult>,
  ): Promise<TResult> {
    const timeout = dagNode.timeout;
    const ms = timeout.ms;

    if (ms === null) {
      // No per-node budget; pass parent signal through unchanged.
      const sig = parentSignal ?? SignalComposer.never();
      return fn(sig);
    }

    const childCtrl = new AbortController();
    const onParentAbort = (): void => { childCtrl.abort(parentSignal?.reason); };

    if (parentSignal !== null) {
      if (parentSignal.aborted) {
        // Parent already aborted before node started.
        childCtrl.abort(parentSignal.reason);
      } else {
        parentSignal.addEventListener('abort', onParentAbort, { 'once': true });
      }
    }

    const timeoutError = new NodeTimeoutError(dagNode.name, ms);

    // Deadline race: resolves when time elapses (child not yet aborted),
    // rejects immediately if child is already aborted (parent propagation).
    // The Scheduler is swappable via VirtualScheduler in tests.
    // `!` asserts definite assignment: the Promise constructor synchronously
    // assigns `deadlineReject` before any await, so it is always set before use.
    let deadlineReject!: (reason: Error) => void;
    const deadlinePromise = new Promise<never>((_resolve, reject) => {
      deadlineReject = reject;
    });

    const schedulerPromise = Scheduler.current()
      .after(ms, { 'signal': childCtrl.signal })
      .then(() => {
        childCtrl.abort(timeoutError);
        deadlineReject(timeoutError);
      })
      .catch(() => { /* scheduler aborted early (cleanup or parent abort) */ });

    // Start the node execute. Attach a no-op catch so the rejected promise
    // does not surface as an unhandled rejection when the deadline race wins
    // and the finally block aborts the child signal (causing execute to reject
    // after Promise.race has already settled).
    const nodePromise = fn(childCtrl.signal);
    nodePromise.catch(() => { /* swallowed: deadline race already settled */ });

    try {
      // Race the node execute against the deadline rejection.
      return await Promise.race([nodePromise, deadlinePromise]);
    } finally {
      // Cancel the pending Scheduler entry (no-op if already resolved/aborted)
      // and detach the parent-abort listener.
      childCtrl.abort(new ExecutionError('node-timeout-cleanup'));
      if (parentSignal !== null) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
      await schedulerPromise;
    }
  }

  /**
   * Dispatch a composite (`ScatterNode` / `EmbeddedDAGNode`) placement for one
   * item through the per-`@type` `PlacementDispatch`. Satisfies
   * `NodeSchedulerSourceInterface`; the scheduler's per-item composite path
   * drives this for each item in a fired batch.
   */
  async executeDAGNode(
    entry: DAGNodeType,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
    placementPath: readonly string[],
    bufferIntermediates: boolean = true,
  ): Promise<RunNodeResultType<TState>> {
    return this.placementDispatch.dispatch(entry, state, dagName, signal, placementPath, bufferIntermediates);
  }


  /**
   * Register a DAG configuration.
   *
   * Throws `DAGError` immediately when a DAG with the same name is already registered.
   *
   * Runs two validation passes:
   * 1. Schema pass: `Validator.dag.validate(dag)` checks structure (required fields, valid
   *    `type` and `strategy` enumerations).
   * 2. Semantic pass: verifies entrypoint exists, all node references are resolvable,
   *    no circular embedded-DAG references, and every registered node output has a routing
   *    entry in the placement's `outputs` map.
   */
  registerDAG(dag: DAGType): void {
    if (this.dags.has(dag.name)) {
      if (this.dags.get(dag.name) === dag) return;
      throw new DAGError(`DAG '${dag.name}' is already registered with a different implementation`);
    }

    // Schema pre-pass: catches malformed JSON (missing fields, wrong
    // node `type`, gather strategy mismatch) before semantic validation
    // surfaces node/DAG cross-references.
    Validator.dag.validate(dag);

    DAGValidator.validateDAGConfig(dag, this.nodes, this.dags);

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
        if (Placement.isSingle(placement)) return this.nodes.get(placement.node);
        if (Placement.isEmbeddedDAG(placement) || Placement.isScatter(placement)) return this.nodes.get(placement.name);
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
    if (this.#hasContainers()) {
      for (const placement of dag.nodes) {
        const containerRole = 'container' in placement ? placement.container : undefined;
        if (containerRole !== undefined && this.resolveContainer(containerRole) === null) {
          throw new DAGError(
            `DAG '${dag.name}' placement '${placement.name}' declares container role '${containerRole}' which is not bound in this dispatcher's containers`,
          );
        }
      }
    }

    this.dags.set(dag.name, dag);
    for (const node of dag.nodes) {
      // DAGNodeType = DAG['nodes'][number] — node already satisfies the type.
      this.nodeIndex.set(`${dag.name}:${node.name}`, node);
    }
  }

  /**
   * Resolve a `DagonizerOptionsType` partial to a fully-populated
   * resolved options record. This is the single place where defaults are
   * applied; no code inside the constructor or engine internals ever sees
   * optional fields.
   *
   * `services` has no sensible default: when the caller does not supply it,
   * it resolves to `undefined` cast to `TServices`. This is sound when
   * `TServices = undefined` (the default type parameter). Callers that
   * specify a non-`undefined` `TServices` must provide `services`; if they
   * do not, the cast is unsound at their call site — the type system surfaces
   * the error there, not here.
   */
  static options<TState extends NodeStateInterface, TServices = undefined>(
    partial: DagonizerOptionsType<TState, TServices> = {},
  ): Readonly<{
    accessor: StateAccessorInterface;
    services: TServices;
    containers: Readonly<Record<string, DagContainerInterface<TState>>>;
    channels: Readonly<Record<string, HandoffChannelInterface>>;
    registryVersion: string;
  }> {
    return {
      'accessor':        partial.accessor ?? DEFAULT_STATE_ACCESSOR,
      'services':        partial.services as TServices,
      'containers':      partial.containers ?? (DAGONIZER_OPTION_DEFAULTS.containers as Readonly<Record<string, DagContainerInterface<TState>>>),
      'channels':        partial.channels ?? DAGONIZER_OPTION_DEFAULTS.channels,
      'registryVersion': partial.registryVersion ?? DEFAULT_REGISTRY_VERSION,
    };
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
    if (this.nodes.has(node.name)) {
      if (this.nodes.get(node.name) === (node as NodeInterface<TState, string, TServices>)) return;
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
    this.nodes.set(node.name, node as NodeInterface<TState, string, TServices>);
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
