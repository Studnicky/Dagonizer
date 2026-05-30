import type { ExecuteOptionsInterface } from './contracts/ExecuteOptionsInterface.js';
import type { Instrumentation } from './contracts/Instrumentation.js';
import type { NodeInterface } from './contracts/NodeInterface.js';
import type { StateAccessor } from './contracts/StateAccessor.js';
import { GatherStrategies } from './core/GatherStrategies.js';
import type { GatherExecution, GatherRecord } from './core/GatherStrategies.js';
import { OutcomeReducers } from './core/OutcomeReducers.js';
import type { OutcomeRecord } from './core/OutcomeReducers.js';
import { ParallelCombiners } from './core/ParallelCombiners.js';
import { ContractRegistryValidator } from './derive/ContractRegistryValidator.js';
import type { DAG } from './entities/dag/DAG.js';
import type { EmbeddedDAGNode } from './entities/dag/EmbeddedDAGNode.js';
import type { ParallelNode } from './entities/dag/ParallelNode.js';
import type { PhaseNodePlacementInterface } from './entities/dag/PhaseNode.js';
import type { ScatterNode } from './entities/dag/ScatterNode.js';
import type { SingleNodePlacementInterface } from './entities/dag/SingleNode.js';
import type { TerminalNodePlacementInterface } from './entities/dag/TerminalNode.js';
import type { ExecutionResultInterface, InterruptionInfo } from './entities/execution/ExecutionResult.js';
import type { NodeContextInterface } from './entities/node/NodeContext.js';
import type { NodeResultInterface } from './entities/node/NodeResult.js';
import { DAGError, NodeTimeoutError, ValidationError } from './errors/index.js';
import { Execution } from './Execution.js';
import { DAGLifecycleMachine } from './lifecycle/DAGLifecycleMachine.js';
import type { NodeStateInterface } from './NodeStateBase.js';
import { DottedPathAccessor } from './runtime/DottedPathAccessor.js';
import { NoopInstrumentation } from './runtime/NoopInstrumentation.js';
import { Scheduler } from './runtime/Scheduler.js';
import { SignalComposer } from './runtime/SignalComposer.js';
import { Validator } from './validation/Validator.js';

/** Default state accessor: installed when the dispatcher is constructed without one. */
const DEFAULT_STATE_ACCESSOR: StateAccessor = new DottedPathAccessor();

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

/**
 * Per-clone result stored inside `ScatterProgress.itemResults`.
 *
 * `output` is the routing output tag.
 *
 * `mappingValues` carries the persisted clone-path values for a `map`
 * gather strategy, keyed by the clone-side path from `GatherConfig.mapping`.
 * Present only when the scatter's gather strategy is `'map'`.
 *
 * `fieldValue` carries the persisted value of `GatherConfig.field` for
 * `append` and `partition` strategies that use `field`. Present only when
 * the scatter's gather strategy uses `field`.
 *
 * Strategies that gather the source `item` directly (`append`/`partition`
 * without `field`) need no persisted value because `item` is re-derivable
 * from the source array by index on resume.
 */
export interface ScatterItemResult {
  readonly index: number;
  readonly output: string;
  readonly mappingValues?: Readonly<Record<string, unknown>>;
  readonly fieldValue?: unknown;
}

/**
 * Per-placement scatter progress entry. Keyed by `placementName` inside
 * the metadata's `StoredScatterProgress` map.
 */
export interface ScatterProgress {
  readonly placementName: string;
  readonly completedIndices: readonly number[];
  readonly itemResults: readonly ScatterItemResult[];
}

/**
 * The actual stored shape under `metadata[SCATTER_PROGRESS_KEY]`. Keyed
 * by `ScatterNode.name` so multiple scatter placements in the same flow
 * do not collide.
 */
export type StoredScatterProgress = Readonly<Record<string, ScatterProgress>>;

/**
 * Constructor options for `Dagonizer`.
 *
 * `TServices` is the consumer-defined services bag that the dispatcher
 * passes through every `NodeContextInterface`. Default `undefined` means
 * nodes receive `context.services === undefined`.
 */
export interface DagonizerOptionsInterface<TServices = undefined> {
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
   * Instrumentation hooks invoked at execution boundaries. Defaults
   * to a `NoopInstrumentation`; every method is a no-op when not
   * overridden. Plugins extend `NoopInstrumentation` and override the
   * hooks they care about, then pass the instance through this option.
   *
   * The dispatcher's protected `on*` subclass hooks continue to fire
   * alongside this surface; both surfaces coexist so a single consumer
   * can mix subclass observability with plugin-supplied instrumentation.
   */
  readonly instrumentation?: Instrumentation;
}


type DAGNodeType = EmbeddedDAGNode | ScatterNode | ParallelNode | SingleNodePlacementInterface | TerminalNodePlacementInterface | PhaseNodePlacementInterface;
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

interface InternalNodeResultInterface<TState extends NodeStateInterface> {
  'nextStage': null | string;
  'result': NodeResultInterface<TState>;
}

