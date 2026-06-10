import { DagTask } from './container/DagTask.js';
import { TransportErrorCode } from './container/TransportErrorCode.js';
import type { ChannelInterface } from './contracts/ChannelInterface.js';
import type { DagContainerInterface } from './contracts/DagContainerInterface.js';
import type { ExecuteOptionsInterface } from './contracts/ExecuteOptionsInterface.js';
import type { NodeInterface } from './contracts/NodeInterface.js';
import type { NodeInvoker } from './contracts/NodeInvoker.js';
import type { StateAccessor } from './contracts/StateAccessor.js';
import type { WarningEmitter } from './contracts/WarningEmitter.js';
import { GatherStrategies } from './core/GatherStrategies.js';
import type { GatherExecution, GatherRecord } from './core/GatherStrategies.js';
import { OutcomeReducers } from './core/OutcomeReducers.js';
import type { OutcomeRecord } from './core/OutcomeReducers.js';
import { ContractRegistryValidator } from './derive/ContractRegistryValidator.js';
import type { DAG } from './entities/dag/DAG.js';
import type { EmbeddedDAGNode } from './entities/dag/EmbeddedDAGNode.js';
import type { PhaseNodePlacementInterface } from './entities/dag/PhaseNode.js';
import { Placement } from './entities/dag/Placement.js';
import type { DAGNodeType } from './entities/dag/Placement.js';
import type { ScatterNode } from './entities/dag/ScatterNode.js';
import type { SingleNodePlacementInterface } from './entities/dag/SingleNode.js';
import type { ExecutionResultInterface, InterruptionInfo } from './entities/execution/ExecutionResult.js';
import type { DAGHandoff } from './entities/handoff/DAGHandoff.js';
import type { NodeContextInterface } from './entities/node/NodeContext.js';
import { NodeOutputBuilder } from './entities/node/NodeOutput.js';
import type { NodeResultInterface } from './entities/node/NodeResult.js';
import type { ScatterAckedResult, ScatterInboxItem } from './entities/scatter/ScatterProgress.js';
import { DAGError, ExecutionError, NodeTimeoutError, ValidationError } from './errors/index.js';
import { Execution } from './Execution.js';
import { DAGLifecycleMachine } from './lifecycle/DAGLifecycleMachine.js';
import type { NodeStateInterface } from './NodeStateBase.js';
import { DottedPathAccessor } from './runtime/DottedPathAccessor.js';
import { ScatterCheckpoint } from './runtime/ScatterCheckpoint.js';
import { Scheduler } from './runtime/Scheduler.js';
import { SignalComposer } from './runtime/SignalComposer.js';
import { StateMapper } from './runtime/StateMapper.js';
import { DAGValidator } from './validation/DAGValidator.js';
import { Validator } from './validation/Validator.js';

/** Default state accessor: installed when the dispatcher is constructed without one. */
const DEFAULT_STATE_ACCESSOR: StateAccessor = new DottedPathAccessor();

/** Registry version used when the dispatcher is constructed without one. */
const DEFAULT_REGISTRY_VERSION = '0';

/**
 * Reserved metadata key used by `executeScatter` to persist per-clone
 * resume bookkeeping. **Consumer nodes must not write to this key.**
 * It is engine-internal and may be overwritten or cleared between batch
 * boundaries.
 *
 * The stored value is a `StoredScatterProgress` map keyed by the
 * scatter placement's `name` so multiple scatter placements in one flow
 * keep independent entries.
 */
export const SCATTER_PROGRESS_KEY = '__dagonizer_scatter_progress__';

// Scatter progress types are defined in entities/scatter/ScatterProgress.ts
// and re-exported below for public consumers. The hand-written duplicates
// that used to live here have been replaced with the canonical schema-derived
// types. See ScatterInboxItem, ScatterAckedResult, ScatterProgress, and
// StoredScatterProgress in './entities/scatter/ScatterProgress.js'.
export type { ScatterAckedResult, ScatterInboxItem, ScatterProgress, StoredScatterProgress } from './entities/scatter/ScatterProgress.js';

// ── Module-private adapter classes ───────────────────────────────────────────

/**
 * Routes contract warnings from `ContractRegistryValidator` to the
 * dispatcher's `onContractWarning` hook.
 * Constructed inside `Dagonizer.registerDAG` where the target is in scope.
 */
class DispatcherWarningEmitter implements WarningEmitter {
  readonly #onContractWarning: (message: string) => void;

  constructor(onContractWarning: (message: string) => void) {
    this.#onContractWarning = onContractWarning;
  }

  warn(message: string): void {
    this.#onContractWarning(message);
  }
}

/**
 * Internal relay interface: callbacks the parent Dagonizer injects into a
 * container so worker-side hook events flow to the parent's protected hooks.
 * NOT exported from any public surface; it is internal plumbing only.
 *
 * `onFlowStart`/`onFlowEnd` are absent: those are top-level concerns owned
 * by the parent's `execute()` call. The relay carries only the node/phase/error
 * hooks that worker sub-DAGs need to forward.
 */
export interface ObserverRelay {
  onNodeStart(nodeName: string, placementPath: readonly string[]): void;
  onNodeEnd(nodeName: string, output: string | null, placementPath: readonly string[]): void;
  onError(nodeName: string, error: Error, placementPath: readonly string[]): void;
  onPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, placementPath: readonly string[]): void;
  onPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, placementPath: readonly string[]): void;
  onContractWarning(message: string): void;
}

/**
 * Dispatches a registered node back through the engine for `custom` gather
 * strategies. Constructed inside `Dagonizer.buildGatherExecution` where the
 * dispatcher context is in scope. Receives the resolve and execute in-process
 * closures that bridge the private dispatcher members — this is in-process
 * composition, not a dispatch callback seam.
 */
class GatherNodeInvoker implements NodeInvoker {
  readonly #resolve: (nodeName: string) => boolean;
  readonly #execute: (nodeName: string) => Promise<void>;

  constructor(
    resolve: (nodeName: string) => boolean,
    execute: (nodeName: string) => Promise<void>,
  ) {
    this.#resolve = resolve;
    this.#execute = execute;
  }

  async invokeNode(nodeName: string): Promise<void> {
    if (!this.#resolve(nodeName)) {
      throw new DAGError(`Unknown custom node: ${nodeName}`);
    }
    await this.#execute(nodeName);
  }
}

/**
 * Constructor options for `Dagonizer`.
 *
 * `TServices` is the consumer-defined services bag that the dispatcher
 * passes through every `NodeContextInterface`. Default `undefined` means
 * nodes receive `context.services === undefined`.
 */
export interface DagonizerOptionsInterface<TState extends NodeStateInterface = NodeStateInterface, TServices = undefined> {
  /**
   * Path resolver used for scatter source reads, gather writes, and
   * embedded-DAG state mapping. Defaults to a `DottedPathAccessor` that
   * walks `path.split('.')`.
   */
  readonly accessor?: StateAccessor;
  /**
   * Services bag exposed to every node via `context.services`. Construct
   * the dispatcher with `{ services: { logger, db, ... } }` and the same
   * reference flows into every `NodeInterface.execute(state, context)`
   * call.
   */
  readonly services?: TServices;
  /**
   * Named container backends. Keys are logical role names declared on
   * `EmbeddedDAGNode.container` and `ScatterNode.container` (dag-body
   * only). An unbound role resolves to in-process and fires
   * `onContractWarning`.
   *
   * Containers are optional: an empty registry is the default and
   * means every placement runs in-process.
   */
  readonly containers?: Readonly<Record<string, DagContainerInterface<TState>>>;
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
  readonly channels?: Readonly<Record<string, ChannelInterface>>;
  /**
   * Registry version string included in every `DAGHandoff` envelope.
   * Receivers use this for version-handshake validation. Defaults to
   * `DEFAULT_REGISTRY_VERSION` ('0') when not supplied.
   */
  readonly registryVersion?: string;
}


// DAGNodeType and the Placement static class live in entities/dag/Placement.ts.
// Re-export DAGNodeType so consumers who import from Dagonizer.ts continue to
// find it here; Placement is exported directly via src/index.ts and src/types/index.ts.
export type { DAGNodeType } from './entities/dag/Placement.js';
export { Placement } from './entities/dag/Placement.js';

type DAGNodeAtType = DAGNodeType['@type'];

/**
 * A coherent bundle of nodes + DAGs that register together.
 *
 * Plugin packages (or feature modules) export a `DispatcherBundle` so
 * consumers register the whole unit in one call instead of iterating
 * `registerNode` / `registerDAG` themselves. Nodes register first so
 * every DAG's references resolve when the DAG's semantic validator
 * runs.
 *
 * Both arrays are required; either may be empty (a node-only bundle
 * uses `dags: []`; a DAG-only bundle uses `nodes: []`).
 */
export interface DispatcherBundle<TState extends NodeStateInterface, TServices = undefined> {
  readonly nodes: readonly NodeInterface<TState, string, TServices>[];
  readonly dags:  readonly DAG[];
}

