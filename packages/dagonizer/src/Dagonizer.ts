import { Signal } from '@studnicky/signal';

import type { ChildStateFactoryType } from './contracts/ChildStateFactoryType.js';
import type { DagContainerInterface } from './contracts/DagContainerInterface.js';
import type { DispatcherBundleType } from './contracts/DispatcherBundle.js';
import type { ExecuteOptionsType } from './contracts/ExecuteOptionsType.js';
import type { HandoffChannelInterface } from './contracts/HandoffChannelInterface.js';
import type { NodeInterface, OutputSchemaValidatorInterface, SchemaObjectType } from './contracts/NodeInterface.js';
import type { ObserverRelayInterface } from './contracts/ObserverRelayInterface.js';
import type { PluginInterface } from './contracts/PluginInterface.js';
import type { StateAccessorInterface } from './contracts/StateAccessorInterface.js';
import type { TripleStoreInterface } from './contracts/TripleStoreInterface.js';
import { ContextResolver } from './dag/ContextResolver.js';
import type { DagRegistrar } from './dag/DagRegistrar.js';
import { Batch } from './entities/batch/Batch.js';
import type { DAGType } from './entities/dag/DAG.js';
import type { DAGNodeType } from './entities/dag/Placement.js';
import type { ExecutionResultType } from './entities/execution/ExecutionResult.js';
import { NodeContext } from './entities/node/NodeContext.js';
import type { NodeContextType } from './entities/node/NodeContext.js';
import type { NodeResultType } from './entities/node/NodeResult.js';
import { DAGError } from './errors/index.js';
import type { EngineHostType } from './execution/EngineComposer.js';
import { EngineComposer } from './execution/EngineComposer.js';
import type { NodeScheduler } from './execution/NodeScheduler.js';
import type { PlacementDispatch } from './execution/PlacementDispatch.js';
import type { RunNodeResultType, RunNodesBatchType, RunOptionsType } from './execution/ScatterDispatch.js';
import { Execution } from './Execution.js';
import { InMemoryTopologyStore } from './graph/InMemoryTopologyStore.js';
import type { NodeStateInterface } from './NodeStateBase.js';
import { DispatcherHooks } from './observer/DispatcherHooks.js';
import { ObserverRelay } from './observer/ObserverRelay.js';
import type { DispatcherHooksInterface } from './observer/ObserverRelay.js';
import { DagExecutionContext, DagExecutionContextKeys } from './runtime/DagExecutionContext.js';
import type { DagExecutionScope } from './runtime/DagExecutionContext.js';
import { DottedPathAccessor } from './runtime/DottedPathAccessor.js';
import { Scheduler } from './runtime/Scheduler.js';
import { StateMapper } from './runtime/StateMapper.js';
import { Validator } from './validation/Validator.js';

/** Default state accessor: installed when the dispatcher is constructed without one. */
const DEFAULT_STATE_ACCESSOR: StateAccessorInterface = new DottedPathAccessor();

/**
 * Concrete `OutputSchemaValidatorInterface` implementation backed by
 * `Validator.compile`. Built once per dispatcher instance when `validateOutputs`
 * is true; passed as `context.outputSchemaValidator` to every node execution.
 * When `validateOutputs` is false, `null` is passed instead — zero overhead.
 *
 * Caches compiled validators by schema object reference so the same schema
 * object (the literal returned by `MonadicNode.outputSchema`) is only compiled
 * once per dispatcher lifetime. `WeakMap` keeps the cache from holding schema
 * objects alive beyond their natural lifetime.
 */
class DispatcherOutputSchemaValidator implements OutputSchemaValidatorInterface {
  readonly #cache = new WeakMap<SchemaObjectType, ReturnType<typeof Validator.compile>>();

  validatePort(_portKey: string, schema: SchemaObjectType, state: unknown): string[] | null {
    let validator = this.#cache.get(schema);
    if (validator === undefined) {
      validator = Validator.compile<unknown>(schema);
      this.#cache.set(schema, validator);
    }
    return validator.errors(state);
  }
}

/** Registry version used when the dispatcher is constructed without one. */
const DEFAULT_REGISTRY_VERSION = '0';

/** Empty containers map: the canonical "no containers" sentinel. */
const EMPTY_CONTAINERS: Readonly<Record<string, never>> = Object.freeze({});

/** Empty channels map: the canonical "no channels" sentinel. */
const EMPTY_CHANNELS: Readonly<Record<string, never>> = Object.freeze({});

/** Empty observers array: the canonical "no observers" sentinel. */
const EMPTY_OBSERVERS: ReadonlyArray<DispatcherObserverType> = Object.freeze([]);

/**
 * Canonical defaults for `DagonizerOptionsType`.
 *
 * Every field that has a default is present here. The constructor resolves
 * all options in one spread: `{ ...DAGONIZER_OPTION_DEFAULTS, ...options }`.
 */
const DAGONIZER_OPTION_DEFAULTS = {
  'accessor': DEFAULT_STATE_ACCESSOR,
  'containers': EMPTY_CONTAINERS,
  'channels': EMPTY_CHANNELS,
  'registryVersion': DEFAULT_REGISTRY_VERSION,
  'validateOutputs': false,
  'observers': EMPTY_OBSERVERS,
} as const;

// Scatter progress types originate in entities/scatter/ScatterProgress.ts;
// re-exported here for public consumers.
export type { ScatterAckedResultType, ScatterInboxItemType, ScatterProgressType, StoredScatterProgressType } from './entities/scatter/ScatterProgress.js';

/**
 * Observer record for the multi-observer mux.
 *
 * Each field mirrors the corresponding protected lifecycle hook on `Dagonizer`.
 * Every callback is optional — include only the hooks you need. Observers are
 * called in array order, after any subclass override.
 *
 * Use the `observers` option on `DagonizerOptionsType` to supply an array of
 * these records to a dispatcher that does not use subclassing.
 */