/**
 * Graph-based DAG dispatcher for state-machine-style multi-step
 * node execution.
 *
 * Subclass to attach observability by overriding `onFlowStart`, `onFlowEnd`,
 * `onNodeStart`, `onNodeEnd`, `onError`. Default implementations are no-ops.
 *
 * For composable observability (multiple observers, plugin-supplied
 * tracing/metrics), pass an `Instrumentation` implementation through the
 * `instrumentation` constructor option. The dispatcher fires both the
 * subclass `on*` hooks and the equivalent `instrumentation.*` methods at
 * every execution boundary, so subclass and plugin observers coexist.
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
 *   nodes: [{ '@id': 'urn:noocodex:dag:demo/node/increment', '@type': 'SingleNode',
 *             name: 'increment', node: 'increment', outputs: { done: null } }],
 * });
 *
 * const result = await dispatcher.execute('demo', new MyState());
 * // result.state.value === 1
 * // result.cursor === null (completed)
 * ```
 */
export class Dagonizer<TState extends NodeStateInterface, TServices = undefined>
implements DagonizerInterface<TState, TServices> {
  private readonly dags = new Map<string, DAG>();
  private readonly nodes = new Map<string, NodeInterface<TState, string, TServices>>();
  private readonly nodeIndex = new Map<string, DAGNodeType>();
  private readonly accessor: StateAccessor;
  private readonly services: TServices;
  private readonly instrumentation: Instrumentation;

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
  ) => Promise<InternalNodeResultInterface<TState>>>>;

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
  constructor(options: DagonizerOptionsInterface<TServices> = {}) {
    this.accessor = options.accessor ?? DEFAULT_STATE_ACCESSOR;
    this.services = options.services as TServices;
    this.instrumentation = options.instrumentation ?? new NoopInstrumentation();
    this.dispatch = {
      'EmbeddedDAGNode': (entry, state, _dagName, signal, placementPath) =>
        this.executeEmbeddedDAG(entry as EmbeddedDAGNode, state, signal, placementPath),
      'ScatterNode': (entry, state, dagName, signal, placementPath) =>
        this.executeScatter(entry as ScatterNode, state, dagName, signal, placementPath),
      'ParallelNode': (entry, state, dagName, signal) =>
        this.executeParallelGroup(entry as ParallelNode, state, dagName, signal),
      'SingleNode': (entry, state, dagName, signal) =>
        this.executeSingleNode(entry as SingleNodePlacementInterface, state, dagName, signal),
      // TerminalNode / PhaseNode are handled before executeDAGNode in runNodes;
      // these branches are unreachable in normal operation but keep the dispatch
      // table exhaustive over the node `@type` union.
      'TerminalNode': (entry, state) => {
        const terminal = entry as TerminalNodePlacementInterface;
        return Promise.resolve({ 'nextStage': null, 'result': {
          'output': terminal.outcome, 'skipped': false, 'nodeName': terminal.name, state, 'intermediateResults': [],
        } });
      },
      'PhaseNode': (entry, state) => {
        const phase = entry as PhaseNodePlacementInterface;
        return Promise.resolve({ 'nextStage': null, 'result': {
          'output': phase.phase, 'skipped': true, 'nodeName': phase.name, state, 'intermediateResults': [],
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
   */
  protected onNodeStart(_nodeName: string, _state: TState, _placementPath: readonly string[]): void { /* override */ }
  /**
   * Fires after a node completes successfully. See {@link onNodeStart} for
   * `placementPath` semantics.
   */
  protected onNodeEnd(_nodeName: string, _output: string | null, _state: TState, _placementPath: readonly string[]): void { /* override */ }
  /**
   * Fires when the dispatcher catches an error from a node (or from the
   * abort/timeout machinery). See {@link onNodeStart} for `placementPath`
   * semantics.
   */
  protected onError(_nodeName: string, _error: Error, _state: TState, _placementPath: readonly string[]): void { /* override */ }

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

  private createChildState(parentState: TState, inputMapping?: Record<string, string>): TState {
    const childState = parentState.clone() as TState;

    if (inputMapping) {
      for (const [
        childKey,
        parentKey
      ] of Object.entries(inputMapping)) {
        const value = this.accessor.get(parentState, parentKey);

        this.accessor.set(childState, childKey, value);
      }
    }

    return childState;
  }

  /**
   * Copy fields from `childState` back to `parentState` using `output` mapping.
   * `output` entries are `{ parentPath: childKey }`: for each entry, read
   * `childKey` from `childState` and write it to `parentPath` on `parentState`.
   */
  private mapOutputState(
    childState: TState,
    parentState: TState,
    output: Record<string, string> | undefined,
  ): void {
    if (output === undefined) return;
    for (const [parentKey, childKey] of Object.entries(output)) {
      this.accessor.set(parentState, parentKey, this.accessor.get(childState, childKey));
    }
  }

  async destroy(): Promise<void> {
    for (const node of this.nodes.values()) {
      if (node.destroy) {
        await node.destroy();
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
   * `isEmbeddedDAG` is a private implementation detail for recursive embedded-DAG
   * re-entry. When `true`, lifecycle transitions (`markRunning`,
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
    isEmbeddedDAG: boolean = false,
    placementPath: readonly string[] = [],
  ): AsyncGenerator<NodeResultInterface<TState>, ExecutionResultInterface<TState>, void> {
    const dag = this.dags.get(dagName);

    if (!dag) {
      // Unknown DAG: synthesize an error result without starting the
      // lifecycle. `state` may not have been touched yet, so don't mark
      // running. The cursor is null because there is no DAG to resume.
      const error = new DAGError(`Unknown DAG: ${dagName}`);
      this.onError('<unknown>', error, state, placementPath);
      this.instrumentation.error(dagName, '<unknown>', error, state, placementPath);
      if (!isEmbeddedDAG) {
        try { state.markFailed(error); } catch { /* state may already be terminal */ }
      }
      const result: ExecutionResultInterface<TState> = {
        'cursor': null, 'executedNodes': [], 'skippedNodes': [], state, 'terminalOutcome': null,
        'interruptedAt': null,
      };
      if (!isEmbeddedDAG) {
        this.onFlowEnd(dagName, state, result);
        this.instrumentation.flowEnd(dagName, state, result);
      }
      return result;
    }

    const signal = SignalComposer.compose(options);

    if (!isEmbeddedDAG) {
      state.markRunning();
      this.onFlowStart(dagName, state);
      this.instrumentation.flowStart(dagName, state);
    }

    const executedNodes: string[] = [];
    const skippedNodes: string[] = [];

    // --- Pre-phase placements --------------------------------------------------
    // Run before the entrypoint, in DAG declaration order. Suppressed when this
    // is a embedded-DAG re-entry; pre/post phases are top-level concerns owned by
    // the consumer's `execute()` / `resume()` call.
    if (!isEmbeddedDAG) {
      const prePhases = dag.nodes.filter(
        (n): n is PhaseNodePlacementInterface =>
          n['@type'] === 'PhaseNode' && n.phase === 'pre',
      );
      for (const phase of prePhases) {
        this.instrumentation.phaseEnter(dagName, 'pre', phase.name, state, placementPath);
        try {
          await this.executePhasePlacement(phase, state, dagName, signal);
          executedNodes.push(phase.name);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.onError(phase.name, error, state, placementPath);
          this.instrumentation.error(dagName, phase.name, error, state, placementPath);
          try { state.markFailed(error); } catch { /* already terminal */ }
          this.instrumentation.phaseExit(dagName, 'pre', phase.name, state, placementPath);
          const result = this.buildResult(null, executedNodes, skippedNodes, null, null, state);
          await this.runPostPhasesAndFinalize(dag, dagName, state, result, isEmbeddedDAG, placementPath);
          return result;
        }
        this.instrumentation.phaseExit(dagName, 'pre', phase.name, state, placementPath);
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
        this.instrumentation.error(dagName, currentNodeName, abortInfo.error, state, placementPath);
        const interruptedAt: InterruptionInfo = {
          'nodeName': currentNodeName,
          'reason':   abortInfo.reason,
        };
        const result = this.buildResult(cursor, executedNodes, skippedNodes, terminalOutcome, interruptedAt, state);
        await this.runPostPhasesAndFinalize(dag, dagName, state, result, isEmbeddedDAG, placementPath);
        return result;
      }

      const node = this.nodeIndex.get(`${dagName}:${currentNodeName}`);

      if (!node) {
        const error = new DAGError(`Unknown node: ${currentNodeName} in DAG ${dagName}`);
        this.onError(currentNodeName, error, state, placementPath);
        this.instrumentation.error(dagName, currentNodeName, error, state, placementPath);
        if (!isEmbeddedDAG) {
          try { state.markFailed(error); } catch { /* already terminal */ }
        }
        const result = this.buildResult(cursor, executedNodes, skippedNodes, terminalOutcome, null, state);
        await this.runPostPhasesAndFinalize(dag, dagName, state, result, isEmbeddedDAG, placementPath);
        return result;
      }

      this.onNodeStart(node.name, state, placementPath);
      this.instrumentation.nodeStart(dagName, node.name, state, placementPath);

      // TerminalNode is a no-op execution: capture outcome, synthesize result,
      // fire onNodeEnd, and break the loop. No call to executeDAGNode needed.
      if (node['@type'] === 'TerminalNode') {
        const terminal = node as TerminalNodePlacementInterface;
        terminalOutcome = terminal.outcome;
        executedNodes.push(terminal.name);
        const terminalResult: NodeResultInterface<TState> = {
          'output': terminal.outcome,
          'skipped': false,
          'nodeName': terminal.name,
          state,
          'intermediateResults': [],
        };
        this.onNodeEnd(terminal.name, terminal.outcome, state, placementPath);
        this.instrumentation.nodeEnd(dagName, terminal.name, terminal.outcome, state, placementPath);
        yield terminalResult;
        break mainLoop;
      }

      let nodeOutcome: InternalNodeResultInterface<TState>;
      try {
        nodeOutcome = await this.executeDAGNode(node, state, dagName, signal, placementPath);
      } catch (caughtError) {
        const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
        this.onError(currentNodeName, error, state, placementPath);
        this.instrumentation.error(dagName, currentNodeName, error, state, placementPath);
        let interruptedAt: InterruptionInfo | null = null;
        if (signal?.aborted) {
          // Run-level signal aborted: classify abort vs timeout via handleAbort.
          // handleAbort inspects signal.reason for TimeoutError, which
          // covers the run-level deadline TimeoutError. The per-node
          // `NodeTimeoutError` does NOT abort the parent signal; that
          // case is handled below.
          if (!isEmbeddedDAG) {
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
          if (!isEmbeddedDAG && !DAGLifecycleMachine.isTerminal(state.lifecycle)) {
            try { state.markFailed(error); } catch { /* already terminal */ }
          }
        } else if (!isEmbeddedDAG && !DAGLifecycleMachine.isTerminal(state.lifecycle)) {
          try { state.markFailed(error); } catch { /* already terminal */ }
        }
        const result = this.buildResult(cursor, executedNodes, skippedNodes, terminalOutcome, interruptedAt, state);
        await this.runPostPhasesAndFinalize(dag, dagName, state, result, isEmbeddedDAG, placementPath);
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
      this.instrumentation.nodeEnd(dagName, node.name, nodeResult.output, state, placementPath);

      yield nodeResult;

      currentNodeName = nextStage;
      cursor = nextStage;
    }

    if (!isEmbeddedDAG) {
      if (terminalOutcome === 'failed') {
        try {
          state.markFailed(new DAGError(`Flow terminated at '${executedNodes[executedNodes.length - 1] ?? '<unknown>'}' with outcome=failed`));
        } catch { /* state may already be terminal */ }
      } else {
        // terminalOutcome === 'completed' OR null (ran out of work naturally)
        try { state.markCompleted(); } catch { /* state may already be terminal */ }
      }
    }
    const result = this.buildResult(null, executedNodes, skippedNodes, terminalOutcome, null, state);
    await this.runPostPhasesAndFinalize(dag, dagName, state, result, isEmbeddedDAG, placementPath);
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
   * `isEmbeddedDAG` is true; phase placements are top-level concerns owned
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
    isEmbeddedDAG: boolean,
    placementPath: readonly string[] = [],
  ): Promise<void> {
    if (isEmbeddedDAG) {
      return;
    }

    const postPhases = dag.nodes.filter(
      (n): n is PhaseNodePlacementInterface =>
        n['@type'] === 'PhaseNode' && n.phase === 'post',
    );
    for (const phase of postPhases) {
      this.instrumentation.phaseEnter(dagName, 'post', phase.name, state, placementPath);
      try {
        await this.executePhasePlacement(phase, state, dagName, null);
        result.executedNodes.push(phase.name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state.collectWarning({
          'code':      'POST_PHASE_FAILED',
          'message':   `post-phase '${phase.name}' threw: ${message}`,
          'operation': phase.name,
          'timestamp': new Date().toISOString(),
        });
      }
      this.instrumentation.phaseExit(dagName, 'post', phase.name, state, placementPath);
    }
    this.onFlowEnd(dagName, state, result);
    this.instrumentation.flowEnd(dagName, state, result);
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
    if (result.errors !== undefined) {
      for (const err of result.errors) state.collectError(err);
    }
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
      'error':  reason instanceof Error ? reason : new Error(message),
      'reason': 'abort',
    };
  }

  /**
   * Persist this batch's accumulated scatter progress to metadata. One
   * write per batch (not per clone); the call sits outside `Promise.all`
   * so concurrent clone resolutions never race on `setMetadata`.
   */
  private writeScatterProgress(
    state: TState,
    placementName: string,
    completed: ReadonlySet<number>,
    itemOutputs: ReadonlyMap<number, string>,
    mappingValues?: ReadonlyMap<number, Readonly<Record<string, unknown>>>,
    fieldValues?: ReadonlyMap<number, unknown>,
  ): void {
    const stored = state.getMetadata<StoredScatterProgress>(SCATTER_PROGRESS_KEY) ?? {};
    const completedIndices = [...completed].sort((a, b) => a - b);
    const itemResults: ScatterItemResult[] = completedIndices.map((index) => {
      const output = itemOutputs.get(index) ?? '';
      if (mappingValues !== undefined && mappingValues.has(index)) {
        const mv = mappingValues.get(index);
        if (mv !== undefined) {
          return { index, output, 'mappingValues': mv };
        }
      }
      if (fieldValues !== undefined && fieldValues.has(index)) {
        return { index, output, 'fieldValue': fieldValues.get(index) };
      }
      return { index, output };
    });
    const next: Record<string, ScatterProgress> = { ...stored };
    next[placementName] = { placementName, completedIndices, itemResults };
    state.setMetadata(SCATTER_PROGRESS_KEY, next);
  }

  /**
   * Remove this placement's progress entry. Called after the scatter loop
   * drains so a subsequent re-run starts clean. When the resulting map is
   * empty the reserved metadata key is removed entirely so a clean snapshot
   * omits it.
   */
  private clearScatterProgress(state: TState, placementName: string): void {
    const stored = state.getMetadata<StoredScatterProgress>(SCATTER_PROGRESS_KEY);
    if (stored === undefined) return;
    if (!(placementName in stored)) return;
    const next: Record<string, ScatterProgress> = { ...stored };
    delete next[placementName];
    if (Object.keys(next).length === 0) {
      state.deleteMetadata(SCATTER_PROGRESS_KEY);
    } else {
      state.setMetadata(SCATTER_PROGRESS_KEY, next);
    }
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
   * - Lifecycle scoping: `isEmbeddedDAG: true` suppresses lifecycle transitions
   *   and flow hooks on the child run (those are top-level concerns).
   * - `placementPath`: extended with the placement name so inner node hooks
   *   receive accurate nesting context.
   */
  private async executeEmbeddedDAG(
    placement: EmbeddedDAGNode,
    state: TState,
    signal: AbortSignal | null,
    placementPath: readonly string[],
  ): Promise<InternalNodeResultInterface<TState>> {
    const inputMapping = placement.stateMapping?.input as Record<string, string> | undefined;
    const outputMapping = placement.stateMapping?.output as Record<string, string> | undefined;

    const cloneState = this.createChildState(state, inputMapping);

    const childOptions: ExecuteOptionsInterface = signal ? { 'signal': signal } : {};
    const innerPath: readonly string[] = [...placementPath, placement.name];
    const iter = this.runNodes(placement.dag, cloneState, null, childOptions, true, innerPath);

    const intermediateResults: Array<NodeResultInterface<TState>> = [];
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
    const terminalOutcome = step.value.terminalOutcome;

    // Propagate errors and warnings from child to parent
    for (const err of cloneState.errors) state.collectError(err);
    for (const warn of cloneState.warnings) state.collectWarning(warn);

    // Apply output state mapping: child → parent
    this.mapOutputState(cloneState, state, outputMapping);

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
   * Execute a scatter placement: fork over a source array (one clone per
   * item), run a body (node or sub-DAG) in each clone, propagate
   * errors/warnings to the parent, apply the gather strategy, and route
   * via the outcome reducer.
   *
   * Resume bookkeeping is persisted under {@link SCATTER_PROGRESS_KEY}.
   *
   * **Index semantics on resume.** Treat the source array as immutable
   * while a scatter checkpoint is live.
   */
  private async executeScatter(
    scatter: ScatterNode,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
    placementPath: readonly string[],
  ): Promise<InternalNodeResultInterface<TState>> {
    // ── 1. Resolve item list ─────────────────────────────────────────────────
    const raw = this.accessor.get(state, scatter.source);
    if (!Array.isArray(raw) || raw.length === 0) {
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
    const sourceArray: unknown[] = raw;

    const itemKey = scatter.itemKey ?? 'currentItem';
    const concurrency = scatter.concurrency ?? sourceArray.length;

    // ── 2. Resume bookkeeping ────────────────────────────────────────────────
    const storedProgress =
      (state.getMetadata<StoredScatterProgress>(SCATTER_PROGRESS_KEY) ?? {})[scatter.name];
    const completed = new Set<number>(storedProgress?.completedIndices ?? []);
    const itemOutputs = new Map<number, string>();

    // Per-index gather persistence maps. Only one is populated, depending on
    // the active gather strategy:
    //   mappingValues: map strategy: all clone-path values keyed by clone path
    //   fieldValues:   append/partition with `field`: the field value per index
    const isMapGather = scatter.gather?.strategy === 'map';
    const isFieldGather =
      (scatter.gather?.strategy === 'append' || scatter.gather?.strategy === 'partition') &&
      scatter.gather.field !== undefined;
    const mappingValues: Map<number, Readonly<Record<string, unknown>>> | undefined =
      isMapGather ? new Map() : undefined;
    const fieldValues: Map<number, unknown> | undefined =
      isFieldGather ? new Map() : undefined;

    // Rehydrate from stored progress: rebuild itemOutputs and the gather maps
    // so restored items can contribute synthetic GatherRecords below.
    if (storedProgress) {
      for (const entry of storedProgress.itemResults) {
        itemOutputs.set(entry.index, entry.output);
        if (mappingValues !== undefined && entry.mappingValues !== undefined) {
          mappingValues.set(entry.index, entry.mappingValues);
        }
        if (fieldValues !== undefined && 'fieldValue' in entry) {
          fieldValues.set(entry.index, entry.fieldValue);
        }
      }
    }

    // ── 3. Clone + run body ──────────────────────────────────────────────────
    const allRecords: GatherRecord<TState>[] = [];
    const intermediateResults: Array<NodeResultInterface<TState>> = [];

    for (let i = 0; i < sourceArray.length; i += concurrency) {
      const batch = sourceArray.slice(i, i + concurrency);

      const batchPromises = batch.map(async (item, batchOffset) => {
        const itemIndex = i + batchOffset;

        if (completed.has(itemIndex)) {
          const restoredOutput = itemOutputs.get(itemIndex) ?? 'success';
          return {
            'index': itemIndex,
            item,
            'output': restoredOutput,
            'terminalOutcome': null as 'completed' | 'failed' | null,
            'cloneState': state,
            'restored': true,
          };
        }

        const cloneState = this.createChildState(
          state,
          scatter.stateMapping?.input as Record<string, string> | undefined,
        );

        cloneState.setMetadata(itemKey, item);
        cloneState.setMetadata('itemIndex', itemIndex);

        let output: string;
        let terminalOutcome: 'completed' | 'failed' | null = null;

        if ('node' in scatter.body) {
          // ── node body ────────────────────────────────────────────────────
          const dagNode = this.nodes.get(scatter.body.node);
          if (!dagNode) {
            throw new DAGError(`ScatterNode '${scatter.name}': unknown node '${scatter.body.node}'`);
          }
          const opResult = await this.withNodeTimeout(dagNode, signal, (nodeSignal) => {
            const context = this.buildContext(dagName, scatter.name, nodeSignal);
            return dagNode.execute(cloneState, context);
          });
          if (opResult.errors) {
            for (const err of opResult.errors) cloneState.collectError(err);
          }
          output = opResult.output;
        } else {
          // ── dag body ─────────────────────────────────────────────────────
          const childOptions: ExecuteOptionsInterface = signal ? { 'signal': signal } : {};
          const innerPath: readonly string[] = [...placementPath, scatter.name];
          const iter = this.runNodes(scatter.body.dag, cloneState, null, childOptions, true, innerPath);

          while (true) {
            const step = await iter.next();
            if (step.done) {
              terminalOutcome = step.value.terminalOutcome;
              break;
            }
            const nr = step.value;
            const intermediate: NodeResultInterface<TState> = {
              'output': nr.output,
              'skipped': nr.skipped,
              'nodeName': `${scatter.name}.${nr.nodeName}`,
              state,
              'intermediateResults': [],
            };
            intermediateResults.push(intermediate);
          }

          const hasUnrecoverable = cloneState.errors.some((e) => e.recoverable === false);
          output = (terminalOutcome === 'failed' || hasUnrecoverable) ? 'error' : 'success';
        }

        for (const err of cloneState.errors) state.collectError(err);
        for (const warn of cloneState.warnings) state.collectWarning(warn);

        return {
          'index': itemIndex,
          item,
          output,
          terminalOutcome,
          cloneState,
          'restored': false,
        };
      });

      const batchResults = await Promise.all(batchPromises);

      for (const br of batchResults) {
        completed.add(br.index);
        itemOutputs.set(br.index, br.output);

        if (!br.restored) {
          const record: GatherRecord<TState> = {
            'index': br.index,
            'item': br.item,
            'output': br.output,
            'terminalOutcome': br.terminalOutcome,
            'cloneState': br.cloneState,
          };
          allRecords.push(record);

          // Persist gather values from the freshly-executed clone so a resumed
          // run can reconstruct the GatherRecord's cloneState contribution.
          if (mappingValues !== undefined && scatter.gather?.mapping !== undefined) {
            const snapshot: Record<string, unknown> = {};
            for (const clonePath of Object.keys(scatter.gather.mapping)) {
              snapshot[clonePath] = this.accessor.get(br.cloneState, clonePath);
            }
            mappingValues.set(br.index, snapshot);
          }
          if (fieldValues !== undefined && scatter.gather?.field !== undefined) {
            fieldValues.set(br.index, this.accessor.get(br.cloneState, scatter.gather.field));
          }
        } else {
          // Restored item: synthesize a GatherRecord with a clone that carries
          // the persisted gather values so the strategy sees a complete record
          // set without special-casing restored vs fresh items.
          const syntheticClone = state.clone() as TState;
          if (mappingValues !== undefined) {
            const mv = mappingValues.get(br.index);
            if (mv !== undefined) {
              for (const [clonePath, val] of Object.entries(mv)) {
                this.accessor.set(syntheticClone, clonePath, val);
              }
            }
          }
          if (fieldValues !== undefined && scatter.gather?.field !== undefined) {
            const fv = fieldValues.get(br.index);
            if (fv !== undefined) {
              this.accessor.set(syntheticClone, scatter.gather.field, fv);
            }
          }
          const record: GatherRecord<TState> = {
            'index': br.index,
            'item': br.item,
            'output': br.output,
            'terminalOutcome': br.terminalOutcome,
            'cloneState': syntheticClone,
          };
          allRecords.push(record);
        }
      }

      this.writeScatterProgress(state, scatter.name, completed, itemOutputs, mappingValues, fieldValues);
    }

    // ── 4. Gather ────────────────────────────────────────────────────────────
    this.clearScatterProgress(state, scatter.name);

    if (scatter.gather !== undefined && allRecords.length > 0) {
      const gatherExecution = this.buildGatherExecution(state, allRecords, dagName, signal);
      await GatherStrategies.resolve(scatter.gather.strategy).apply(scatter.gather, gatherExecution);
    }

    // ── 5. Reduce to route ───────────────────────────────────────────────────
    const reducerName = scatter.reducer ?? 'aggregate';
    // Index records once (O(N)) so the per-item lookup below is O(1); avoids
    // an O(N²) linear scan when reducing a large source array.
    const recordByIndex = new Map<number, GatherRecord<TState>>();
    for (const record of allRecords) recordByIndex.set(record.index, record);
    const outcomeRecords: OutcomeRecord[] = [...itemOutputs.entries()].map(([index, output]) => ({
      index,
      output,
      'terminalOutcome': recordByIndex.get(index)?.terminalOutcome ?? null,
    }));
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
    const dispatcher = this;
    return {
      state,
      records,
      dagName,
      signal,
      'accessor': dispatcher.accessor,
      async invokeNode(nodeName: string): Promise<void> {
        const dagNode = dispatcher.nodes.get(nodeName);
        if (!dagNode) {
          throw new DAGError(`Unknown custom node: ${nodeName}`);
        }
        const context = dispatcher.buildContext(dagName, nodeName, signal);
        await dagNode.execute(state, context);
      },
    };
  }

  private async executeParallelGroup(
    group: ParallelNode,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
  ): Promise<InternalNodeResultInterface<TState>> {
    const nodes = group.nodes.map((nodeName) => {
      const node = this.nodeIndex.get(`${dagName}:${nodeName}`);

      if (node?.['@type'] !== 'SingleNode') {
        throw new DAGError(`Parallel group ${group.name} references invalid node: ${String(nodeName)}`);
      }

      return node;
    });

    const promises = nodes.map(async (nodeConfig) => {
      const dagNode = this.nodes.get(nodeConfig.node);

      if (!dagNode) {
        throw new DAGError(`Unknown node: ${nodeConfig.node}`);
      }
      const context = this.buildContext(dagName, nodeConfig.name, signal);
      const opResult = await dagNode.execute(state, context);

      return {
        opResult,
        'node': nodeConfig
      };
    });

    const results = await Promise.all(promises);

    for (const { opResult } of results) {
      if (opResult.errors) {
        for (const error of opResult.errors) {
          state.collectError(error);
        }
      }
    }

    const intermediateResults: Array<NodeResultInterface<TState>> = results.map(({
      opResult, node
    }) => ({
      'output': opResult.output,
      'skipped': false,
      'nodeName': node.name,
      state,
      'intermediateResults': [],
    }));

    const outputs = results.map((resultItem) => resultItem.opResult.output);
    const combiner = ParallelCombiners.resolve(group.combine);
    const combinedOutput = combiner.combine(outputs, results, state);

    const nextStage = group.outputs[combinedOutput] ?? null;
    const result: NodeResultInterface<TState> = {
      'output': combinedOutput,
      'skipped': false,
      'nodeName': group.name,
      state,
      intermediateResults,
    };

    return {
      nextStage,
      result
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
      .after(timeoutMs, childCtrl.signal)
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
      childCtrl.abort(new Error('node-timeout-cleanup'));
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
  ): Promise<InternalNodeResultInterface<TState>> {
    const dagNode = this.nodes.get(nodeConfig.node);

    if (!dagNode) {
      throw new DAGError(`Unknown node: ${nodeConfig.node}`);
    }

    const opResult = await this.withNodeTimeout(dagNode, signal, (nodeSignal) => {
      const context = this.buildContext(dagName, nodeConfig.name, nodeSignal);
      return dagNode.execute(state, context);
    });

    if (opResult.errors) {
      for (const error of opResult.errors) {
        state.collectError(error);
      }
    }

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
  ): Promise<InternalNodeResultInterface<TState>> {
    const handler = this.dispatch[entry['@type']];
    if (handler === undefined) {
      throw new DAGError(`Unknown node type: ${(entry as DAGNodeType)['@type']}`);
    }
    return handler(entry, state, dagName, signal, placementPath);
  }


  private static validateDAGConfig<TState extends NodeStateInterface, TServices>(
    dag: DAG,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    dags: Map<string, DAG>
  ): void {
    const errors: string[] = [];
    const nodeNames = new Set<string>();

    for (const node of dag.nodes) {
      if (nodeNames.has(node.name)) {
        errors.push(`Duplicate node name: ${node.name}`);
      }
      nodeNames.add(node.name);
    }

    if (!nodeNames.has(dag.entrypoint)) {
      errors.push(`Entrypoint '${dag.entrypoint}' does not exist in nodes`);
    }

    for (const node of dag.nodes) {
      Dagonizer.validateDAGNode(node as DAGNodeType, nodes, dags, nodeNames, errors);
    }

    // Collect circular-reference candidates across BOTH sub-DAG edge kinds in
    // one traversal: EmbeddedDAGNode(dag) and ScatterNode(body.dag). A
    // cross-kind cycle (embed → scatter → embed) is caught, not just same-kind.
    const dagRefs = new Set<string>();
    Dagonizer.collectDAGReferences(dag, dags, dagRefs, new Set([dag.name]), errors);

    if (errors.length > 0) {
      throw new DAGError(`Invalid DAG '${dag.name}':\n  - ${errors.join('\n  - ')}`);
    }
  }

  private static validateDAGNode<TState extends NodeStateInterface, TServices>(
    entry: DAGNodeType,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    dags: Map<string, DAG>,
    nodeNames: Set<string>,
    errors: string[]
  ): void {
    const validators: Readonly<Record<DAGNodeAtType, () => void>> = {
      'EmbeddedDAGNode': () => Dagonizer.validateEmbeddedDAGNode(entry as EmbeddedDAGNode, dags, nodeNames, errors),
      'ScatterNode':     () => Dagonizer.validateScatterNode(entry as ScatterNode, nodes, dags, nodeNames, errors),
      'ParallelNode':    () => Dagonizer.validateParallelNode(entry as ParallelNode, nodeNames, errors),
      'SingleNode':      () => Dagonizer.validateSingleNode(entry as SingleNodePlacementInterface, nodes, nodeNames, errors),
      'TerminalNode':    () => { /* TerminalNode has no outputs to validate; schema pass is sufficient */ },
      'PhaseNode':       () => Dagonizer.validatePhaseNode(entry as PhaseNodePlacementInterface, nodes, errors),
    };
    validators[entry['@type']]?.();
  }

  private static validatePhaseNode<TState extends NodeStateInterface, TServices>(
    phase: PhaseNodePlacementInterface,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    errors: string[]
  ): void {
    if (!nodes.has(phase.node)) {
      errors.push(`PhaseNode '${phase.name}' references unknown registered node: ${phase.node}`);
    }
  }

  private static validateSingleNode<TState extends NodeStateInterface, TServices>(
    nodeConfig: SingleNodePlacementInterface,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    nodeNames: Set<string>,
    errors: string[]
  ): void {
    const dagNode = nodes.get(nodeConfig.node);

    if (!dagNode) {
      errors.push(`Node '${nodeConfig.name}' references unknown registered node: ${nodeConfig.node}`);
      return;
    }

    for (const output of dagNode.outputs) {
      if (!(output in nodeConfig.outputs)) {
        errors.push(`Node '${nodeConfig.name}': registered node '${dagNode.name}' declares output '${output}' but no routing is defined`);
      }
    }

    for (const [output, target] of Object.entries(nodeConfig.outputs)) {
      if (target !== null && !nodeNames.has(target)) {
        errors.push(`Node '${nodeConfig.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static validateParallelNode(
    group: ParallelNode,
    nodeNames: Set<string>,
    errors: string[]
  ): void {
    for (const nodeName of group.nodes) {
      if (!nodeNames.has(nodeName)) {
        errors.push(`Parallel group '${group.name}' references unknown node: ${nodeName}`);
      }
    }

    for (const [output, target] of Object.entries(group.outputs)) {
      if (target !== null && !nodeNames.has(target)) {
        errors.push(`Parallel group '${group.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static validateEmbeddedDAGNode(
    placement: EmbeddedDAGNode,
    dags: Map<string, DAG>,
    nodeNames: Set<string>,
    errors: string[]
  ): void {
    if (!dags.has(placement.dag)) {
      errors.push(`EmbeddedDAGNode '${placement.name}': unknown registered DAG '${placement.dag}'`);
    }

    for (const [output, target] of Object.entries(placement.outputs)) {
      if (target !== null && !nodeNames.has(target)) {
        errors.push(`EmbeddedDAGNode '${placement.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static validateScatterNode<TState extends NodeStateInterface, TServices>(
    scatter: ScatterNode,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    dags: Map<string, DAG>,
    nodeNames: Set<string>,
    errors: string[]
  ): void {
    if ('node' in scatter.body) {
      if (!nodes.has(scatter.body.node)) {
        errors.push(`ScatterNode '${scatter.name}': unknown registered node '${scatter.body.node}'`);
      }
    } else {
      if (!dags.has(scatter.body.dag)) {
        errors.push(`ScatterNode '${scatter.name}': unknown registered DAG '${scatter.body.dag}'`);
      }
    }

    const gather = scatter.gather;
    if (gather !== undefined) {
      if (gather.strategy === 'append' && gather.target === undefined) {
        errors.push(`ScatterNode '${scatter.name}': 'append' gather strategy requires 'target' path`);
      }
      if (gather.strategy === 'partition' && gather.partitions === undefined) {
        errors.push(`ScatterNode '${scatter.name}': 'partition' gather strategy requires 'partitions' config`);
      }
      if (gather.strategy === 'map' && gather.mapping === undefined) {
        errors.push(`ScatterNode '${scatter.name}': 'map' gather strategy requires 'mapping' config`);
      }
      if (gather.strategy === 'custom') {
        if (gather.customNode === undefined) {
          errors.push(`ScatterNode '${scatter.name}': 'custom' gather strategy requires 'customNode'`);
        } else if (!nodes.has(gather.customNode)) {
          errors.push(`ScatterNode '${scatter.name}': custom gather node '${gather.customNode}' not found`);
        }
      }
    }

    for (const [output, target] of Object.entries(scatter.outputs)) {
      if (target !== null && !nodeNames.has(target)) {
        errors.push(`ScatterNode '${scatter.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  /**
   * Depth-first cycle detection over the sub-DAG reference graph. Follows BOTH
   * sub-DAG edge kinds in a single traversal: `EmbeddedDAGNode.dag` (embed) and
   * `ScatterNode.body.dag` (fork-of-sub-DAG), so a cross-kind cycle is caught.
   * `path` is the current DFS stack (back-edge ⇒ cycle); `visited` marks
   * fully-explored DAGs so shared sub-DAGs are not re-walked.
   */
  private static collectDAGReferences(
    dag: DAG,
    dags: Map<string, DAG>,
    visited: Set<string>,
    path: Set<string>,
    errors: string[]
  ): void {
    for (const rawNode of dag.nodes) {
      const kind = (rawNode as { '@type': string })['@type'];
      let dagRef: string;
      let label: string;
      if (kind === 'EmbeddedDAGNode') {
        dagRef = (rawNode as unknown as EmbeddedDAGNode).dag;
        label = 'embedded-DAG';
      } else if (kind === 'ScatterNode') {
        const body = (rawNode as unknown as ScatterNode).body;
        if (!('dag' in body)) continue;
        dagRef = body.dag;
        label = 'scatter';
      } else {
        continue;
      }
      if (path.has(dagRef)) {
        errors.push(`Circular ${label} DAG reference detected: ${Array.from(path).join(' -> ')} -> ${dagRef}`);
        continue;
      }
      if (!visited.has(dagRef)) {
        visited.add(dagRef);
        const nested = dags.get(dagRef);
        if (nested) {
          const newPath = new Set(path);
          newPath.add(dagRef);
          Dagonizer.collectDAGReferences(nested, dags, visited, newPath, errors);
        }
      }
    }
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

    Dagonizer.validateDAGConfig(dag, this.nodes, this.dags);

    // Contract validation: for each SingleNode placement whose registered
    // node carries a co-located `contract`, run dangling-read / dead-write
    // checks. Dangling reads throw DAGError; dead writes call onContractWarning.
    const contractBearingNodes = dag.nodes
      .filter((placement) => placement['@type'] === 'SingleNode')
      .map((placement) => this.nodes.get((placement as { node: string }).node))
      .filter((node): node is NodeInterface<TState, string, TServices> => node?.contract !== undefined);

    if (contractBearingNodes.length > 0) {
      const contracts = contractBearingNodes.map((node) => {
        const contract = node.contract;
        if (contract === undefined) return null;
        return { 'name': node.name, 'outputs': node.outputs, 'hardRequired': contract.hardRequired, 'produces': contract.produces };
      }).filter((c): c is Exclude<typeof c, null> => c !== null);
      try {
        ContractRegistryValidator.validate(contracts, (msg) => {
          this.onContractWarning(msg);
          this.instrumentation.contractWarning(msg);
        }, dag.entrypoint);
      } catch (err) {
        throw err instanceof Error ? err : new DAGError(String(err));
      }
    }

    this.dags.set(dag.name, dag);
    for (const node of dag.nodes) {
      this.nodeIndex.set(`${dag.name}:${node.name}`, node as unknown as DAGNodeType);
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