/**
 * Interface for Dagonizer. Both `execute()` and `resume()` return an
 * `Execution`, which is async-iterable (each stage as it completes) and
 * awaitable (the final summary).
 *
 * `TServices` flows through every node's `NodeContextInterface.services`
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
    options?: ExecuteOptionsInterface,
  ): Execution<TState>;

  /**
   * Look up a registered DAG by name.
   */
  getDAG(name: string): DAG | undefined;

  /**
   * Look up a registered node by name.
   */
  getNode(name: string): NodeInterface<TState, string, TServices> | undefined;

  /**
   * List every registered DAG. Useful for visualization, contract checks,
   * and tooling that needs to walk the registry.
   */
  listDAGs(): readonly DAG[];

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
    options?: ExecuteOptionsInterface,
  ): Execution<TState>;

  /**
   * Register a DAG configuration.
   */
  registerDAG(dag: DAG): void;

  /**
   * Register a DAG node.
   */
  registerNode<TOutput extends string>(
    node: NodeInterface<TState, TOutput, TServices>,
  ): void;

  /**
   * Register every node, then every DAG, in the supplied bundle.
   */
  registerBundle(bundle: DispatcherBundle<TState, TServices>): void;
}

/** Engine-private result envelope returned by every node executor method. */
type _InternalNodeResult<TState extends NodeStateInterface> = {
  'nextStage': null | string;
  'result': NodeResultInterface<TState>;
};