export type DispatcherObserverType = {
  readonly onFlowStart?:  (dagName: string, state: NodeStateInterface, signal: AbortSignal) => void;
  readonly onFlowEnd?:    (dagName: string, state: NodeStateInterface, result: ExecutionResultType<NodeStateInterface>, signal: AbortSignal) => void;
  readonly onNodeStart?:  (nodeName: string, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal) => void;
  readonly onNodeEnd?:    (nodeName: string, output: string | null, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal) => void;
  readonly onError?:      (nodeName: string, error: Error, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal) => void;
  readonly onPhaseEnter?: (dagName: string, phase: 'pre' | 'post', placementName: string, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal) => void;
  readonly onPhaseExit?:  (dagName: string, phase: 'pre' | 'post', placementName: string, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal) => void;
};

/**
 * Constructor options for `Dagonizer`.
 *
 * A node's external dependencies are injected into the node's constructor, not
 * threaded through the dispatcher; there is no services option here.
 */
export type DagonizerOptionsType = {
  /**
   * Path resolver used for scatter source reads, gather writes, and
   * embedded-DAG state mapping. Defaults to a `DottedPathAccessor` that
   * walks `path.split('.')`.
   */
  accessor?: StateAccessorInterface;
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
  containers?: Record<string, DagContainerInterface>;
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
  /**
   * When `true`, every node output is validated against the node's declared
   * `outputSchema` for that port after execution. On mismatch the item is
   * re-routed to `'error'`. Default `false` — zero overhead in production.
   * Enable in dev/test to catch contract violations early.
   */
  validateOutputs?: boolean;
  /**
   * Optional array of observer records. Each observer's callbacks are muxed
   * into the corresponding lifecycle hook, called in array order after any
   * subclass override. The subclass hook-override pattern remains the primary
   * mechanism; this option is for the per-turn-rebuilt dispatcher pattern where
   * subclassing is impractical.
   *
   * Observers are called in array order, after any subclass override.
   */
  observers?: ReadonlyArray<DispatcherObserverType>;
  /**
   * Runtime RDF graph store for execution-time topology assertions such as
   * `dag:selectedDag`. Defaults to a per-dispatcher in-memory store. Pass a
   * graph-backed implementation to persist or query selected embedded/scatter
   * DAG choices across runs.
   */
  executionTopologyStore?: TripleStoreInterface;
}


// DAGNodeType and Placement are re-exported here so consumers who import from
// Dagonizer.ts find them alongside the dispatcher class.
export type { DAGNodeType } from './entities/dag/Placement.js';
export { Placement } from './entities/dag/Placement.js';

/**
 * Interface for Dagonizer. Both `execute()` and `resume()` return an
 * `Execution`, which is async-iterable (each stage as it completes) and
 * awaitable (the final summary).
 */
export interface DagonizerInterface<
  TState extends NodeStateInterface,
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
   * Look up a registered DAG by reference. The reference is expanded to the
   * registry IRI before lookup.
   */
  getDAG(name: string): DAGType | undefined;

  /**
   * Look up a registered node by reference. The reference is expanded to the
   * registry IRI before lookup. Returns `NodeInterface<NodeStateInterface,...>`
   * because the registry stores heterogeneous node types at the base interface.
   * Consumers that registered a `NodeInterface<MyState,...>` and need to call it
   * directly should retain their own typed reference rather than looking it up here.
   */
  getNode(name: string): NodeInterface<NodeStateInterface, string> | undefined;

  /**
   * Look up the child-state factory registered for a DAG reference. The reference
   * is expanded to the registry IRI before lookup. Every registered DAG has an
   * entry (`ChildStateFactory.cloneParent` when no override was
   * supplied at `registerDAG` time). Returns `undefined` when the DAG has not
   * been registered.
   */
  getChildStateFactory(dagName: string): ChildStateFactoryType | undefined;

  /**
   * True when a node with this reference is registered.
   */
  hasNode(name: string): boolean;

  /**
   * True when a DAG with this reference is registered.
   */
  hasDag(name: string): boolean;

  /** True when a DAG registry IRI exists exactly as supplied. */
  hasDagIri(iri: string): boolean;

  /** True when a node registry IRI exists exactly as supplied. */
  hasNodeIri(iri: string): boolean;

  /**
   * List every registered DAG. Useful for visualization, contract checks,
   * and tooling that needs to walk the registry.
   */
  listDAGs(): readonly DAGType[];

  /**
   * List every registered node. Useful for visualization and tooling.
   * Returns base-typed `NodeInterface<NodeStateInterface,...>` for the same reason as
   * `getNode`: the registry stores nodes with potentially heterogeneous state types.
   */
  listNodes(): readonly NodeInterface<NodeStateInterface, string>[];

  /**
   * Expanded IRI keys of every registered DAG. Cheaper than `listDAGs()` when
   * only the keys are needed (registry size checks, existence tooling).
   */
  dagNames(): readonly string[];

  /**
   * Expanded IRI keys of every registered node. Cheaper than `listNodes()` when
   * only the keys are needed (registry size checks, existence tooling).
   */
  nodeNames(): readonly string[];

  /** IRI keys of every registered DAG. */
  dagIris(): readonly string[];

  /** IRI keys of every registered node. */
  nodeIris(): readonly string[];

  /** Resolve the plugin package/specifier that owns a context prefix. */
  pluginSpecifierForPrefix(prefix: string): string | undefined;

  /** Snapshot of registered plugin prefix owners. */
  pluginPrefixSpecifiers(): ReadonlyMap<string, string>;

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
   * Register a DAG configuration with an optional child-state factory.
   */
  registerDAG(dag: DAGType, stateFactory?: ChildStateFactoryType): void;

  /**
   * Register a DAG node. Accepts nodes typed against any `TNodeState extends
   * NodeStateInterface` so child-state nodes (isolation factory bodies) and
   * plain nodes can both be registered on the dispatcher.
   */
  registerNode<TNodeState extends NodeStateInterface, TOutput extends string>(
    node: NodeInterface<TNodeState, TOutput>,
  ): void;

  /**
   * Register every node and DAG in the supplied bundle atomically. Accepts
   * bundles typed against any `TBundleState extends NodeStateInterface` so
   * child-state bundles (e.g. tool bundles whose nodes run inside isolated
   * child DAGs) can be registered on the dispatcher.
   */
  registerBundle<TBundleState extends NodeStateInterface>(bundle: DispatcherBundleType<TBundleState>): void;

  /**
   * Register a plugin on this dispatcher. The plugin's `register()` method is
   * called immediately with this dispatcher as the receiver.
   *
   * Plugin registration order matches call order. Register embedded-DAG plugin
   * bundles before the parent DAG that references their names.
   */
  registerPlugin(plugin: PluginInterface): void;
}