/** Engine-private execution context for `runNodes` and `runPostPhasesAndFinalize`. */
type _RunOptions = { readonly embedded: boolean };

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
 * const node: NodeInterface<MyState, 'done'> = {
 *   name: 'increment', outputs: ['done'],
 *   async execute(state) { state.value++; return { output: 'done' }; },
 * };
 *
 * const dispatcher = new Dagonizer<MyState>();
 * dispatcher.registerNode(node);
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
implements DagonizerInterface<TState, TServices> {
  private readonly dags = new Map<string, DAG>();
  private readonly nodes = new Map<string, NodeInterface<TState, string, TServices>>();
  private readonly nodeIndex = new Map<string, DAGNodeType>();
  private readonly accessor: StateAccessor;
  // Declared as TServices so NodeContextInterface<TServices>.services is
  // satisfied. When TServices = undefined (the default), the field is undefined.
  // The cast in the constructor is required because options.services is optional
  // (TServices | undefined); when the caller passes undefined for a non-undefined
  // TServices the error surfaces at the call site, not here.
  private readonly services: TServices;
  private readonly stateMapper: StateMapper<TState>;
  private readonly containers: Readonly<Record<string, DagContainerInterface<TState>>>;
  private readonly channels: Readonly<Record<string, ChannelInterface>>;
  private readonly registryVersion: string;
  #correlationSeq = 0;

  /**
   * Shared never-aborting signal used as the fallback when a call supplies no
   * `signal`. Allocated once at class load instead of a fresh `AbortController`
   * per node execution (hot path: one per scatter clone / embedded-DAG step).
   */
  private static readonly NEVER_ABORT_SIGNAL: AbortSignal = new AbortController().signal;

  /**
   * Per-`@type` execution dispatch. Built once per dispatcher instance (not per
   * node call) so node execution is a single keyed lookup with no per-call
   * closure/object allocation in the hot loop.
   */
  private readonly dispatch: Readonly<Record<DAGNodeAtType, (
    entry: DAGNodeType,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
    placementPath: readonly string[],
  ) => Promise<_InternalNodeResult<TState>>>>;

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
  constructor(options: DagonizerOptionsInterface<TState, TServices> = {}) {
    this.accessor = options.accessor ?? DEFAULT_STATE_ACCESSOR;
    // Cast required: options.services is `TServices | undefined`; when TServices
    // defaults to `undefined` this is sound. Consumers passing a non-undefined
    // TServices must supply the services value.
    this.services = options.services as TServices;
    this.stateMapper = new StateMapper<TState>(this.accessor);
    this.containers = options.containers ?? {};
    this.channels = options.channels ?? {};
    this.registryVersion = options.registryVersion ?? DEFAULT_REGISTRY_VERSION;
    this.dispatch = {
      'EmbeddedDAGNode': (entry, state, _dagName, signal, placementPath) => {
        // Placement.isEmbeddedDAG guard: @type === 'EmbeddedDAGNode' confirmed by
        // the dispatch table key; guard makes the narrowing explicit.
        if (!Placement.isEmbeddedDAG(entry)) throw new DAGError(`Dispatch type mismatch: expected EmbeddedDAGNode`);
        return this.executeEmbeddedDAG(entry, state, signal, placementPath);
      },
      'ScatterNode': (entry, state, dagName, signal, placementPath) => {
        if (!Placement.isScatter(entry)) throw new DAGError(`Dispatch type mismatch: expected ScatterNode`);
        return this.executeScatter(entry, state, dagName, signal, placementPath);
      },
      'SingleNode': (entry, state, dagName, signal) => {
        if (!Placement.isSingle(entry)) throw new DAGError(`Dispatch type mismatch: expected SingleNode`);
        return this.executeSingleNode(entry, state, dagName, signal);
      },
      // TerminalNode / PhaseNode are handled before executeDAGNode in runNodes;
      // these branches are unreachable in normal operation but keep the dispatch
      // table exhaustive over the node `@type` union.
      'TerminalNode': (entry, state) => {
        if (!Placement.isTerminal(entry)) throw new DAGError(`Dispatch type mismatch: expected TerminalNode`);
        return Promise.resolve({ 'nextStage': null, 'result': {
          'output': entry.outcome, 'skipped': false, 'nodeName': entry.name, state, 'intermediateResults': [],
        } });
      },
      'PhaseNode': (entry, state) => {
        if (!Placement.isPhase(entry)) throw new DAGError(`Dispatch type mismatch: expected PhaseNode`);
        return Promise.resolve({ 'nextStage': null, 'result': {
          'output': entry.phase, 'skipped': true, 'nodeName': entry.name, state, 'intermediateResults': [],
        } });
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Observability hooks: protected, no-op defaults. Subclass + override.
  // ---------------------------------------------------------------------------

  protected onFlowStart(_dagName: string, _state: TState): void { /* override */ }
  protected onFlowEnd(_dagName: string, _state: TState, _result: ExecutionResultInterface<TState>): void { /* override */ }
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

  /**
   * Called for each non-fatal contract warning surfaced during DAG
   * registration when the DAG was derived from a node registry. Default
   * is a no-op. Subclasses can override to log or surface dead-write
   * warnings to operators.
   *
   * @param _message - Human-readable warning from `ContractRegistryValidator`.
   */
  protected onContractWarning(_message: string): void { /* override */ }

  // ---------------------------------------------------------------------------
  // Container support
  // ---------------------------------------------------------------------------

  /**
   * Resolve a logical container role to its bound `DagContainerInterface`, or
   * return `null` when the role is undefined or not bound (null = in-process path).
   */
  private resolveContainer(role: string | undefined): DagContainerInterface<TState> | null {
    if (role === undefined) return null;
    const bound = this.containers[role];
    return bound !== undefined ? bound : null;
  }

  /**
   * Generate a monotonic correlation id for container requests and hand-off
   * envelopes. Uses a private `#correlationSeq` counter. No randomness; no Date.now.
   */
  private nextCorrelationId(dagName: string): string {
    return `${dagName}:${++this.#correlationSeq}`;
  }

  /**
   * Build an `ObserverRelay` bound to this dispatcher instance's protected
   * hooks. The relay is passed to `container.runDag` so worker-side events
   * flow back to the parent's `onNodeStart/onNodeEnd/onError/onPhaseEnter/onPhaseExit`.
   *
   * `onFlowStart`/`onFlowEnd` are deliberately excluded from the relay:
   * those are top-level concerns owned by the parent's own `execute()` call.
   */
  private buildObserverRelay(state: TState): ObserverRelay {
    // Bind to `this` so the relay holds a reference to the parent dispatcher.
    // Captures `state` for the worker-side hooks that need it.
    return {
      'onNodeStart': (nodeName: string, placementPath: readonly string[]) => {
        this.onNodeStart(nodeName, state, placementPath);
      },
      'onNodeEnd': (nodeName: string, output: string | null, placementPath: readonly string[]) => {
        this.onNodeEnd(nodeName, output, state, placementPath);
      },
      'onError': (nodeName: string, error: Error, placementPath: readonly string[]) => {
        this.onError(nodeName, error, state, placementPath);
      },
      'onPhaseEnter': (dagName: string, phase: 'pre' | 'post', placementName: string, placementPath: readonly string[]) => {
        this.onPhaseEnter(dagName, phase, placementName, state, placementPath);
      },
      'onPhaseExit': (dagName: string, phase: 'pre' | 'post', placementName: string, placementPath: readonly string[]) => {
        this.onPhaseExit(dagName, phase, placementName, state, placementPath);
      },
      'onContractWarning': (message: string) => {
        this.onContractWarning(message);
      },
    };
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
  getDAG(name: string): DAG | undefined {
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
  listDAGs(): readonly DAG[] {
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
   * `ExecutionResultInterface`). Sync-style is just
   * iteration that consumes every node before resolving.
   *
   * On abort (signal aborted, deadline expired, node threw, output
   * unwired) the iterator stops cleanly and the final result's `cursor`
   * carries the next node to run. State lifecycle records what happened.
   */
  execute(
    dagName: string,
    initialState: TState,
    options: ExecuteOptionsInterface = {},
  ): Execution<TState> {
    return new Execution<TState>(() => this.runNodes(dagName, initialState, null, options));
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
    options: ExecuteOptionsInterface = {},
  ): Execution<TState> {
    return new Execution<TState>(() => this.runNodes(dagName, state, fromStage, options));
  }

  /**
   * Canonical generator. Yields each node result (including the
   * intermediate yields from parallel / scatter nodes) and
   * returns the final `ExecutionResultInterface` with `cursor` set.
   * Never throws.
   *
   * `runOptions.embedded` is a private implementation detail for recursive
   * embedded-DAG re-entry. When `true`, lifecycle transitions (`markRunning`,
   * `markCompleted`) and flow hooks (`onFlowStart`, `onFlowEnd`) are
   * suppressed (those are top-level concerns owned by the consumer's
   * `execute()` / `resume()` call). Node hooks (`onNodeStart`, `onNodeEnd`,
   * `onError`) still fire for every child node.
   */
  private async *runNodes(
    dagName: string,
    state: TState,
    fromStage: string | null,
    options: ExecuteOptionsInterface,
    runOptions: _RunOptions = { 'embedded': false },
    placementPath: readonly string[] = [],
  ): AsyncGenerator<NodeResultInterface<TState>, ExecutionResultInterface<TState>, void> {
    const dag = this.dags.get(dagName);

    if (!dag) {
      // Unknown DAG: synthesize an error result without starting the
      // lifecycle. `state` may not have been touched yet, so don't mark
      // running. The cursor is null because there is no DAG to resume.
      const error = new DAGError(`Unknown DAG: ${dagName}`);
      this.onError('<unknown>', error, state, placementPath);
      if (!runOptions.embedded) {
        try { state.markFailed(error); } catch { /* state may already be terminal */ }
      }
      const result: ExecutionResultInterface<TState> = {
        'cursor': null, 'executedNodes': [], 'skippedNodes': [], state, 'terminalOutcome': null,
        'interruptedAt': null,
      };
      if (!runOptions.embedded) {
        this.onFlowEnd(dagName, state, result);
      }
      return result;
    }

    const signal = SignalComposer.compose(options);

    if (!runOptions.embedded) {
      // When resuming after a crash (fromStage !== null), the prior run may
      // have left the lifecycle in a terminal state (failed/cancelled/timed_out).
      // Reset to `pending` so `markRunning()` can re-enter the running state.
      // Lifecycle is not captured in snapshots; this reset is safe — the
      // checkpoint data (SCATTER_PROGRESS_KEY, etc.) is in metadata and survives.
      if (fromStage !== null && DAGLifecycleMachine.isTerminal(state.lifecycle)) {
        state.resetLifecycle();
      }
      state.markRunning();
      this.onFlowStart(dagName, state);
    }

    const executedNodes: string[] = [];
    const skippedNodes: string[] = [];
    let terminalNodeName: string | null = null;

    // --- Pre-phase placements --------------------------------------------------
    // Run before the entrypoint, in DAG declaration order. Suppressed when this
    // is a embedded-DAG re-entry; pre/post phases are top-level concerns owned by
    // the consumer's `execute()` / `resume()` call.
    if (!runOptions.embedded) {
      const prePhases = dag.nodes.filter(
        (n): n is PhaseNodePlacementInterface =>
          n['@type'] === 'PhaseNode' && n.phase === 'pre',
      );
      for (const phase of prePhases) {
        this.onPhaseEnter(dagName, 'pre', phase.name, state, placementPath);
        try {
          await this.executePhasePlacement(phase, state, dagName, signal);
          executedNodes.push(phase.name);
        } catch (err) {
          const error = err instanceof Error ? err : new ExecutionError(String(err));
          this.onError(phase.name, error, state, placementPath);
          try { state.markFailed(error); } catch { /* already terminal */ }
          this.onPhaseExit(dagName, 'pre', phase.name, state, placementPath);
          const result = this.buildResult(null, executedNodes, skippedNodes, null, null, state);
          await this.runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, placementPath);
          return result;
        }
        this.onPhaseExit(dagName, 'pre', phase.name, state, placementPath);
      }
    }

    let currentNodeName: null | string = fromStage ?? dag.entrypoint;
    let cursor: null | string = currentNodeName;
    let terminalOutcome: 'completed' | 'failed' | null = null;

    // Skip phase placements in the main loop; they are out-of-band and
    // never the entrypoint. If the consumer's fromStage / entrypoint happens
    // to name a phase placement, treat it as if the main loop is empty.
    const isPhaseEntry = (name: string): boolean => {
      const entry = this.nodeIndex.get(`${dagName}:${name}`);
      return entry?.['@type'] === 'PhaseNode';
    };
    if (currentNodeName !== null && isPhaseEntry(currentNodeName)) {
      currentNodeName = null;
      cursor = null;
    }

    mainLoop: while (currentNodeName !== null) {
      if (signal?.aborted) {
        const abortInfo = this.handleAbort(state, signal);
        this.onError(currentNodeName, abortInfo.error, state, placementPath);
        const interruptedAt: InterruptionInfo = {
          'nodeName': currentNodeName,
          'reason':   abortInfo.reason,
        };
        const result = this.buildResult(cursor, executedNodes, skippedNodes, terminalOutcome, interruptedAt, state);
        await this.runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, placementPath);
        return result;
      }

      const node = this.nodeIndex.get(`${dagName}:${currentNodeName}`);

      if (!node) {
        const error = new DAGError(`Unknown node: ${currentNodeName} in DAG ${dagName}`);
        this.onError(currentNodeName, error, state, placementPath);
        if (!runOptions.embedded) {
          try { state.markFailed(error); } catch { /* already terminal */ }
        }
        const result = this.buildResult(cursor, executedNodes, skippedNodes, terminalOutcome, null, state);
        await this.runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, placementPath);
        return result;
      }

      this.onNodeStart(node.name, state, placementPath);

      // TerminalNode is a no-op execution: capture outcome, synthesize result,
      // fire onNodeEnd, and break the loop. No call to executeDAGNode needed.
      if (Placement.isTerminal(node)) {
        const terminal = node;
        terminalOutcome = terminal.outcome;
        terminalNodeName = terminal.name;
        executedNodes.push(terminal.name);
        const terminalResult: NodeResultInterface<TState> = {
          'output': terminal.outcome,
          'skipped': false,
          'nodeName': terminal.name,
          state,
          'intermediateResults': [],
        };
        this.onNodeEnd(terminal.name, terminal.outcome, state, placementPath);
        yield terminalResult;
        break mainLoop;
      }

      let nodeOutcome: _InternalNodeResult<TState>;
      try {
        nodeOutcome = await this.executeDAGNode(node, state, dagName, signal, placementPath);
      } catch (caughtError) {
        const error = caughtError instanceof Error ? caughtError : new ExecutionError(String(caughtError));
        this.onError(currentNodeName, error, state, placementPath);
        let interruptedAt: InterruptionInfo | null = null;
        if (signal?.aborted) {
          // Run-level signal aborted: classify abort vs timeout via handleAbort.
          // handleAbort inspects signal.reason for TimeoutError, which
          // covers the run-level deadline TimeoutError. The per-node
          // `NodeTimeoutError` does NOT abort the parent signal; that
          // case is handled below.
          if (!runOptions.embedded) {
            const abortInfo = this.handleAbort(state, signal);
            interruptedAt = { 'nodeName': currentNodeName, 'reason': abortInfo.reason };
          } else {
            // Embedded-DAG: do not flip lifecycle, but still classify reason.
            const isTimeout = signal.reason instanceof Error && signal.reason.name === 'TimeoutError';
            interruptedAt = { 'nodeName': currentNodeName, 'reason': isTimeout ? 'timeout' : 'abort' };
          }
        } else if (error instanceof NodeTimeoutError) {
          // Per-node `timeoutMs` expired. The parent signal isn't aborted
          // (the deadline is scoped to a child controller), but the node
          // was interrupted by a timeout. Lifecycle becomes `failed` per
          // existing per-node-timeout semantics; record the cancellation
          // telemetry alongside.
          interruptedAt = { 'nodeName': currentNodeName, 'reason': 'timeout' };
          if (!runOptions.embedded && !DAGLifecycleMachine.isTerminal(state.lifecycle)) {
            try { state.markFailed(error); } catch { /* already terminal */ }
          }
        } else if (!runOptions.embedded && !DAGLifecycleMachine.isTerminal(state.lifecycle)) {
          try { state.markFailed(error); } catch { /* already terminal */ }
        }
        const result = this.buildResult(cursor, executedNodes, skippedNodes, terminalOutcome, interruptedAt, state);
        await this.runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, placementPath);
        return result;
      }

      const { nextStage, "result": nodeResult } = nodeOutcome;

      // Stream the per-step results a composite node (parallel / scatter /
      // embedded-DAG) produced internally, before the node's own result.
      // Empty for leaf nodes.
      for (const intermediate of nodeResult.intermediateResults) {
        yield intermediate;
      }

      if (nodeResult.skipped) {
        skippedNodes.push(nodeResult.nodeName);
      } else {
        executedNodes.push(nodeResult.nodeName);
      }

      this.onNodeEnd(node.name, nodeResult.output, state, placementPath);

      yield nodeResult;

      currentNodeName = nextStage;
      cursor = nextStage;
    }

    if (!runOptions.embedded) {
      if (terminalOutcome === 'failed') {
        try {
          state.markFailed(new DAGError(`Flow terminated at '${executedNodes[executedNodes.length - 1] ?? '<unknown>'}' with outcome=failed`));
        } catch { /* state may already be terminal */ }
      } else {
        // terminalOutcome === 'completed'; flows always end at a TerminalNode.
        try { state.markCompleted(); } catch { /* state may already be terminal */ }
      }
    }
    const result = this.buildResult(null, executedNodes, skippedNodes, terminalOutcome, null, state);
    await this.runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, placementPath);
    return result;
  }

  /**
   * Shared result-object constructor. Centralises the
   * `ExecutionResultInterface<TState>` shape so every exit branch in
   * `runNodes` returns an identically-shaped object (same key order, same
   * field set), keeping V8 hidden classes stable across success and error
   * paths.
   */
  private buildResult(
    cursor: string | null,
    executedNodes: string[],
    skippedNodes: string[],
    terminalOutcome: 'completed' | 'failed' | null,
    interruptedAt: InterruptionInfo | null,
    state: TState,
  ): ExecutionResultInterface<TState> {
    return {
      cursor,
      executedNodes,
      skippedNodes,
      state,
      terminalOutcome,
      interruptedAt,
    };
  }

  /**
   * Run every `phase: 'post'` placement in DAG declaration order, then
   * fire `onFlowEnd` + `instrumentation.flowEnd`. Suppressed when
   * `runOptions.embedded` is true; phase placements are top-level concerns owned
   * by the consumer's `execute()` / `resume()` call.
   *
   * Errors thrown by a post-phase placement are collected as warnings on
   * `state` (code `POST_PHASE_FAILED`) and do NOT change the already-set
   * lifecycle. Each post-phase that completes successfully is appended to
   * `result.executedNodes` (the array reference shared with the result).
   */
  private async runPostPhasesAndFinalize(
    dag: DAG,
    dagName: string,
    state: TState,
    result: ExecutionResultInterface<TState>,
    runOptions: _RunOptions,
    terminalNodeName: string | null,
    placementPath: readonly string[] = [],
  ): Promise<void> {
    if (runOptions.embedded) {
      return;
    }

    const postPhases = dag.nodes.filter(
      (n): n is PhaseNodePlacementInterface =>
        n['@type'] === 'PhaseNode' && n.phase === 'post',
    );
    for (const phase of postPhases) {
      this.onPhaseEnter(dagName, 'post', phase.name, state, placementPath);
      try {
        await this.executePhasePlacement(phase, state, dagName, null);
        result.executedNodes.push(phase.name);
      } catch (err) {
        const error = err instanceof Error ? err : new ExecutionError(String(err));
        // Post-phase intentionally runs without the parent abort signal (null)
        // so lifecycle has already been set; collect as warning, not re-throw.
        this.onError(phase.name, error, state, placementPath);
        state.collectWarning({
          'code':      'POST_PHASE_FAILED',
          'message':   `post-phase '${phase.name}' threw: ${error.message}`,
          'operation': phase.name,
          'timestamp': new Date().toISOString(),
        });
      }
      this.onPhaseExit(dagName, 'post', phase.name, state, placementPath);
    }
    this.onFlowEnd(dagName, state, result);

    // Hand-off channel publish: only for non-embedded top-level runs that
    // completed at a bound terminal. The in-process (no-channels) path is
    // byte-identical: when channels is empty this block is skipped entirely.
    if (terminalNodeName !== null) {
      const channel = this.channels[terminalNodeName];
      if (channel !== undefined) {
        const stateSnapshot = state.snapshot();
        const handoff: DAGHandoff = {
          'dagName': dagName,
          'terminalName': terminalNodeName,
          'terminalOutput': result.terminalOutcome ?? 'completed',
          'registryVersion': this.registryVersion,
          'correlationId': this.nextCorrelationId(dagName),
          'placementPath': [...placementPath],
          'stateSnapshot': stateSnapshot,
        };
        try {
          await channel.publish(handoff);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          state.collectError({
            'code': 'HANDOFF_PUBLISH_FAILED',
            'message': `Channel publish failed for terminal '${terminalNodeName}': ${error.message}`,
            'operation': terminalNodeName,
            'recoverable': false,
            'timestamp': new Date().toISOString(),
          });
          this.onError(terminalNodeName, error, state, placementPath);
        }
      }
    }
  }

  /**
   * Execute a single PhaseNode placement. Looks up the registered node by
   * `phase.node`, builds a node context, and invokes `node.execute(state,
   * ctx)` through `withNodeTimeout` so per-node timeouts apply uniformly.
   * Errors collected by the node are forwarded to `state` via
   * `state.collectError`. Throws when the registered node is not found or
   * when the node throws / times out.
   */
  private async executePhasePlacement(
    phase: PhaseNodePlacementInterface,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
  ): Promise<void> {
    const node = this.nodes.get(phase.node);
    if (node === undefined) {
      throw new DAGError(
        `PhaseNode '${phase.name}' references unknown registered node: ${phase.node}`,
      );
    }
    const result = await this.withNodeTimeout(node, signal, (nodeSignal) => {
      const context = this.buildContext(dagName, phase.name, nodeSignal);
      return node.execute(state, context);
    });
    for (const err of NodeOutputBuilder.errorsOf(result)) state.collectError(err);
  }

  /**
   * Build the per-node context. Falls back to a never-aborting signal
   * when no cancellation was requested. Carries the dispatcher's
   * services bag (or `undefined`) on the `services` field.
   */
  private buildContext(
    dagName: string,
    nodeName: string,
    signal: AbortSignal | null,
  ): NodeContextInterface<TServices> {
    return {
      'signal': signal ?? Dagonizer.NEVER_ABORT_SIGNAL,
      'dagName': dagName,
      nodeName,
      'services': this.services,
    };
  }

  /**
   * Inspect a triggered abort and mark the lifecycle terminal accordingly.
   * Returns the error to surface on the dispatcher boundary and the
   * `InterruptionInfo.reason` discriminant ('abort' vs 'timeout') so the
   * caller can populate `ExecutionResultInterface.interruptedAt`.
   */
  private handleAbort(state: TState, signal: AbortSignal): { 'error': Error; 'reason': 'abort' | 'timeout' } {
    const reason = signal.reason;
    const isTimeout = reason instanceof Error && reason.name === 'TimeoutError';
    if (isTimeout) {
      try { state.markTimedOut(); } catch { /* lifecycle already terminal */ }
      return { 'error': reason, 'reason': 'timeout' };
    }
    const message = reason instanceof Error
      ? reason.message
      : (typeof reason === 'string' ? reason : 'aborted');
    try { state.markCancelled(message); } catch { /* lifecycle already terminal */ }
    return {
      'error':  reason instanceof Error ? reason : new ExecutionError(message),
      'reason': 'abort',
    };
  }

  /**
   * Normalize any scatter source value — array, sync iterable, or async
   * iterable — to an `AsyncIterator<unknown>`. Arrays and sync iterables are
   * wrapped so the scatter loop has a single unified pull interface.
   */
  private static toAsyncIterator(source: unknown): AsyncIterator<unknown> {
    if (source !== null && typeof source === 'object') {
      // AsyncIterable first (duck-type Symbol.asyncIterator).
      if (Symbol.asyncIterator in (source as object)) {
        return (source as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      }
      // Sync iterable (duck-type Symbol.iterator), including arrays.
      if (Symbol.iterator in (source as object)) {
        const syncIter = (source as Iterable<unknown>)[Symbol.iterator]();
        return {
          next(): Promise<IteratorResult<unknown>> {
            return Promise.resolve(syncIter.next());
          },
        };
      }
    }
    // Scalar or null/undefined: treat as empty.
    return {
      next(): Promise<IteratorResult<unknown>> {
        return Promise.resolve({ 'value': undefined, 'done': true });
      },
    };
  }

  /**
   * Execute an embedded-DAG placement: run the referenced sub-DAG in an
   * isolated child state clone (cardinality 1), propagate errors/warnings
   * to the parent, apply `stateMapping.output` back to the parent, and
   * route via the terminal-propagating reducer.
   *
   * State bridging mirrors the scatter seed (`stateMapping.input`) but adds a
   * copy-back the fork has no use for:
   * - `stateMapping.input` (child key → parent path) seeds the child clone
   *   before the sub-DAG runs (the same field scatter uses to seed each clone).
   * - `stateMapping.output` (parent path → child key) merges child state
   *   back into the parent after completion (via `mapOutputState`).
   * - Terminal propagation: if the child run's `terminalOutcome` is `'failed'`
   *   or any unrecoverable error exists, route `'error'`; otherwise `'success'`.
   * - Lifecycle scoping: `runOptions.embedded: true` suppresses lifecycle transitions
   *   and flow hooks on the child run (those are top-level concerns).
   * - `placementPath`: extended with the placement name so inner node hooks
   *   receive accurate nesting context.
   */
  private async executeEmbeddedDAG(
    placement: EmbeddedDAGNode,
    state: TState,
    signal: AbortSignal | null,
    placementPath: readonly string[],
  ): Promise<_InternalNodeResult<TState>> {
    const inputMapping = placement.stateMapping?.input ?? {};
    const outputMapping = placement.stateMapping?.output ?? {};
    const innerPath: readonly string[] = [...placementPath, placement.name];

    const cloneState = this.stateMapper.createChild(state, inputMapping);
    const intermediateResults: Array<NodeResultInterface<TState>> = [];
    let terminalOutcome: 'completed' | 'failed' | null;

    const container = this.resolveContainer(placement.container);

    if (container === null) {
      // ── In-process path (byte-identical to the original) ───────────────────
      const childOptions: ExecuteOptionsInterface = { ...(signal !== null && { 'signal': signal }) };
      const iter = this.runNodes(placement.dag, cloneState, null, childOptions, { 'embedded': true }, innerPath);

      let step = await iter.next();
      while (!step.done) {
        const nr = step.value;
        const intermediate: NodeResultInterface<TState> = {
          'output': nr.output,
          'skipped': nr.skipped,
          'nodeName': `${placement.name}.${nr.nodeName}`,
          state,
          'intermediateResults': [],
        };
        intermediateResults.push(intermediate);
        step = await iter.next();
      }
      terminalOutcome = step.value.terminalOutcome;
    } else {
      // ── Contained path ─────────────────────────────────────────────────────
      const correlationId = this.nextCorrelationId(placement.dag);
      const context = this.buildContext(placement.dag, placement.name, signal);
      const task = new DagTask<TState, TServices>(
        placement.dag,
        innerPath,
        correlationId,
        null,
        cloneState,
        context,
      );

      const relay = this.buildObserverRelay(state);
      const outcome = await container.runDag(task, relay);

      // Embedded DAG is cardinality-1 (not inbox-backed), so an infrastructure
      // failure does NOT throw — Law 3 requires host crash / transport loss to
      // surface as a collected error routed like any node failure, never an
      // unhandled throw. The transport-error outcome carries an unrecoverable
      // NodeError; collecting it below makes hasUnrecoverable true and routes
      // this placement to its 'error' output. No silent success.

      // Apply terminal state snapshot back to clone for domain state (in-place;
      // parent state identity is preserved: result.state === initialState
      // invariant holds). outcome.errors is the single authoritative error
      // channel — always collect it regardless of whether a snapshot is present.
      // Errors are intentionally not serialized into the snapshot; the snapshot
      // carries domain state only (metadata, retries, warnings, subclass fields).
      if (outcome.stateSnapshot !== null) {
        cloneState.applySnapshot(outcome.stateSnapshot);
      }
      for (const err of outcome.errors) cloneState.collectError(err);

      // Re-yield each intermediate as a NodeResultInterface.
      for (const wi of outcome.intermediates) {
        intermediateResults.push({
          'output': wi.output,
          'skipped': wi.skipped,
          'nodeName': `${placement.name}.${wi.nodeName}`,
          state,
          'intermediateResults': [],
        });
      }

      // Derive terminalOutcome from terminalOutput.
      terminalOutcome = outcome.terminalOutput === 'failed' ? 'failed' : 'completed';
    }

    // ── Common tail (shared between both branches) ──────────────────────────
    // Propagate errors and warnings from child to parent.
    for (const err of cloneState.errors) state.collectError(err);
    for (const warn of cloneState.warnings) state.collectWarning(warn);

    // Apply output state mapping: child → parent.
    this.stateMapper.mapOutput(cloneState, state, outputMapping);

    const hasUnrecoverable = cloneState.errors.some((e) => e.recoverable === false);
    const routeOutput = (terminalOutcome === 'failed' || hasUnrecoverable) ? 'error' : 'success';
    const nextStage = placement.outputs[routeOutput] ?? null;

    const result: NodeResultInterface<TState> = {
      'output': routeOutput,
      'skipped': false,
      'nodeName': placement.name,
      state,
      intermediateResults,
    };

    return { nextStage, result };
  }

  /**
   * Execute a scatter placement with a unified streaming executor.
   *
   * The scatter source (array, `Iterable`, or `AsyncIterable`) is normalised
   * to an `AsyncIterator` via `Dagonizer.toAsyncIterator`. A bounded worker
   * pool (max in-flight = `scatter.concurrency`) pulls items lazily — a new
   * item is only pulled once a worker slot frees up (true backpressure). Array
   * sources are treated as finite producers and behave identically to streaming
   * producers; there is no separate batch loop.
   *
   * **Durable-inbox checkpoint model.** As each item is pulled it enters a
   * persisted inbox (`ScatterInboxItem[]`). The inbox carries the actual item
   * payload so that a streaming source does not need to be rewound on resume.
   * When a body completes successfully the item is removed from the inbox and
   * its result is added to `ackedResults`. On crash/resume the inbox items are
   * reprocessed first (as the priority source), then any remaining source
   * items continue normally.
   *
   * **Incremental gather.** Strategies that implement `applyIncremental` fold
   * each completed record into parent state as it arrives. Strategies without
   * `applyIncremental` (e.g. `custom`) accumulate records and call `apply`
   * once at the end.
   *
   * Resume bookkeeping is persisted under {@link SCATTER_PROGRESS_KEY}.
   */
  private async executeScatter(
    scatter: ScatterNode,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
    placementPath: readonly string[],
  ): Promise<_InternalNodeResult<TState>> {
    // ── 1. Resolve source ────────────────────────────────────────────────────
    const raw = this.accessor.get(state, scatter.source);

    // Empty / absent source: skip immediately.
    const isEmpty = raw === null || raw === undefined ||
      (Array.isArray(raw) && raw.length === 0);
    if (isEmpty) {
      const reducerName = scatter.reducer ?? 'aggregate';
      const routeOutput = OutcomeReducers.resolve(reducerName).reduce([]);
      const nextStage = scatter.outputs[routeOutput] ?? null;
      const result: NodeResultInterface<TState> = {
        'output': routeOutput,
        'skipped': true,
        'nodeName': scatter.name,
        state,
        'intermediateResults': [],
      };
      return { nextStage, result };
    }

    const itemKey = scatter.itemKey ?? 'currentItem';
    // Default concurrency: unbounded for arrays (backwards compat) — all items
    // run concurrently unless scatter.concurrency is set.
    const concurrencyLimit = scatter.concurrency ?? (Array.isArray(raw) ? raw.length : 1);

    // ── 2. Restore checkpoint (inbox model) ─────────────────────────────────
    // ScatterCheckpoint.read validates the raw metadata value at the boundary
    // so corrupt or migrated checkpoints throw ValidationError here rather
    // than causing silent type mismatches deep in the scatter loop.
    const storedProgress = ScatterCheckpoint.read(state, scatter.name);

    // Mutable inbox: items pulled but not yet acked.
    // Seed from checkpoint on resume, drain first.
    const inbox: ScatterInboxItem[] = [...(storedProgress?.inbox ?? [])];

    // Acked results: items that completed in a prior run.
    const ackedResults: ScatterAckedResult[] = [...(storedProgress?.ackedResults ?? [])];

    // Index for quick lookup by index number.
    const ackedByIndex = new Map<number, ScatterAckedResult>();
    for (const r of ackedResults) ackedByIndex.set(r.index, r);

    // Determine which index to assign to the next pulled item.
    // Start after the highest index seen (inbox + acked).
    let nextIndex = 0;
    for (const item of [...inbox, ...ackedResults]) {
      if (item.index >= nextIndex) nextIndex = item.index + 1;
    }

    // ── 3. Gather strategy and incremental fold ──────────────────────────────
    const gatherStrategy = scatter.gather !== undefined
      ? GatherStrategies.resolve(scatter.gather.strategy)
      : null;
    const supportsIncremental = gatherStrategy?.applyIncremental !== undefined;

    // Accumulate fresh records; used only by strategies without applyIncremental
    // and for the final outcome-reducer pass.
    const allFreshRecords: GatherRecord<TState>[] = [];
    const intermediateResults: Array<NodeResultInterface<TState>> = [];
    const itemOutputs = new Map<number, string>();
    // Populate itemOutputs from prior acked results.
    for (const r of ackedResults) itemOutputs.set(r.index, r.output);

    // NOTE: For incremental gather strategies (applyIncremental defined), the
    // gather contributions from acked items are already present in the state
    // snapshot (they were folded per-ack during the prior run). No replay is
    // needed here. The batch-only path at step 7 handles reconstruction for
    // non-incremental strategies.

    // ── 4. Build the source async iterator ──────────────────────────────────
    // Priority source: inbox items from a prior run come first.
    // inbox items were already pulled from the source; their payloads are stored.
    let inboxPos = 0;
    // AsyncIterator<ScatterInboxItem, undefined>: the second type param declares
    // that the done-branch value is `undefined`, so no cast is needed there.
    const inboxIter: AsyncIterator<ScatterInboxItem, undefined> = {
      next(): Promise<IteratorResult<ScatterInboxItem, undefined>> {
        if (inboxPos >= inbox.length) {
          return Promise.resolve({ 'value': undefined, 'done': true });
        }
        const entry = inbox[inboxPos++];
        if (entry === undefined) {
          return Promise.resolve({ 'value': undefined, 'done': true });
        }
        return Promise.resolve({ 'value': entry, 'done': false });
      },
    };
    // Fresh source: new items from the actual source value.
    //
    // For index-stable sources (arrays, sync iterables) items are pulled
    // sequentially and assigned indices 0, 1, 2, … by position.
    // On resume, items whose position-index is already in seenIndices
    // (acked or inbox) must be consumed from the iterator without spawning
    // a worker; their work is already tracked.
    //
    // For async-iterable sources the consumer provides an iterator already
    // positioned at the correct continuation point (it should yield only
    // the remaining, un-processed items). No positional skip is applied;
    // items are indexed starting from nextIndex as they arrive.
    const isIndexStableSource = raw !== null && typeof raw === 'object' &&
      Symbol.iterator in (raw as object) &&
      !(Symbol.asyncIterator in (raw as object));

    // All indices already accounted for (acked + inbox from prior run).
    const seenIndices = new Set<number>();
    for (const r of ackedResults) seenIndices.add(r.index);
    for (const entry of inbox) seenIndices.add(entry.index);

    const rawIter = Dagonizer.toAsyncIterator(raw);

    // For index-stable sources on resume: consume items from positions 0 to
    // (nextIndex-1) from the raw source. Items whose position is in seenIndices
    // are silently dropped (already handled). Items NOT in seenIndices were not
    // processed in the prior run (gap in the acked set); add them to the inbox
    // with their canonical index so the pool re-processes them.
    // After this pre-scan, the raw iterator is positioned at nextIndex and ready
    // for normal sequential assignment.
    if (isIndexStableSource && seenIndices.size > 0) {
      for (let pos = 0; pos < nextIndex; pos++) {
        const step = await rawIter.next();
        if (step.done) { break; }
        if (!seenIndices.has(pos)) {
          // Gap: this position was never processed. Add to inbox for reprocessing.
          inbox.push({ 'index': pos, 'item': step.value });
        }
      }
      // Reset inboxPos so inboxIter starts from the beginning (which now
      // includes any gap items just discovered plus the original inbox items).
      inboxPos = 0;
    }

    // Wrap the pre-scanned (or fresh) raw iterator for use in pullNext.
    const freshIter = rawIter;

    // ── 5. Bounded worker pool with lazy pull ────────────────────────────────
    // The pool pulls from inboxIter first (priority), then freshIter.
    // It only pulls the next item when a worker slot is free (backpressure).
    let inboxDone = false;
    let freshDone = false;
    let activeWorkers = 0;
    // R7: accumulate all worker errors — never silently drop concurrent failures
    // by overwriting. The first error is thrown after the drain loop; the full
    // list is available if callers want aggregate diagnostics.
    const poolErrors: unknown[] = [];

    // Promise-based semaphore: resolves when a slot frees.
    let slotResolve: (() => void) | null = null;
    const waitForSlot = (): Promise<void> =>
      new Promise<void>((res) => { slotResolve = res; });
    const releaseSlot = (): void => {
      const fn = slotResolve;
      slotResolve = null;
      fn?.();
    };

    /**
     * Pull the next item from inbox (priority) then fresh source.
     * Returns `null` when both sources are exhausted.
     * A pulled inbox item has `type: 'inbox'`; its index comes from
     * `ScatterInboxItem.index`. A fresh item has `type: 'fresh'`; its
     * index is assigned from `nextIndex`.
     */
    const pullNext = async (): Promise<
      | { 'type': 'inbox'; 'index': number; 'item': unknown }
      | { 'type': 'fresh'; 'index': number; 'item': unknown }
      | null
    > => {
      if (!inboxDone) {
        const step = await inboxIter.next();
        if (!step.done) {
          return { 'type': 'inbox', 'index': step.value.index, 'item': step.value.item };
        }
        inboxDone = true;
      }
      if (!freshDone) {
        const step = await freshIter.next();
        if (!step.done) {
          const index = nextIndex++;
          // Add to inbox immediately (durable: pulled but not yet acked).
          inbox.push({ index, 'item': step.value });
          return { 'type': 'fresh', index, 'item': step.value };
        }
        freshDone = true;
      }
      return null;
    };

    /**
     * Execute one scatter item (the body) and return a completed record.
     * Handles both node and dag body variants. Does not mutate shared
     * state — callers handle ack and gather after this resolves.
     */
    const executeItem = async (
      itemIndex: number,
      item: unknown,
    ): Promise<{
      'index': number;
      'item': unknown;
      'output': string;
      'terminalOutcome': 'completed' | 'failed' | null;
      'cloneState': TState;
    }> => {
      const cloneState = this.stateMapper.createChild(
        state,
        scatter.stateMapping?.input ?? {},
      );
      // item must be JSON-serialisable: scatter sources are checkpointed to
      // metadata (SCATTER_PROGRESS_KEY) and require JSON-safe values at
      // snapshot time. The engine contract requires callers to provide
      // JSON-safe scatter sources for checkpointing to succeed.
      cloneState.setMetadata(itemKey, item);
      cloneState.setMetadata('itemIndex', itemIndex);

      let output: string;
      let terminalOutcome: 'completed' | 'failed' | null = null;

      if ('node' in scatter.body) {
        const dagNode = this.nodes.get(scatter.body.node);
        if (!dagNode) {
          throw new DAGError(`ScatterNode '${scatter.name}': unknown node '${scatter.body.node}'`);
        }
        const opResult = await this.withNodeTimeout(dagNode, signal, (nodeSignal) => {
          const context = this.buildContext(dagName, scatter.name, nodeSignal);
          return dagNode.execute(cloneState, context);
        });
        for (const err of NodeOutputBuilder.errorsOf(opResult)) cloneState.collectError(err);
        output = opResult.output;
      } else {
        // DAG body — may run in-process or through a bound container.
        const innerPath: readonly string[] = [...placementPath, scatter.name];
        const container = this.resolveContainer(scatter.container);

        if (container === null) {
          // ── In-process path (byte-identical to the original) ─────────────────
          const childOptions: ExecuteOptionsInterface = { ...(signal !== null && { 'signal': signal }) };
          const iter = this.runNodes(scatter.body.dag, cloneState, null, childOptions, { 'embedded': true }, innerPath);

          while (true) {
            const step = await iter.next();
            if (step.done) {
              terminalOutcome = step.value.terminalOutcome;
              break;
            }
            const nr = step.value;
            intermediateResults.push({
              'output': nr.output,
              'skipped': nr.skipped,
              'nodeName': `${scatter.name}.${nr.nodeName}`,
              state,
              'intermediateResults': [],
            });
          }
        } else {
          // ── Contained path ───────────────────────────────────────────────────
          const correlationId = this.nextCorrelationId(scatter.body.dag);
          const context = this.buildContext(scatter.body.dag, scatter.name, signal);
          const task = new DagTask<TState, TServices>(
            scatter.body.dag,
            innerPath,
            correlationId,
            null,
            cloneState,
            context,
          );

          const scatterRelay = this.buildObserverRelay(state);
          const outcome = await container.runDag(task, scatterRelay);

          // Infrastructure/transport failure (worker died, channel lost): the
          // child DAG never ran to a terminal. Throw so spawnWorker takes the
          // reject branch → poolError set → item is NOT acked → it stays in the
          // inbox → resume reprocesses it. This matches the in-process path
          // (a body crash throws) and preserves at-least-once. A legitimate
          // body that ran and routed to 'error' (terminalOutput 'failed' from a
          // TerminalNode) is NOT an infrastructure failure and acks normally.
          if (outcome.errors.some((e) => TransportErrorCode.isInfrastructureFailure(e.code))) {
            const infra = outcome.errors.find((e) => TransportErrorCode.isInfrastructureFailure(e.code));
            throw new ExecutionError(
              `ScatterNode '${scatter.name}': container infrastructure failure — ${infra?.message ?? 'transport lost'}`,
            );
          }

          // Apply terminal state snapshot back to clone for domain state.
          // outcome.errors is the single authoritative error channel — always
          // collect it regardless of whether a snapshot is present. Errors are
          // intentionally not serialized into the snapshot; the snapshot carries
          // domain state only (metadata, retries, warnings, subclass fields).
          // Infrastructure failures throw above; the null case here handles any
          // non-infrastructure container that cannot produce a snapshot.
          if (outcome.stateSnapshot !== null) {
            cloneState.applySnapshot(outcome.stateSnapshot);
          }
          for (const err of outcome.errors) cloneState.collectError(err);

          // Re-yield each intermediate as a NodeResultInterface with scatter prefix.
          for (const wi of outcome.intermediates) {
            intermediateResults.push({
              'output': wi.output,
              'skipped': wi.skipped,
              'nodeName': `${scatter.name}.${wi.nodeName}`,
              state,
              'intermediateResults': [],
            });
          }

          // Derive terminalOutcome from the container's terminal output.
          terminalOutcome = outcome.terminalOutput === 'failed' ? 'failed' : 'completed';
        }

        const hasUnrecoverable = cloneState.errors.some((e) => e.recoverable === false);
        output = (terminalOutcome === 'failed' || hasUnrecoverable) ? 'error' : 'success';
      }

      for (const err of cloneState.errors) state.collectError(err);
      for (const warn of cloneState.warnings) state.collectWarning(warn);

      return { 'index': itemIndex, item, output, terminalOutcome, cloneState };
    };

    /**
     * Ack a completed item: remove it from the inbox, add to ackedResults,
     * persist the checkpoint, and apply incremental gather if supported.
     */
    const ackItem = (
      itemIndex: number,
      item: unknown,
      output: string,
      terminalOutcome: 'completed' | 'failed' | null,
      cloneState: TState,
    ): GatherRecord<TState> => {
      // Remove from inbox.
      const inboxIdx = inbox.findIndex((e) => e.index === itemIndex);
      if (inboxIdx !== -1) inbox.splice(inboxIdx, 1);

      // Build acked result with gather persistence values.
      // SC-8: discriminated union keyed on `kind`.
      const ackedResult: ScatterAckedResult = (() => {
        if (scatter.gather?.strategy === 'map' && scatter.gather.mapping !== undefined) {
          const snapshot: Record<string, unknown> = {};
          for (const clonePath of Object.keys(scatter.gather.mapping)) {
            snapshot[clonePath] = this.accessor.get(cloneState, clonePath);
          }
          return { 'kind': 'map' as const, 'index': itemIndex, 'item': item, output, 'mappingValues': snapshot };
        }
        if (
          (scatter.gather?.strategy === 'append' || scatter.gather?.strategy === 'partition') &&
          scatter.gather.field !== undefined
        ) {
          return { 'kind': 'field' as const, 'index': itemIndex, 'item': item, output, 'fieldValue': this.accessor.get(cloneState, scatter.gather.field) };
        }
        return { 'kind': 'plain' as const, 'index': itemIndex, 'item': item, output };
      })();

      ackedResults.push(ackedResult);
      ackedByIndex.set(itemIndex, ackedResult);
      itemOutputs.set(itemIndex, output);

      const record: GatherRecord<TState> = {
        'index': itemIndex,
        item,
        output,
        terminalOutcome,
        cloneState,
      };

      // Incremental gather: fold this record into parent state BEFORE the
      // checkpoint write so the persisted state already reflects the fold.
      // This ensures any observer of the metadata write (e.g. tests, monitoring)
      // sees a consistent state: gather target updated, then checkpoint written.
      if (supportsIncremental && scatter.gather !== undefined && gatherStrategy?.applyIncremental !== undefined) {
        gatherStrategy.applyIncremental(scatter.gather, record, state, this.accessor);
      } else {
        // Accumulate for batch apply at the end.
        allFreshRecords.push(record);
      }

      // Persist checkpoint after the incremental fold (so gathered state is
      // already captured in the state snapshot that backs the metadata write).
      ScatterCheckpoint.write(state, scatter.name, [...inbox], [...ackedResults]);

      return record;
    };

    // ── 6. Drive the worker pool ─────────────────────────────────────────────
    // Uses a promise-chaining loop: spawn workers up to concurrencyLimit,
    // each worker pulls from pullNext() and releases a slot on completion.
    // The outer loop waits for a slot before pulling the next item.

    const workerDone = (): void => {
      activeWorkers--;
      releaseSlot();
    };

    const spawnWorker = (itemIndex: number, item: unknown): void => {
      activeWorkers++;
      const workerPromise = executeItem(itemIndex, item).then(
        (res) => {
          ackItem(res.index, res.item, res.output, res.terminalOutcome, res.cloneState);
          workerDone();
        },
        (err: unknown) => {
          // R7: push to accumulator — never overwrite; concurrent failures all preserved.
          poolErrors.push(err);
          workerDone();
        },
      );
      // Attach a no-op catch so the promise is always handled.
      workerPromise.catch(() => { /* handled above */ });
    };

    // Pull loop: keeps filling slots until both sources are exhausted, a worker
    // error is set, or the run-level signal is aborted.
    // R1: `signal?.aborted !== true` — exit before pulling more items when the
    // caller has cancelled; this prevents the loop from draining the full source
    // and silently acking items that never ran their body.
    while (poolErrors.length === 0 && signal?.aborted !== true) {
      if (activeWorkers >= concurrencyLimit) {
        await waitForSlot();
        continue;
      }
      const pulled = await pullNext();
      if (pulled === null) break; // both sources exhausted
      spawnWorker(pulled.index, pulled.item);
    }

    // Wait for all in-flight workers to settle.
    while (activeWorkers > 0) {
      await waitForSlot();
    }

    // R1: if the signal was aborted and no worker error caused the exit, throw
    // BEFORE ScatterCheckpoint.clear() so the checkpoint is preserved on state.
    // The caller's runNodes catch block will handle lifecycle marking.
    if (signal?.aborted === true && poolErrors.length === 0) {
      throw ExecutionError.fromSignal(signal);
    }

    if (poolErrors.length > 0) {
      // Throw the first error; remaining errors are silently present in poolErrors
      // but the aggregate is captured so they are never lost.
      const first = poolErrors[0];
      throw first instanceof Error ? first : new ExecutionError(String(first));
    }

    // ── 7. Synthesise acked records that came from a prior run ───────────────
    // Strategies using incremental gather only saw fresh records; acked-only
    // records (from a prior run that used incremental gather) were already
    // folded into parent state by the previous run — they are not re-gathered.
    // For batch-only strategies (e.g. custom) we must reconstruct the full
    // record set in source-index order.
    if (!supportsIncremental && scatter.gather !== undefined) {
      // Build synthetic records for acked items that were NOT re-executed
      // (i.e. items present in ackedResults but not in allFreshRecords).
      const freshIndices = new Set<number>(allFreshRecords.map((r) => r.index));
      const syntheticRecords: GatherRecord<TState>[] = [];
      for (const acked of ackedResults) {
        if (freshIndices.has(acked.index)) continue; // already in allFreshRecords
        // SC-1: clone() returns `this` — no cast needed after node-state cluster applies SC-1.
        const syntheticClone = state.clone() as TState;
        // SC-8: switch on `kind` discriminant instead of checking optional fields.
        if (acked.kind === 'map') {
          for (const [clonePath, val] of Object.entries(acked.mappingValues)) {
            this.accessor.set(syntheticClone, clonePath, val);
          }
        } else if (acked.kind === 'field' && scatter.gather.field !== undefined) {
          this.accessor.set(syntheticClone, scatter.gather.field, acked.fieldValue);
        }
        // kind === 'plain': gather value is item itself; no clone mutation needed.
        syntheticRecords.push({
          'index': acked.index,
          'item': acked.item,
          'output': acked.output,
          'terminalOutcome': null,
          'cloneState': syntheticClone,
        });
      }
      // Merge synthetic + fresh, sorted by index.
      const merged = [...syntheticRecords, ...allFreshRecords]
        .sort((a, b) => a.index - b.index);

      if (merged.length > 0) {
        const gatherExecution = this.buildGatherExecution(state, merged, dagName, signal);
        await GatherStrategies.resolve(scatter.gather.strategy).apply(scatter.gather, gatherExecution);
      }
    }

    // ── 8. Clear checkpoint after clean completion ───────────────────────────
    ScatterCheckpoint.clear(state, scatter.name);

    // ── 9. Reduce to route ───────────────────────────────────────────────────
    const reducerName = scatter.reducer ?? 'aggregate';
    const outcomeRecords: OutcomeRecord[] = [];
    for (const [index, output] of itemOutputs) {
      // terminalOutcome is not tracked in itemOutputs; use null for all (reducer
      // does not need it for aggregate/fail-fast modes).
      outcomeRecords.push({ index, output, 'terminalOutcome': null });
    }
    const routeOutput = OutcomeReducers.resolve(reducerName).reduce(outcomeRecords);
    const nextStage = scatter.outputs[routeOutput] ?? null;

    const result: NodeResultInterface<TState> = {
      'output': routeOutput,
      'skipped': false,
      'nodeName': scatter.name,
      state,
      intermediateResults,
    };

    return { nextStage, result };
  }

  /**
   * Build the per-gather execution context handed to a `GatherStrategy`.
   */
  private buildGatherExecution(
    state: TState,
    records: ReadonlyArray<GatherRecord<TState>>,
    dagName: string,
    signal: AbortSignal | null,
  ): GatherExecution<TState> {
    const invoker = new GatherNodeInvoker(
      (nodeName) => this.nodes.has(nodeName),
      async (nodeName) => {
        const dagNode = this.nodes.get(nodeName);
        if (dagNode === undefined) return;
        const context = this.buildContext(dagName, nodeName, signal);
        await dagNode.execute(state, context);
      },
    );
    return {
      state,
      records,
      dagName,
      signal,
      'accessor': this.accessor,
      invoker,
    };
  }


  /**
   * Wrap a node execute call with a per-node timeout when `dagNode.timeoutMs`
   * is set. Derives a child `AbortController` from the run's signal, arms a
   * Scheduler timer, and races the node's execute against a deadline rejection.
   *
   * The child signal is passed to the node so signal-aware IO (fetch, retry)
   * also cancels. Nodes that do not observe the signal are hard-stopped by the
   * race. On expiry `NodeTimeoutError` propagates; `executeSingleNode` re-throws
   * so the `runNodes` catch block fires `onError` and marks state failed.
   *
   * Timer and parent-abort listener are cleaned up in `finally`.
   */
  private async withNodeTimeout<TResult>(
    dagNode: NodeInterface<TState, string, TServices>,
    parentSignal: AbortSignal | null,
    fn: (signal: AbortSignal) => Promise<TResult>,
  ): Promise<TResult> {
    const { timeoutMs } = dagNode;

    if (timeoutMs === undefined) {
      // No per-node budget; pass parent signal through unchanged.
      const sig = parentSignal ?? Dagonizer.NEVER_ABORT_SIGNAL;
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

    const timeoutError = new NodeTimeoutError(dagNode.name, timeoutMs);

    // Deadline race: resolves when time elapses (child not yet aborted),
    // rejects immediately if child is already aborted (parent propagation).
    // The Scheduler is swappable via VirtualScheduler in tests.
    let deadlineReject!: (reason: Error) => void;
    const deadlinePromise = new Promise<never>((_resolve, reject) => {
      deadlineReject = reject;
    });

    const schedulerPromise = Scheduler.current()
      .after(timeoutMs, { 'signal': childCtrl.signal })
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

  private async executeSingleNode(
    nodeConfig: SingleNodePlacementInterface,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
  ): Promise<_InternalNodeResult<TState>> {
    const dagNode = this.nodes.get(nodeConfig.node);

    if (!dagNode) {
      throw new DAGError(`Unknown node: ${nodeConfig.node}`);
    }

    const opResult = await this.withNodeTimeout(dagNode, signal, (nodeSignal) => {
      const context = this.buildContext(dagName, nodeConfig.name, nodeSignal);
      return dagNode.execute(state, context);
    });

    for (const error of NodeOutputBuilder.errorsOf(opResult)) state.collectError(error);

    const nextStage = nodeConfig.outputs[opResult.output];

    if (nextStage === undefined) {
      throw new DAGError(`Node ${dagNode.name} returned output '${opResult.output}' but node ${nodeConfig.name} has no routing for it. `
        + `Available outputs: ${Object.keys(nodeConfig.outputs).join(', ')}`);
    }

    const result: NodeResultInterface<TState> = {
      'output': opResult.output,
      'skipped': false,
      'nodeName': nodeConfig.name,
      state,
      'intermediateResults': [],
    };

    return {
      nextStage,
      result
    };
  }

  private async executeDAGNode(
    entry: DAGNodeType,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
    placementPath: readonly string[],
  ): Promise<_InternalNodeResult<TState>> {
    const handler = this.dispatch[entry['@type']];
    if (handler === undefined) {
      throw new DAGError(`Unknown node type: ${entry['@type']}`);
    }
    return handler(entry, state, dagName, signal, placementPath);
  }


  /**
   * Register a DAG configuration.
   *
   * Runs two validation passes:
   * 1. Schema pass: `Validator.dag.validate(dag)` checks structure (required fields, valid
   *    `type` and `strategy` enumerations).
   * 2. Semantic pass: verifies entrypoint exists, all node references are resolvable,
   *    no circular embedded-DAG references, and every registered node output has a routing
   *    entry in the placement's `outputs` map.
   */
  registerDAG(dag: DAG): void {
    // Schema pre-pass: catches malformed JSON (missing fields, wrong
    // node `type`, gather strategy mismatch) before semantic validation
    // surfaces node/DAG cross-references.
    Validator.dag.validate(dag);

    DAGValidator.validateDAGConfig(dag, this.nodes, this.dags);

    // Contract validation: for each placement whose backing operation node
    // carries a co-located `contract`, run dangling-read / dead-write checks.
    // Dangling reads throw DAGError; dead writes call onContractWarning.
    //
    // A `SingleNode` is keyed by its `node` field. An `EmbeddedDAGNode` or
    // `ScatterNode` runs an operation registered under the placement's own
    // name (the deriver names the placement after the operation), so its
    // contract — and therefore its `produces` — is resolved by placement name.
    // Without this, an operation rendered as an embedded/scatter placement
    // would be dropped from the contract graph and a downstream node reading
    // its output would be flagged as a dangling read.
    const contractBearingNodes = dag.nodes
      .map((placement) => {
        if (Placement.isSingle(placement)) return this.nodes.get(placement.node);
        if (Placement.isEmbeddedDAG(placement) || Placement.isScatter(placement)) return this.nodes.get(placement.name);
        return undefined;
      })
      .filter((node): node is NodeInterface<TState, string, TServices> => node?.contract !== undefined);

    if (contractBearingNodes.length > 0) {
      const contracts = contractBearingNodes.map((node) => {
        const contract = node.contract;
        if (contract === undefined) return null;
        return { 'name': node.name, 'outputs': node.outputs, 'hardRequired': contract.hardRequired, 'produces': contract.produces };
      }).filter((c): c is Exclude<typeof c, null> => c !== null);
      try {
        ContractRegistryValidator.validate(
          contracts,
          new DispatcherWarningEmitter((msg) => { this.onContractWarning(msg); }),
          { 'entrypointName': dag.entrypoint },
        );
      } catch (err) {
        throw err instanceof Error ? err : new DAGError(String(err));
      }
    }

    this.dags.set(dag.name, dag);
    for (const node of dag.nodes) {
      // DAGNodeType = DAG['nodes'][number] — node already satisfies the type.
      this.nodeIndex.set(`${dag.name}:${node.name}`, node);
    }

    // Emit contractWarning for placements that declare a container role that is
    // not bound in this.containers. Those placements will fall back to in-process.
    for (const placement of dag.nodes) {
      const containerRole = 'container' in placement ? placement.container : undefined;
      if (containerRole !== undefined && this.resolveContainer(containerRole) === null) {
        const msg = `DAG '${dag.name}' placement '${placement.name}' declares container role '${containerRole}' which is not bound; resolving to in-process`;
        this.onContractWarning(msg);
      }
    }
  }

  /**
   * Parse JSON and validate against `DAGSchema`. The single permitted
   * ingest boundary where `unknown` enters the package.
   *
   * Throws `ValidationError` for malformed JSON or schema-noncompliant input.
   */
  static load(json: string): DAG {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ValidationError(`Invalid JSON: ${message}`);
    }
    return Validator.dag.validate(parsed);
  }

  /**
   * Parse an already-decoded value and validate. Same boundary semantics
   * as `load` but skips JSON.parse for callers that have already decoded.
   */
  static fromValue(value: unknown): DAG {
    return Validator.dag.validate(value);
  }

  /** Serialize a DAG to pretty JSON (2-space indent). */
  static serialize(dag: DAG): string {
    return JSON.stringify(dag, null, 2);
  }

  /** Serialize a DAG to compact JSON (no whitespace). */
  static serializeCompact(dag: DAG): string {
    return JSON.stringify(dag);
  }

  /**
   * Register a node. Accepts narrowly-typed nodes
   * (`NodeInterface<TState, 'success' | 'error', TServices>`) and stores
   * them widened to `NodeInterface<TState, string, TServices>`; narrow
   * wide is sound covariantly on both `outputs` and the result `output`.
   */
  registerNode<TOutput extends string>(
    node: NodeInterface<TState, TOutput, TServices>,
  ): void {
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
  registerBundle(bundle: DispatcherBundle<TState, TServices>): void {
    for (const node of bundle.nodes) {
      this.registerNode(node);
    }
    for (const dag of bundle.dags) {
      this.registerDAG(dag);
    }
  }
}