/**
 * Graph-based DAG dispatcher for state-machine-style multi-step
 * node execution.
 *
 * Subclass to attach observability by overriding `onFlowStart`, `onFlowEnd`,
 * `onNodeStart`, `onNodeEnd`, `onError`, `onPhaseEnter`, `onPhaseExit`.
 * Default implementations are no-ops — a bare `Dagonizer` produces zero
 * structured logs by default; this is intentional (no forced logging
 * dependency for consumers who don't want one), not an oversight. These
 * hooks are the ONE canonical observability surface — they fire for both
 * in-process nodes AND for nodes running inside worker/contained sub-DAGs
 * (via the internal relay).
 *
 * For structured logging with zero hook-writing, extend `ObservedDag`
 * (`./ObservedDag.js`) instead of `Dagonizer` directly — it wires every
 * lifecycle hook to an injected `DagLoggerInterface` (`trace`/`debug`/`info`/
 * `error`), including the run's correlation id via `DagExecutionContext`.
 * Use bare `Dagonizer` (as below) when you want silence, or when your own
 * hook overrides are the entire observability surface you need.
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
export class Dagonizer<TState extends NodeStateInterface>
implements DagonizerInterface<TState> {
  /**
   * The engine module wiring host. Owns every registry (`dags`, `nodes`,
   * `nodeIndex`, `stateFactories`) and every internal relay/context/execution
   * seam the composed engine modules (`BodyExecutor`, `NodeScheduler`,
   * `ScatterDispatch`, `Gather`, `LeafExecutor`, `EmbeddedDagExecutor`,
   * `DagRegistrar`, `DispatcherHooks`) drive through the eight narrow source
   * ports `EngineHostType` intersects. Constructed once, privately, as a local
   * class inside the constructor — that keeps it lexically inside `Dagonizer`'s
   * own class body, so its methods may call back into this instance's protected
   * hooks (`onFlowStart`, …) and private fields (`placementDispatch`, `runNodes`)
   * without those members ever becoming part of `Dagonizer`'s own public surface.
   * No external consumer ever obtains a reference to this object.
   */
  readonly #host: EngineHostType;
  /** Bound container backends, read by `destroy()` for teardown. */
  private readonly containers: Readonly<Record<string, DagContainerInterface>>;
  /** Bound egress channels, read by `destroy()` for teardown. */
  private readonly channels: Readonly<Record<string, HandoffChannelInterface>>;

  /**
   * Per-`@type` execution dispatch. Built once per dispatcher instance (not per
   * node call) so node execution is a single keyed branch with no per-call
   * closure/object allocation in the hot loop. The `PlacementDispatch` class
   * holds a stable shape; routing lives in its `dispatch` method.
   */
  private readonly placementDispatch: PlacementDispatch;

  /**
   * Work-set node-graph scheduler. Built once per dispatcher instance, bound to
   * the engine host via the narrow `NodeSchedulerSourceInterface`. Owns the
   * streaming DAG traversal; `runNodes` delegates to `this.nodeScheduler.run`.
   */
  private readonly nodeScheduler: NodeScheduler;

  /**
   * Registration + validation cluster. Built once per dispatcher instance, bound
   * to the engine host via the narrow `DagRegistrarSourceInterface` (the live
   * `dags` / `nodes` / `nodeIndex` registries plus the container-binding seams).
   * The public `registerDAG` / `registerNode` / `registerBundle` methods delegate
   * here so `Dagonizer` stays the composition root.
   */
  private readonly dagRegistrar: DagRegistrar;
  private readonly registeredPlugins = new Map<string, PluginInterface>();

  /**
   * Construct a dispatcher. Subclass and override the protected hooks
   * (`onFlowStart`, `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`)
   * for observability; no factory indirection, no callbacks.
   *
   * `options.accessor` swaps the path resolver used for scatter source
   * reads, gather writes, and embedded-DAG state mapping. Defaults to
   * `DottedPathAccessor`.
   */
  constructor(options: DagonizerOptionsType = {}) {
    const resolved = Dagonizer.options(options);
    this.containers = resolved.containers;
    this.channels = resolved.channels;

    // `self` gives the locally-declared EngineHost class below access to this
    // instance's protected hooks and private fields — private-name and protected
    // accessibility in JS/TS are lexically scoped to the textual class body, and
    // a class declared inside this constructor is textually nested inside
    // `Dagonizer`'s own declaration, so the access is legal even though EngineHost
    // is a distinct class. EngineHost's own members stay outside this class's
    // `implements` list, so none of them appear on `Dagonizer`'s public surface —
    // only the private `#host` field ever holds a reference to the instance.
    const self = this;

    class EngineHost implements EngineHostType {
      readonly dags = new Map<string, DAGType>();
      readonly nodes = new Map<string, NodeInterface<NodeStateInterface, string>>();
      readonly nodeIndex = new Map<string, DAGNodeType>();
      readonly stateFactories = new Map<string, ChildStateFactoryType>();
      readonly pluginSpecifiers = new Map<string, string>();
      readonly accessor: StateAccessorInterface;
      readonly stateMapper: StateMapper;
      readonly executionTopologyStore: TripleStoreInterface;
      readonly channels: Readonly<Record<string, HandoffChannelInterface>>;
      readonly registryVersion: string;
      readonly #containers: Readonly<Record<string, DagContainerInterface>>;
      readonly #validateOutputs: boolean;
      readonly #outputSchemaValidator: OutputSchemaValidatorInterface | null;
      readonly #observers: ReadonlyArray<DispatcherObserverType>;
      readonly #hooksAdapter: DispatcherHooksInterface;
      #correlationSeq = 0;

      constructor() {
        this.accessor = resolved.accessor;
        this.stateMapper = new StateMapper(resolved.accessor);
        this.executionTopologyStore = options.executionTopologyStore ?? new InMemoryTopologyStore();
        this.channels = resolved.channels;
        this.registryVersion = resolved.registryVersion;
        this.#containers = resolved.containers;
        this.#validateOutputs = resolved.validateOutputs;
        this.#outputSchemaValidator = resolved.validateOutputs ? new DispatcherOutputSchemaValidator() : null;
        this.#observers = resolved.observers;
        // Reused by every `relayFor` call so relay construction allocates only
        // the `ObserverRelay` instance (stable hidden class), not a fresh
        // closure-bearing adapter each time.
        this.#hooksAdapter = new DispatcherHooks(this);
      }

      /**
       * Output-schema validator for this dispatcher instance. Non-null when
       * `validateOutputs` is true; `null` otherwise.
       */
      get outputSchemaValidator(): OutputSchemaValidatorInterface | null {
        return this.#outputSchemaValidator;
      }

      /**
       * Resolve a logical container role to its bound `DagContainerInterface`, or
       * return `null` when the role is undefined or not bound (null = in-process path).
       */
      resolveContainer(role: string | undefined): DagContainerInterface | null {
        if (role === undefined) return null;
        const bound = this.#containers[role];
        return bound !== undefined ? bound : null;
      }

      /**
       * True when this dispatcher has opted into container dispatch by binding at
       * least one container role. A dispatcher with no bound containers runs every
       * body in-process and never enforces role binding at registration.
       */
      hasContainers(): boolean {
        return Object.keys(this.#containers).length > 0;
      }

      /**
       * Generate a monotonic correlation id for container requests and hand-off
       * envelopes. No randomness; no Date.now.
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
       */
      relayFor(state: NodeStateInterface): ObserverRelayInterface {
        return new ObserverRelay(this.#hooksAdapter, state);
      }

      /**
       * Build a node context for a sub-DAG body invocation. Forwards to
       * `NodeContext.create`. `signal` is always a valid `AbortSignal` — a run
       * with no caller-supplied cancellation surface carries `Signal.never()`.
       */
      bodyContext(dagName: string, nodeName: string, signal: AbortSignal): NodeContextType {
        return NodeContext.create(dagName, nodeName, signal, this.#validateOutputs, this.#outputSchemaValidator);
      }

      /**
       * Build a node context for a placement execution. `signal` is always a
       * valid `AbortSignal`.
       */
      nodeContext(dagName: string, placementName: string, signal: AbortSignal): NodeContextType {
        return NodeContext.create(dagName, placementName, signal, this.#validateOutputs, this.#outputSchemaValidator);
      }

      /**
       * Run a node over a single `state` as a size-1 batch. The canonical size-1
       * node-run primitive the focused executor modules drive.
       *
       * Wraps `state` in `Batch.of(state)`, calls `node.execute(batch, context)`,
       * asserts the size-1 invariant (exactly one route with exactly one item), and
       * returns the single output port key.
       *
       * Throws `DAGError` if the returned `RoutedBatchType` does not contain exactly
       * one route with exactly one item (invariant violation for size-1 dispatch).
       */
      async runNodeOnState(
        node: NodeInterface<NodeStateInterface, string>,
        state: NodeStateInterface,
        context: NodeContextType,
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
       * `BodyExecutor` drives this generator to execute an embedded-DAG or scatter
       * DAG body in-process. Forwards to `Dagonizer`'s private `runNodes`,
       * defaulting the batch tail to `{}`.
       */
      runBodyNodes(
        dagName: string,
        state: NodeStateInterface,
        fromStage: string | null,
        options: ExecuteOptionsType,
        runOptions: RunOptionsType,
        placementPath: readonly string[],
        batch?: RunNodesBatchType,
      ): AsyncGenerator<NodeResultType<NodeStateInterface>, { terminalOutcome: 'completed' | 'failed' | null }, void> {
        return self.runNodes(dagName, state, fromStage, options, runOptions, placementPath, batch ?? {});
      }

      /**
       * Run a scatter body sub-DAG through the canonical `runNodes` generator. The
       * scatter adapter drives this generator to execute each item's DAG body
       * in-process.
       */
      runScatterNodes(
        dagName: string,
        state: NodeStateInterface,
        fromStage: string | null,
        options: ExecuteOptionsType,
        runOptions: RunOptionsType,
        placementPath: readonly string[],
        batch?: RunNodesBatchType,
      ): AsyncGenerator<NodeResultType<NodeStateInterface>, ExecutionResultType<NodeStateInterface>, void> {
        return self.runNodes(dagName, state, fromStage, options, runOptions, placementPath, batch ?? {});
      }

      /**
       * Wrap a node execute call with a per-node timeout when `dagNode.timeout`
       * carries a budget. Derives a child `AbortController` from the run's signal,
       * arms a Scheduler timer, and races the node's execute against a deadline
       * rejection.
       *
       * The child signal is passed to the node so signal-aware IO (fetch, retry)
       * also cancels. Nodes that do not observe the signal are hard-stopped by the
       * race. On expiry a `DAGError` (code `NODE_TIMEOUT`) propagates; `executeSingleNode` re-throws
       * so the `runNodes` catch block fires `onError` and marks state failed.
       *
       * Timer and parent-abort listener are cleaned up in `finally`.
       */
      async withNodeTimeout<TResult>(
        dagNode: NodeInterface<NodeStateInterface, string>,
        parentSignal: AbortSignal,
        fn: (signal: AbortSignal) => Promise<TResult>,
      ): Promise<TResult> {
        const timeout = dagNode.timeout;
        const ms = timeout.ms;

        if (ms === null) {
          // No per-node budget; pass parent signal through unchanged.
          return fn(parentSignal);
        }

        const childCtrl = new AbortController();
        // The child signal represents the same logical run scope as `parentSignal`,
        // just under a narrower cancellation budget — alias it so a timed node's
        // `context.signal` resolves `DagExecutionContext.tryGet` identically to an
        // untimed node's.
        DagExecutionContext.alias(childCtrl.signal, parentSignal);
        const onParentAbort = (): void => { childCtrl.abort(parentSignal.reason); };

        if (parentSignal.aborted) {
          // Parent already aborted before node started.
          childCtrl.abort(parentSignal.reason);
        } else {
          parentSignal.addEventListener('abort', onParentAbort, { 'once': true });
        }

        const timeoutError = new DAGError(
          `Node "${dagNode.name}" exceeded its ${String(ms)} ms timeout`,
          { 'code': 'NODE_TIMEOUT', 'context': { 'nodeName': dagNode.name, 'timeoutMs': ms }, 'retryable': true },
        );

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
          childCtrl.abort(new DAGError('node-timeout-cleanup', { 'code': 'EXECUTION_ERROR' }));
          parentSignal.removeEventListener('abort', onParentAbort);
          await schedulerPromise;
        }
      }

      /**
       * Dispatch a composite (`ScatterNode` / `EmbeddedDAGNode`) placement for one
       * item through the per-`@type` `PlacementDispatch`. The scheduler's
       * per-item composite path drives this for each item in a fired batch.
       */
      async executeDAGNode(
        entry: DAGNodeType,
        state: NodeStateInterface,
        dagName: string,
        signal: AbortSignal,
        placementPath: readonly string[],
        bufferIntermediates: boolean = true,
      ): Promise<RunNodeResultType> {
        return self.placementDispatch.dispatch(entry, state, dagName, signal, placementPath, bufferIntermediates);
      }

      /**
       * Relay a flow-start event from the node scheduler into `onFlowStart`, then
       * call each muxed observer's `onFlowStart` callback in registration order.
       */
      relayFlowStart(dagName: string, state: NodeStateInterface, signal: AbortSignal): void {
        self.onFlowStart(dagName, state, signal);
        for (const obs of this.#observers) {
          obs.onFlowStart?.(dagName, state, signal);
        }
      }

      /**
       * Relay a flow-end event from the node scheduler into `onFlowEnd`, then
       * call each muxed observer's `onFlowEnd` callback in registration order.
       */
      relayFlowEnd(dagName: string, state: NodeStateInterface, result: ExecutionResultType<NodeStateInterface>, signal: AbortSignal): void {
        self.onFlowEnd(dagName, state, result, signal);
        for (const obs of this.#observers) {
          obs.onFlowEnd?.(dagName, state, result, signal);
        }
      }

      /**
       * Relay a node-start event from a worker/contained sub-DAG into `onNodeStart`,
       * then call each muxed observer's `onNodeStart` callback in registration order.
       */
      relayNodeStart(nodeName: string, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal): void {
        self.onNodeStart(nodeName, state, placementPath, signal);
        for (const obs of this.#observers) {
          obs.onNodeStart?.(nodeName, state, placementPath, signal);
        }
      }

      /**
       * Relay a node-end event from a worker/contained sub-DAG into `onNodeEnd`,
       * then call each muxed observer's `onNodeEnd` callback in registration order.
       */
      relayNodeEnd(nodeName: string, output: string | null, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal): void {
        self.onNodeEnd(nodeName, output, state, placementPath, signal);
        for (const obs of this.#observers) {
          obs.onNodeEnd?.(nodeName, output, state, placementPath, signal);
        }
      }

      /**
       * Relay an error event from a worker/contained sub-DAG into `onError`,
       * then call each muxed observer's `onError` callback in registration order.
       */
      relayError(nodeName: string, error: Error, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal): void {
        self.onError(nodeName, error, state, placementPath, signal);
        for (const obs of this.#observers) {
          obs.onError?.(nodeName, error, state, placementPath, signal);
        }
      }

      /**
       * Relay a phase-enter event from a worker/contained sub-DAG into `onPhaseEnter`,
       * then call each muxed observer's `onPhaseEnter` callback in registration order.
       */
      relayPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal): void {
        self.onPhaseEnter(dagName, phase, placementName, state, placementPath, signal);
        for (const obs of this.#observers) {
          obs.onPhaseEnter?.(dagName, phase, placementName, state, placementPath, signal);
        }
      }

      /**
       * Relay a phase-exit event from a worker/contained sub-DAG into `onPhaseExit`,
       * then call each muxed observer's `onPhaseExit` callback in registration order.
       */
      relayPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal): void {
        self.onPhaseExit(dagName, phase, placementName, state, placementPath, signal);
        for (const obs of this.#observers) {
          obs.onPhaseExit?.(dagName, phase, placementName, state, placementPath, signal);
        }
      }
    }

    this.#host = new EngineHost();
    // Construct the engine module graph in one place. `EngineComposer.compose`
    // owns the dependency ordering (bodyExecutor before its consumers, the three
    // executors before placementDispatch); `#host` satisfies `EngineHostType`
    // because it implements every narrow source port the modules require. The
    // root retains only the modules it drives directly — the per-`@type` dispatch,
    // the scheduler, and the registrar. The five intermediate executors
    // (`bodyExecutor`, `gather`, `leafExecutor`, `embeddedDagExecutor`,
    // `scatterExecutor`) are wired into the graph by the composer and held only
    // by their consumers, so the root keeps no field for them. Wire in
    // declaration order to keep the hidden class stable.
    const engine = EngineComposer.compose(this.#host);
    this.placementDispatch = engine.placementDispatch;
    this.nodeScheduler = engine.nodeScheduler;
    this.dagRegistrar = engine.dagRegistrar;
  }

  // ---------------------------------------------------------------------------
  // Observability hooks: protected, no-op defaults. Subclass + override, or
  // extend `ObservedDag` for ready-made structured logging (see class docs
  // above) instead of overriding these directly.
  // ---------------------------------------------------------------------------

  protected onFlowStart(_dagName: string, _state: NodeStateInterface, _signal: AbortSignal): void { /* override */ }
  protected onFlowEnd(_dagName: string, _state: NodeStateInterface, _result: ExecutionResultType<NodeStateInterface>, _signal: AbortSignal): void { /* override */ }
  /**
   * Fires before a node begins executing. `placementPath` is the ordered
   * list of parent embedded-DAG placement names that led to this node.
   * Empty (`[]`) for top-level placements, `['on-topic-search']` for one
   * level of embedded-DAG nesting, and so on. Use it to disambiguate same-
   * named inner placements across multiple embedded-DAG instances. `signal`
   * is the run's `AbortSignal`, the same anchor `DagExecutionContext.tryGet`
   * resolves. The dispatcher always passes both; an override may take fewer
   * arguments.
   *
   * This hook fires for BOTH in-process nodes AND for nodes running in
   * worker/contained sub-DAGs (via the internal observer relay).
   *
   * `state` is typed `NodeStateInterface` because this hook fires for every
   * node — including embedded child nodes whose concrete class may differ from
   * the dispatcher's `TState`. Consumers that need typed fields narrow locally.
   */
  protected onNodeStart(_nodeName: string, _state: NodeStateInterface, _placementPath: readonly string[], _signal: AbortSignal): void { /* override */ }
  /**
   * Fires after a node completes successfully. See {@link onNodeStart} for
   * `placementPath`, `state`, and `signal` semantics. Fires for in-process and worker nodes.
   */
  protected onNodeEnd(_nodeName: string, _output: string | null, _state: NodeStateInterface, _placementPath: readonly string[], _signal: AbortSignal): void { /* override */ }
  /**
   * Fires when the dispatcher catches an error from a node (or from the
   * abort/timeout machinery). See {@link onNodeStart} for `placementPath`,
   * `state`, and `signal` semantics. Fires for in-process and worker nodes.
   */
  protected onError(_nodeName: string, _error: Error, _state: NodeStateInterface, _placementPath: readonly string[], _signal: AbortSignal): void { /* override */ }
  /**
   * Fires before a `pre` or `post` phase placement runs. `placementPath`
   * follows the same semantics as `onNodeStart`. Fires for in-process and
   * worker phases.
   */
  protected onPhaseEnter(_dagName: string, _phase: 'pre' | 'post', _placementName: string, _state: NodeStateInterface, _placementPath: readonly string[], _signal: AbortSignal): void { /* override */ }
  /**
   * Fires after a `pre` or `post` phase placement completes (success or
   * collected error). See {@link onPhaseEnter}.
   */
  protected onPhaseExit(_dagName: string, _phase: 'pre' | 'post', _placementName: string, _state: NodeStateInterface, _placementPath: readonly string[], _signal: AbortSignal): void { /* override */ }

  // ---------------------------------------------------------------------------

  async destroy(): Promise<void> {
    // Teardown order: nodes first (they may hold references into containers),
    // then bound containers (worker/child pools), then egress channels. Each
    // backend's `destroy()` is optional; guard the call. Safe to call more than
    // once — the registries are cleared at the end and re-destroying an
    // already-torn-down backend is the backend's own idempotency concern.
    for (const node of this.#host.nodes.values()) {
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
    this.#host.nodes.clear();
    this.#host.dags.clear();
    this.#host.nodeIndex.clear();
    this.#host.pluginSpecifiers.clear();
    this.registeredPlugins.clear();
  }

  /**
   * Look up a registered DAG by reference. The reference is expanded to the
   * registry IRI before lookup. Returns `undefined` when the DAG is not registered.
   */
  getDAG(name: string): DAGType | undefined {
    return this.#host.dags.get(ContextResolver.expand(name, {}));
  }

  /**
   * Look up a registered node by reference. The reference is expanded to the
   * registry IRI before lookup. Returns `undefined` when the node is not registered.
   */
  getNode(name: string): NodeInterface<NodeStateInterface, string> | undefined {
    return this.#host.nodes.get(ContextResolver.expand(name, {}));
  }

  /**
   * Look up the child-state factory registered for a DAG reference. The reference
   * is expanded to the registry IRI before lookup. Every registered DAG has an
   * entry (`ChildStateFactory.cloneParent` when no override is supplied at
   * `registerDAG` time). Returns `undefined` when the DAG is not registered.
   */
  getChildStateFactory(dagName: string): ChildStateFactoryType | undefined {
    return this.#host.stateFactories.get(ContextResolver.expand(dagName, {}));
  }

  /**
   * True when a node with this reference is registered.
   */
  hasNode(name: string): boolean {
    return this.dagRegistrar.hasNode(ContextResolver.expand(name, {}));
  }

  /**
   * True when a DAG with this reference is registered.
   */
  hasDag(name: string): boolean {
    return this.dagRegistrar.hasDAG(ContextResolver.expand(name, {}));
  }

  hasDagIri(iri: string): boolean {
    return this.dagRegistrar.hasDAG(iri);
  }

  hasNodeIri(iri: string): boolean {
    return this.dagRegistrar.hasNode(iri);
  }

  /**
   * Snapshot of every registered DAG. The returned array is a fresh
   * shallow copy; mutating it does not affect the registry.
   */
  listDAGs(): readonly DAGType[] {
    return this.dagRegistrar.listDAGs();
  }

  /**
   * Snapshot of every registered node. The returned array is a fresh
   * shallow copy; mutating it does not affect the registry.
   */
  listNodes(): readonly NodeInterface<NodeStateInterface, string>[] {
    return this.dagRegistrar.listNodes();
  }

  /**
   * Expanded IRI keys of every registered DAG. Cheaper than `listDAGs()` when
   * only the keys are needed.
   */
  dagNames(): readonly string[] {
    return this.dagRegistrar.dagIris();
  }

  /**
   * Expanded IRI keys of every registered node. Cheaper than `listNodes()` when
   * only the keys are needed.
   */
  nodeNames(): readonly string[] {
    return this.dagRegistrar.nodeIris();
  }

  dagIris(): readonly string[] {
    return this.dagRegistrar.dagIris();
  }

  nodeIris(): readonly string[] {
    return this.dagRegistrar.nodeIris();
  }

  pluginSpecifierForPrefix(prefix: string): string | undefined {
    return this.dagRegistrar.pluginSpecifierForPrefix(prefix);
  }

  pluginPrefixSpecifiers(): ReadonlyMap<string, string> {
    return this.dagRegistrar.pluginPrefixSpecifiers();
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
    // Compose the run's signal once, here, and thread the SAME signal object
    // both into the scope anchor (so `DagExecutionContext.tryGet` resolves
    // it) and down into `runNodes` (stripped of `deadlineMs`, so `Signal.compose`
    // there short-circuits to the identical object rather than re-wrapping it —
    // see `dagExecutionScope`'s doc comment).
    const signal = Dagonizer.rootSignal(options);
    const scope = this.dagExecutionScope(dagName, signal);
    return new Execution<TState>(this.runNodes(dagName, initialState, null, { signal }), scope);
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
    // Each item gets its own composed signal and scope — item runs are
    // isolated, so a shared signal would incorrectly couple their abort and
    // correlation-context lifetimes.
    return batchStates.map((state) => {
      const signal = Dagonizer.rootSignal(options);
      const scope = this.dagExecutionScope(dagName, signal);
      return new Execution<TState>(this.runNodes(dagName, state, null, { signal }), scope);
    });
  }

  /**
   * Resume a flow from `fromStage`. Same generator as `execute()` but
   * begins at the given cursor instead of the flow's entrypoint. Caller
   * is responsible for rehydrating `state` (typically via
   * `Checkpoint.load(raw).restoreState(fn)`) before calling.
   *
   * A resumed run gets a fresh correlation id: it runs on a new async call
   * stack (typically a new process), so the original run's correlation id
   * has no meaning here. Consumers that need to correlate a resume with its
   * original run do so via the checkpoint's own identity, not this context.
   */
  resume(
    dagName: string,
    state: TState,
    fromStage: string,
    options: ExecuteOptionsType = {},
  ): Execution<TState> {
    const signal = Dagonizer.rootSignal(options);
    const scope = this.dagExecutionScope(dagName, signal);
    return new Execution<TState>(this.runNodes(dagName, state, fromStage, { signal }), scope);
  }

  /**
   * Compose `options` into this run's root `AbortSignal`, guaranteeing a
   * fresh, distinct `AbortSignal` OBJECT even when `options` supplies neither
   * `signal` nor `deadlineMs` — `Signal.compose` falls back to `Signal.never()`
   * in that case, a memoized SHARED singleton reused across every call with
   * no options. Reusing that shared object as a `DagExecutionContext` scope
   * anchor would collide across every concurrent no-options `execute()` call
   * (the anchor map is keyed by object identity, and each new run would
   * silently overwrite the previous run's anchor entry — precisely the
   * cross-run leak this scope design exists to prevent). `AbortSignal.any()`
   * always constructs a NEW following signal, even for a single-element
   * array, so wrapping the composed signal in it restores per-run identity
   * uniqueness while faithfully preserving abort/timeout/reason semantics.
   */
  private static rootSignal(options: ExecuteOptionsType): AbortSignal {
    return AbortSignal.any([Signal.compose(options)]);
  }

  /**
   * Initialize a `DagExecutionContext` scope for one `execute()`/`resume()`/
   * `executeBatch()` run, seeded with a fresh correlation id and `dagName`,
   * and anchored to `signal` — the SAME `AbortSignal` object the caller
   * threads down into `runNodes`. Every node body and lifecycle hook that
   * fires during the run carries that identical signal (directly, or via
   * `DagExecutionScope.alias` for a `withNodeTimeout`-derived child signal),
   * so `DagExecutionContext.tryGet(signal, key)` resolves this scope from
   * anywhere, correct across any `await` boundary or interleaved concurrent
   * run — see `runtime/DagExecutionContext.ts` for the full design.
   */
  private dagExecutionScope(dagName: string, signal: AbortSignal): DagExecutionScope {
    return DagExecutionContext.initialize({
      [DagExecutionContextKeys.CORRELATION_ID]: globalThis.crypto.randomUUID(),
      [DagExecutionContextKeys.DAG_NAME]: dagName,
    }, signal);
  }

  /**
   * Canonical generator. Yields each node result (including the intermediate
   * yields from parallel / scatter nodes) and returns the final
   * `ExecutionResultType` with `cursor` set. Never throws.
   *
   * Thin delegate to `this.nodeScheduler.run`. The scheduler owns the work-set
   * traversal cluster; `Dagonizer` stays the orchestration layer. `execute`,
   * `resume`, `executeBatch`, and the engine host's `runBodyNodes` /
   * `runScatterNodes` seams all drive the run through this method.
   *
   * `runOptions.embedded` is a private implementation detail for recursive
   * embedded-DAG re-entry. When `true`, lifecycle transitions (`markRunning`,
   * `markCompleted`) and flow hooks (`onFlowStart`, `onFlowEnd`) are suppressed
   * (those are top-level concerns owned by the consumer's `execute()` /
   * `resume()` call). Node hooks (`onNodeStart`, `onNodeEnd`, `onError`) still
   * fire for every child node.
   */
  private runNodes<TReturn extends NodeStateInterface = NodeStateInterface>(
    dagName: string,
    state: TReturn,
    fromStage: string | null,
    options: ExecuteOptionsType,
    runOptions: RunOptionsType = { 'embedded': false },
    placementPath: readonly string[] = [],
    batch: RunNodesBatchType = {},
  ): AsyncGenerator<NodeResultType<NodeStateInterface>, ExecutionResultType<TReturn>, void> {
    // The generator yields heterogeneous per-node results (a child embedded node
    // runs on its own isolation state) typed `NodeStateInterface`, and returns the
    // final `ExecutionResultType<TReturn>` whose `state` is the caller's own
    // `TReturn` instance — both honest, no cast at the boundary.
    return this.nodeScheduler.run<TReturn>(
      dagName, state, fromStage, options, runOptions, placementPath, batch,
    );
  }

  /**
   * Register a DAG configuration.
   *
   * Throws `DAGError` immediately when a DAG with the same expanded IRI is already registered.
   *
   * Runs shape, semantic, container-binding, and graph-reference validation
   * before mutating the live registry.
   */
  registerDAG(dag: DAGType, stateFactory?: ChildStateFactoryType): void {
    this.dagRegistrar.registerDAG(dag, stateFactory);
  }

  /**
   * Resolve a `DagonizerOptionsType` partial to a fully-populated
   * resolved options record. This is the single place where defaults are
   * applied; no code inside the constructor or engine internals ever sees
   * optional fields.
   */
  static options(
    partial: DagonizerOptionsType = {},
  ): Readonly<{
    accessor: StateAccessorInterface;
    containers: Readonly<Record<string, DagContainerInterface>>;
    channels: Readonly<Record<string, HandoffChannelInterface>>;
    registryVersion: string;
    validateOutputs: boolean;
    observers: ReadonlyArray<DispatcherObserverType>;
  }> {
    return {
      'accessor':        partial.accessor ?? DAGONIZER_OPTION_DEFAULTS.accessor,
      'containers':      partial.containers ?? DAGONIZER_OPTION_DEFAULTS.containers,
      'channels':        partial.channels ?? DAGONIZER_OPTION_DEFAULTS.channels,
      'registryVersion': partial.registryVersion ?? DAGONIZER_OPTION_DEFAULTS.registryVersion,
      'validateOutputs': partial.validateOutputs ?? DAGONIZER_OPTION_DEFAULTS.validateOutputs,
      'observers':       partial.observers ?? DAGONIZER_OPTION_DEFAULTS.observers,
    };
  }

  /**
   * Register a node. Accepts narrowly-typed nodes
   * (`NodeInterface<TState, 'success' | 'error'>`) and stores them widened to
   * `NodeInterface<TState, string>`; narrow → wide is sound covariantly on
   * both `outputs` and the result `output`.
   *
   * Throws `DAGError` when a node with the same expanded IRI is already registered.
   */
  registerNode<TNodeState extends NodeStateInterface, TOutput extends string>(
    node: NodeInterface<TNodeState, TOutput>,
  ): void {
    this.dagRegistrar.registerNode(node);
  }

  /**
   * Register every node and DAG in the supplied bundle atomically. The bundle
   * installs real node and DAG objects into a transaction, validates the staged
   * registry view, then commits or rolls back the entries it added.
   */
  registerBundle<TBundleState extends NodeStateInterface>(bundle: DispatcherBundleType<TBundleState>): void {
    this.dagRegistrar.registerBundle(bundle);
  }

  /**
   * Register a plugin on this dispatcher. The plugin's `register()` method is
   * called immediately with this dispatcher as the receiver.
   *
   * Plugin registration order matches call order. Register embedded-DAG plugin
   * bundles before the parent DAG that references their names.
   */
  registerPlugin(plugin: PluginInterface): void {
    const existing = this.registeredPlugins.get(plugin.id);
    if (existing !== undefined) {
      if (Object.is(existing, plugin)) return;
      throw new DAGError(`Plugin id '${plugin.id}' is already registered with a different plugin`, {
        'code': 'PLUGIN_INVALID',
      });
    }
    this.registeredPlugins.set(plugin.id, plugin);
    try {
      plugin.register(this);
    } catch (error) {
      this.registeredPlugins.delete(plugin.id);
      throw error;
    }
  }
}
