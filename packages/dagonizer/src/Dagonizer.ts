import { DagContainerBase } from './container/DagContainerBase.js';
import type { BatchRunResult } from './container/DagOutcome.js';
import { DagTask } from './container/DagTask.js';
import { TransportErrorCode } from './container/TransportErrorCode.js';
import type { DagContainerInterface } from './contracts/DagContainerInterface.js';
import type { ExecuteOptionsInterface } from './contracts/ExecuteOptionsInterface.js';
import type { HandoffChannelInterface } from './contracts/HandoffChannelInterface.js';
import type { NodeInterface } from './contracts/NodeInterface.js';
import type { NodeInvoker } from './contracts/NodeInvoker.js';
import type { StateAccessor } from './contracts/StateAccessor.js';
import type { WarningEmitter } from './contracts/WarningEmitter.js';
import { Batch } from './core/batch/Batch.js';
import { GatherStrategies } from './core/GatherStrategies.js';
import type { GatherExecution, GatherRecord, GatherStrategy } from './core/GatherStrategies.js';
import { OutcomeReducers } from './core/OutcomeReducers.js';
import type { OutcomeRecord } from './core/OutcomeReducers.js';
import { PlacementRank } from './core/PlacementRank.js';
import { WorkSet } from './core/WorkSet.js';
import { ContractRegistryValidator } from './derive/ContractRegistryValidator.js';
import type { DAG } from './entities/dag/DAG.js';
import { EmbeddedDAGNodeDefaults } from './entities/dag/EmbeddedDAGNode.js';
import type { EmbeddedDAGNode } from './entities/dag/EmbeddedDAGNode.js';
import type { PhaseNode } from './entities/dag/PhaseNode.js';
import { Placement } from './entities/dag/Placement.js';
import type { DAGNodeType } from './entities/dag/Placement.js';
import { ScatterNodeDefaults } from './entities/dag/ScatterNode.js';
import type { ScatterNode } from './entities/dag/ScatterNode.js';
import type { SingleNodePlacementInterface } from './entities/dag/SingleNode.js';
import type { ExecutionResultInterface, InterruptionInfo } from './entities/execution/ExecutionResult.js';
import type { DAGHandoff } from './entities/handoff/DAGHandoff.js';
import type { JsonObject } from './entities/json.js';
import type { NodeContextInterface } from './entities/node/NodeContext.js';
import type { NodeResultInterface } from './entities/node/NodeResult.js';
import type { ScatterAckedResult, ScatterInboxItem } from './entities/scatter/ScatterProgress.js';
import type { WorkSetProgress } from './entities/workset/WorkSetProgress.js';
import { DAGError, ExecutionError, NodeTimeoutError } from './errors/index.js';
import { ReservoirBuffer } from './execution/ReservoirBuffer.js';
import type { ReservoirDriverInterface, ScatterItemBatchResult } from './execution/ReservoirBuffer.js';
import { ScatterWorkerPool } from './execution/ScatterWorkerPool.js';
import type { ScatterItemResult, ScatterPoolDriverInterface } from './execution/ScatterWorkerPool.js';
import { Execution } from './Execution.js';
import { DAGLifecycleMachine } from './lifecycle/DAGLifecycleMachine.js';
import type { NodeStateInterface } from './NodeStateBase.js';
import { DottedPathAccessor } from './runtime/DottedPathAccessor.js';
import { ScatterCheckpoint } from './runtime/ScatterCheckpoint.js';
import { Scheduler } from './runtime/Scheduler.js';
import { SignalComposer } from './runtime/SignalComposer.js';
import { StateMapper } from './runtime/StateMapper.js';
import { Timeout } from './runtime/Timeout.js';
import { WorkSetCheckpoint } from './runtime/WorkSetCheckpoint.js';
import { DAGValidator } from './validation/DAGValidator.js';
import { Validator } from './validation/Validator.js';

/** Default state accessor: installed when the dispatcher is constructed without one. */
const DEFAULT_STATE_ACCESSOR: StateAccessor = new DottedPathAccessor();

/** Registry version used when the dispatcher is constructed without one. */
const DEFAULT_REGISTRY_VERSION = '0';

/** Default scatter concurrency when `scatter.concurrency` is not specified. */
const DEFAULT_SCATTER_CONCURRENCY = 1;

/**
 * Canonical defaults for `DagonizerOptionsInterface`.
 *
 * Every field that has a default is present here. The constructor resolves
 * all options in one spread: `{ ...DAGONIZER_OPTION_DEFAULTS, ...options }`.
 * `services` is intentionally absent — it has no meaningful default and
 * requires a type-unsafe cast at the assignment site regardless.
 */
const DAGONIZER_OPTION_DEFAULTS = {
  'accessor': DEFAULT_STATE_ACCESSOR as StateAccessor,
  'containers': {} as Readonly<Record<string, never>>,
  'channels': {} as Readonly<Record<string, never>>,
  'registryVersion': DEFAULT_REGISTRY_VERSION,
} as const;

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
 * Reserved metadata key used by the work-set scheduler to persist the
 * in-flight work set on interruption. **Consumer nodes must not write
 * to this key.** It is engine-internal and is cleared on resume after
 * the work set is rebuilt and on clean completion.
 *
 * The stored value is a `WorkSetProgress` blob serialised by
 * `WorkSetCheckpoint.write` and read back by `WorkSetCheckpoint.read`.
 * Absent for size-1 canonical runs (one item whose state IS the
 * top-level state); the cursor model handles that case exactly.
 */
export const WORKSET_PROGRESS_KEY = '__dagonizer_workset_progress__';

// Scatter progress types originate in entities/scatter/ScatterProgress.ts;
// re-exported here for public consumers.
export type { ScatterAckedResult, ScatterInboxItem, ScatterProgress, StoredScatterProgress } from './entities/scatter/ScatterProgress.js';

// ── Module-private adapter classes ───────────────────────────────────────────

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
 * Hook-forwarding interface that `ObserverRelayImpl` uses to call back into
 * the dispatcher without depending on `Dagonizer` itself (which is declared
 * below). All six observer hooks have the same signatures as the protected
 * hooks on `Dagonizer`; `Dagonizer.buildObserverRelay` passes `this` bound
 * to this interface.
 */
interface DispatcherHooks<TState extends NodeStateInterface> {
  onNodeStart(nodeName: string, state: TState, placementPath: readonly string[]): void;
  onNodeEnd(nodeName: string, output: string | null, state: TState, placementPath: readonly string[]): void;
  onError(nodeName: string, error: Error, state: TState, placementPath: readonly string[]): void;
  onPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState, placementPath: readonly string[]): void;
  onPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState, placementPath: readonly string[]): void;
  onContractWarning(message: string): void;
}

/**
 * Stable-class implementation of `ObserverRelay`.
 *
 * A fresh object-literal with 6 arrow-function fields would produce a new
 * anonymous hidden class on every call. `ObserverRelayImpl` is a named class
 * whose shape is fixed at declaration time: V8 sees the same hidden class for
 * every relay instance, keeping inline-caches hot on the container dispatch path.
 *
 * Private fields are initialised in constructor-declaration order so the hidden
 * class is consistent across all instances. Only `buildObserverRelay` constructs
 * this; it is not exported.
 */
class ObserverRelayImpl<TState extends NodeStateInterface> implements ObserverRelay {
  readonly #hooks: DispatcherHooks<TState>;
  readonly #state: TState;

  constructor(hooks: DispatcherHooks<TState>, state: TState) {
    this.#hooks = hooks;
    this.#state = state;
  }

  onNodeStart(nodeName: string, placementPath: readonly string[]): void {
    this.#hooks.onNodeStart(nodeName, this.#state, placementPath);
  }

  onNodeEnd(nodeName: string, output: string | null, placementPath: readonly string[]): void {
    this.#hooks.onNodeEnd(nodeName, output, this.#state, placementPath);
  }

  onError(nodeName: string, error: Error, placementPath: readonly string[]): void {
    this.#hooks.onError(nodeName, error, this.#state, placementPath);
  }

  onPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, placementPath: readonly string[]): void {
    this.#hooks.onPhaseEnter(dagName, phase, placementName, this.#state, placementPath);
  }

  onPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, placementPath: readonly string[]): void {
    this.#hooks.onPhaseExit(dagName, phase, placementName, this.#state, placementPath);
  }

  onContractWarning(message: string): void {
    this.#hooks.onContractWarning(message);
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
  accessor?: StateAccessor;
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
   * only). An unbound role resolves to in-process and fires
   * `onContractWarning`.
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
  nodes: NodeInterface<TState, string, TServices>[];
  dags:  DAG[];
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
type _RunOptions = { embedded: boolean };

/**
 * Module-private adapter interface that `_ScatterPoolDriverImpl` uses to
 * call dispatcher methods without requiring access to private class members.
 *
 * The adapter is constructed within `Dagonizer.executeScatter` (where private
 * members are in scope) and passed to `_ScatterPoolDriverImpl`. This is the
 * same pattern used by `#relayHooks` for observer relay construction.
 *
 * Each field is bound at construction time so the adapter object itself has a
 * stable hidden class (same shape every construction).
 */
interface _ScatterDispatchAdapter<TState extends NodeStateInterface, TServices> {
  readonly stateMapper: StateMapper<TState>;
  readonly nodes: ReadonlyMap<string, NodeInterface<TState, string, TServices>>;
  readonly accessor: StateAccessor;
  withNodeTimeout<TResult>(
    node: NodeInterface<TState, string, TServices>,
    signal: AbortSignal | null,
    fn: (sig: AbortSignal) => Promise<TResult>,
  ): Promise<TResult>;
  buildContext(dagName: string, nodeName: string, signal: AbortSignal | null): NodeContextInterface<TServices>;
  runNodes(
    dagName: string,
    state: TState,
    fromStage: string | null,
    options: ExecuteOptionsInterface,
    runOptions: _RunOptions,
    placementPath: readonly string[],
    inputBatch?: Batch<TState>,
    terminalByItemId?: Map<string, 'completed' | 'failed'>,
  ): AsyncGenerator<NodeResultInterface<TState>, ExecutionResultInterface<TState>, void>;
  resolveContainer(role: string | undefined): DagContainerInterface<TState> | null;
  nextCorrelationId(dagName: string): string;
  buildObserverRelay(state: TState): ObserverRelay;
}

/**
 * Context bundle for a single `executeScatter` invocation.
 *
 * Captures the scatter placement config plus the mutable accumulators that
 * `_ScatterPoolDriverImpl.ackItem` writes to. All fields are initialised
 * before the driver is constructed; the driver never creates its own
 * accumulators.
 */
interface _ScatterRunContext<TState extends NodeStateInterface> {
  readonly scatter: ScatterNode;
  readonly state: TState;
  readonly dagName: string;
  readonly signal: AbortSignal | null;
  readonly placementPath: readonly string[];
  readonly itemKey: string;
  readonly inbox: ScatterInboxItem[];
  readonly ackedResults: ScatterAckedResult[];
  readonly ackedByIndex: Map<number, ScatterAckedResult>;
  readonly itemOutputs: Map<number, string>;
  readonly allFreshRecords: GatherRecord<TState>[];
  readonly intermediateResults: Array<NodeResultInterface<TState>>;
  readonly gatherStrategy: GatherStrategy | null;
  readonly compactable: boolean;
  readonly watermarkRef: { value: number };
  readonly aheadAcked: Map<number, string>;
  readonly outcomeTally: Map<string, number>;
}

/**
 * Records the item in `outcomeTally` and `aheadAcked`, then drains
 * consecutive indices from `aheadAcked` into the watermark so that
 * the watermark always equals the highest contiguous completed prefix.
 */
function advanceWatermark(
  watermarkRef: { value: number },
  aheadAcked: Map<number, string>,
  outcomeTally: Map<string, number>,
  index: number,
  output: string,
): void {
  // Always fold output into tally for every acked item.
  outcomeTally.set(output, (outcomeTally.get(output) ?? 0) + 1);
  // Place acked index into the ahead window (handles any index >= watermark).
  aheadAcked.set(index, output);
  // Greedily advance watermark while contiguous indices exist.
  while (aheadAcked.has(watermarkRef.value)) {
    aheadAcked.delete(watermarkRef.value);
    watermarkRef.value++;
  }
}

/**
 * Module-private driver: bridges `ScatterWorkerPool` to `Dagonizer` internals.
 *
 * Constructed once per `executeScatter` call with a stable adapter + context.
 * Implements `ScatterPoolDriverInterface<TState>` without accessing private
 * members on `Dagonizer` directly.
 */
class _ScatterPoolDriverImpl<TState extends NodeStateInterface, TServices>
  implements ScatterPoolDriverInterface<TState>, ReservoirDriverInterface<TState>
{
  readonly #adapter: _ScatterDispatchAdapter<TState, TServices>;
  readonly #ctx: _ScatterRunContext<TState>;

  constructor(
    adapter: _ScatterDispatchAdapter<TState, TServices>,
    ctx: _ScatterRunContext<TState>,
  ) {
    this.#adapter = adapter;
    this.#ctx = ctx;
  }

  async executeItem(itemIndex: number, item: unknown): Promise<ScatterItemResult<TState>> {
    const { scatter, state, dagName, signal, placementPath, itemKey } = this.#ctx;
    const cloneState = this.#adapter.stateMapper.createChild(
      state,
      ScatterNodeDefaults.inputMapping(scatter),
    );
    // item must be JSON-serialisable: scatter sources are checkpointed to
    // metadata (SCATTER_PROGRESS_KEY) and require JSON-safe values at snapshot
    // time. The engine contract requires callers to provide JSON-safe scatter
    // sources for checkpointing to succeed.
    cloneState.setMetadata(itemKey, item);
    cloneState.setMetadata('itemIndex', itemIndex);

    if ('node' in scatter.body) {
      // Node body: build a size-1 Batch and execute.
      const dagNode = this.#adapter.nodes.get(scatter.body.node);
      if (!dagNode) {
        throw new DAGError(`ScatterNode '${scatter.name}': unknown node '${scatter.body.node}'`);
      }

      // Build a size-1 Batch with item-index as id.
      const batch = Batch.from([{ 'id': String(itemIndex), 'state': cloneState }]);

      // Execute the node over the batch.
      const routed = await this.#adapter.withNodeTimeout(dagNode, signal, async (nodeSignal) => {
        const context = this.#adapter.buildContext(dagName, scatter.name, nodeSignal);
        return dagNode.execute(batch, context);
      });

      // Derive output from the single routed entry.
      let output = 'error';
      for (const [routeKey, routeBatch] of routed.entries()) {
        for (const batchEntry of routeBatch) {
          if (batchEntry.id === String(itemIndex)) {
            output = routeKey;
          }
        }
      }

      for (const err of cloneState.errors) state.collectError(err);
      for (const warn of cloneState.warnings) state.collectWarning(warn);
      return { 'index': itemIndex, item, output, 'terminalOutcome': null, 'cloneState': cloneState };
    } else {
      // DAG body path.
      let output: string;
      let terminalOutcome: 'completed' | 'failed' | null;

      // DAG body — may run in-process or through a bound container.
      const innerPath: readonly string[] = [...placementPath, scatter.name];
      const container = this.#adapter.resolveContainer(scatter.container);

      if (container === null) {
        // ── In-process path (byte-identical to the original) ───────────────
        const childOptions: ExecuteOptionsInterface = { ...(signal !== null && { 'signal': signal }) };
        const iter = this.#adapter.runNodes(scatter.body.dag, cloneState, null, childOptions, { 'embedded': true }, innerPath);

        // Drain the iterator to drive execution; each inner node fires its
        // onNodeStart/onNodeEnd observers live inside runNodes. Buffering each
        // inner result into intermediateResults is intentionally omitted: at
        // scatter scale (N items × M inner nodes) that accumulation is O(N*M)
        // and causes unbounded heap growth. The scatter's own representative
        // result is returned below; inner-node observability is delivered
        // through the observer relay, not through buffered intermediates.
        while (true) {
          const step = await iter.next();
          if (step.done) {
            terminalOutcome = step.value.terminalOutcome;
            break;
          }
        }
      } else {
        // ── Contained path ─────────────────────────────────────────────────
        const correlationId = this.#adapter.nextCorrelationId(scatter.body.dag);
        const context = this.#adapter.buildContext(scatter.body.dag, scatter.name, signal);
        const task = new DagTask<TState, TServices>(
          scatter.body.dag,
          innerPath,
          correlationId,
          Timeout.none(),
          cloneState,
          context,
        );

        const scatterRelay = this.#adapter.buildObserverRelay(state);
        const outcome = await container.runDag(task, { 'relay': scatterRelay });

        // Infrastructure/transport failure (worker died, channel lost): the
        // child DAG never ran to a terminal. Throw so the pool takes the
        // reject branch → poolError set → item is NOT acked → it stays in
        // the inbox → resume reprocesses it. This matches the in-process path
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

        // Contained inner-node intermediates are not buffered into
        // intermediateResults: the contained body's observer relay delivers
        // per-node observability live, and buffering at scatter scale is O(N*M).

        // Derive terminalOutcome from the container's terminal output.
        terminalOutcome = outcome.terminalOutput === 'failed' ? 'failed' : 'completed';
      }

      const hasUnrecoverable = cloneState.errors.some((e) => e.recoverable === false);
      output = (terminalOutcome === 'failed' || hasUnrecoverable) ? 'error' : 'success';

      for (const err of cloneState.errors) state.collectError(err);
      for (const warn of cloneState.warnings) state.collectWarning(warn);

      return { 'index': itemIndex, item, output, terminalOutcome, 'cloneState': cloneState };
    }
  }

  async ackItem(res: ScatterItemResult<TState>): Promise<void> {
    const { scatter, state, inbox, ackedResults, ackedByIndex, itemOutputs, allFreshRecords, gatherStrategy, compactable, watermarkRef, aheadAcked, outcomeTally } = this.#ctx;
    const { 'index': itemIndex, 'item': item, 'output': output, 'terminalOutcome': terminalOutcome, 'cloneState': cloneState } = res;

    // Remove from inbox.
    const inboxIdx = inbox.findIndex((e) => e.index === itemIndex);
    if (inboxIdx !== -1) inbox.splice(inboxIdx, 1);

    const freshRecord: GatherRecord<TState> = {
      'index': itemIndex,
      item,
      output,
      terminalOutcome,
      cloneState,
    };

    // Fold this record into state via reduce (exactly-once per item).
    if (scatter.gather !== undefined && gatherStrategy !== null) {
      const batchItems = [{ 'id': String(itemIndex), 'state': freshRecord }];
      await gatherStrategy.reduce(scatter.gather, Batch.from(batchItems), state, this.#adapter.accessor);
    }

    // Accumulate for the finalize pass and outcome-reducer.
    // Compactable gathers fold all state into parent via reduce; finalize builds
    // derived state from its own private accumulators and does not read records.
    // Skip the push in compactable mode so each cloneState is GC-eligible
    // immediately after reduce returns — preserving the bounded-memory guarantee.
    if (!compactable) allFreshRecords.push(freshRecord);

    if (compactable) {
      // Bounded mode: advance watermark bookkeeping; skip full ackedResult storage.
      // shape changed for compactable gathers; result assertion unchanged.
      advanceWatermark(watermarkRef, aheadAcked, outcomeTally, itemIndex, output);
      ScatterCheckpoint.writeBounded(
        state, scatter.name, [...inbox], watermarkRef.value,
        [...aheadAcked.entries()].map(([i, o]) => ({ 'index': i, 'output': o })),
        Object.fromEntries(outcomeTally),
      );
    } else {
      // Retained mode: persist full acked result for reconstruct on resume.
      const ackedResult: ScatterAckedResult = (() => {
        if (scatter.gather?.strategy === 'map' && scatter.gather.mapping !== undefined) {
          const snapshot: Record<string, unknown> = {};
          for (const clonePath of Object.keys(scatter.gather.mapping)) {
            snapshot[clonePath] = this.#adapter.accessor.get(cloneState, clonePath);
          }
          return { 'kind': 'map' as const, 'index': itemIndex, 'item': item, output, 'mappingValues': snapshot };
        }
        if (
          (scatter.gather?.strategy === 'append' || scatter.gather?.strategy === 'partition') &&
          scatter.gather.field !== undefined
        ) {
          return { 'kind': 'field' as const, 'index': itemIndex, 'item': item, output, 'fieldValue': this.#adapter.accessor.get(cloneState, scatter.gather.field) };
        }
        return { 'kind': 'plain' as const, 'index': itemIndex, 'item': item, output };
      })();
      ackedResults.push(ackedResult);
      ackedByIndex.set(itemIndex, ackedResult);
      itemOutputs.set(itemIndex, output);
      ScatterCheckpoint.writeRetained(state, scatter.name, [...inbox], [...ackedResults]);
    }
  }

  /**
   * Execute a batch of buffered reservoir items.
   *
   * Dispatches to one of three branches depending on the scatter body:
   *
   * - **Branch A (node body):** builds a size-N Batch, calls `node.execute(batch)`
   *   once, and derives each item's output from the routed entries.
   * - **Branch B (DAG body, in-process):** runs each clone's sub-DAG in-process
   *   sequentially via `runNodes`, collects `terminalOutcome` per clone.
   * - **Branch C (DAG body, container):** routes to `DagContainerBase.runDagBatch`
   *   when the container is a `DagContainerBase` instance (one transport round-trip
   *   for all items); falls back to per-item `container.runDag` for plain
   *   `DagContainerInterface` implementations.
   *
   * Errors and warnings from each clone are collected into the parent state.
   */
  async executeBatch(items: { index: number; item: unknown; bufferKey: string }[]): Promise<ScatterItemBatchResult<TState>> {
    const { scatter, state, dagName, signal, placementPath, itemKey } = this.#ctx;

    if ('node' in scatter.body) {
      // ── Branch A: node body ─────────────────────────────────────────────────
      const dagNode = this.#adapter.nodes.get(scatter.body.node);
      if (!dagNode) {
        throw new DAGError(`ScatterNode '${scatter.name}': unknown node '${scatter.body.node}'`);
      }

      // Build N child clones and a size-N Batch.
      const clones: TState[] = [];
      const batchItems: { id: string; state: TState }[] = [];
      for (const buffered of items) {
        const clone = this.#adapter.stateMapper.createChild(state, ScatterNodeDefaults.inputMapping(scatter));
        clone.setMetadata(itemKey, buffered.item);
        clone.setMetadata('itemIndex', buffered.index);
        clones.push(clone);
        batchItems.push({ 'id': String(buffered.index), 'state': clone });
      }

      const batch = Batch.from(batchItems);
      const routed = await this.#adapter.withNodeTimeout(dagNode, signal, async (nodeSignal) => {
        const context = this.#adapter.buildContext(dagName, scatter.name, nodeSignal);
        return dagNode.execute(batch, context);
      });

      // Map item id → route key.
      const outputById = new Map<string, string>();
      for (const [routeKey, routeBatch] of routed.entries()) {
        for (const batchEntry of routeBatch) {
          outputById.set(batchEntry.id, routeKey);
        }
      }

      // Collect errors/warnings from each clone and build results.
      const results: ScatterItemResult<TState>[] = items.map((buffered, i) => {
        const clone = clones[i] as TState;
        for (const err of clone.errors) state.collectError(err);
        for (const warn of clone.warnings) state.collectWarning(warn);
        return {
          'index': buffered.index,
          'item': buffered.item,
          'output': outputById.get(String(buffered.index)) ?? 'error',
          'terminalOutcome': null,
          'cloneState': clone,
        };
      });

      return { results };
    }

    // ── Branch B / C: DAG body ────────────────────────────────────────────────
    const innerPath: readonly string[] = [...placementPath, scatter.name];
    const container = this.#adapter.resolveContainer(scatter.container);

    // Build N child clones (same seeding as per-item executeItem dag path).
    const clones: TState[] = [];
    const batchItems: { id: string; state: TState }[] = [];
    for (const buffered of items) {
      const clone = this.#adapter.stateMapper.createChild(state, ScatterNodeDefaults.inputMapping(scatter));
      clone.setMetadata(itemKey, buffered.item);
      clone.setMetadata('itemIndex', buffered.index);
      clones.push(clone);
      batchItems.push({ 'id': String(buffered.index), 'state': clone });
    }
    const batch = Batch.from(batchItems);

    if (container === null) {
      // ── Branch B: DAG body, in-process ──────────────────────────────────────
      const childOptions: ExecuteOptionsInterface = { ...(signal !== null && { 'signal': signal }) };

      // Run each clone's DAG body in-process sequentially (bounded concurrency is
      // managed by the ReservoirBuffer; each batch is already size-controlled).
      const terminalOutcomes: Array<'completed' | 'failed' | null> = [];
      for (let i = 0; i < items.length; i++) {
        const clone = clones[i] as TState;
        const iter = this.#adapter.runNodes(scatter.body.dag, clone, null, childOptions, { 'embedded': true }, innerPath);
        // Drain the generator and capture the terminal outcome from the return value.
        let step = await iter.next();
        while (!step.done) {
          step = await iter.next();
        }
        terminalOutcomes.push(step.value.terminalOutcome);
      }

      const results: ScatterItemResult<TState>[] = items.map((buffered, i) => {
        const clone = clones[i] as TState;
        const terminalOutcome = terminalOutcomes[i] ?? null;
        const hasUnrecoverable = clone.errors.some((e) => e.recoverable === false);
        const output = (terminalOutcome === 'failed' || hasUnrecoverable) ? 'error' : 'success';
        for (const err of clone.errors) state.collectError(err);
        for (const warn of clone.warnings) state.collectWarning(warn);
        return {
          'index': buffered.index,
          'item': buffered.item,
          output,
          terminalOutcome,
          'cloneState': clone,
        };
      });

      return { results };
    }

    // ── Branch C: DAG body with container ─────────────────────────────────────
    const correlationId = this.#adapter.nextCorrelationId(scatter.body.dag);
    const context = this.#adapter.buildContext(scatter.body.dag, scatter.name, signal);
    const scatterRelay = this.#adapter.buildObserverRelay(state);

    let outcomes: BatchRunResult[];

    if (container instanceof DagContainerBase) {
      // runDagBatch: one transport round-trip for all items.
      // Build a representative task for signal/context/timeout; per-item states come from the batch.
      const task = new DagTask<TState, TServices>(
        scatter.body.dag,
        innerPath,
        correlationId,
        Timeout.none(),
        clones[0] as TState,
        context,
      );
      outcomes = await (container as DagContainerBase<TState, TServices>).runDagBatch(task, batch, { 'relay': scatterRelay });
    } else {
      // Fallback: per-item sequential runDag for custom DagContainerInterface implementations.
      outcomes = [];
      for (let i = 0; i < items.length; i++) {
        const clone = clones[i] as TState;
        const buffered = items[i] as { index: number; item: unknown; bufferKey: string };
        const itemCorrelationId = this.#adapter.nextCorrelationId(scatter.body.dag);
        const itemContext = this.#adapter.buildContext(scatter.body.dag, scatter.name, signal);
        const task = new DagTask<TState, TServices>(
          scatter.body.dag,
          innerPath,
          itemCorrelationId,
          Timeout.none(),
          clone,
          itemContext,
        );
        const outcome = await container.runDag(task, { 'relay': scatterRelay });
        outcomes.push({ 'id': String(buffered.index), ...outcome });
      }
    }

    // Infrastructure failure check: any item with an infrastructure error → throw (at-least-once).
    for (const outcome of outcomes) {
      if (outcome.errors.some((e) => TransportErrorCode.isInfrastructureFailure(e.code))) {
        const infra = outcome.errors.find((e) => TransportErrorCode.isInfrastructureFailure(e.code));
        throw new ExecutionError(
          `ScatterNode '${scatter.name}': container infrastructure failure — ${infra?.message ?? 'transport lost'}`,
        );
      }
    }

    // Build results from outcomes.
    const results: ScatterItemResult<TState>[] = items.map((buffered, i) => {
      const clone = clones[i] as TState;
      const outcome = outcomes.find((o) => o.id === String(buffered.index));

      if (outcome === undefined) {
        // No outcome for this item — treat as infrastructure failure path (should not happen).
        for (const err of clone.errors) state.collectError(err);
        for (const warn of clone.warnings) state.collectWarning(warn);
        return {
          'index': buffered.index,
          'item': buffered.item,
          'output': 'error',
          'terminalOutcome': 'failed' as const,
          'cloneState': clone,
        };
      }

      // Apply terminal state snapshot back to clone for domain state.
      if (outcome.stateSnapshot !== null) {
        clone.applySnapshot(outcome.stateSnapshot);
      }
      for (const err of outcome.errors) clone.collectError(err);

      const terminalOutcome: 'completed' | 'failed' = outcome.terminalOutput === 'failed' ? 'failed' : 'completed';
      const hasUnrecoverable = clone.errors.some((e) => e.recoverable === false);
      const output = (terminalOutcome === 'failed' || hasUnrecoverable) ? 'error' : 'success';

      for (const err of clone.errors) state.collectError(err);
      for (const warn of clone.warnings) state.collectWarning(warn);

      return {
        'index': buffered.index,
        'item': buffered.item,
        output,
        terminalOutcome,
        'cloneState': clone,
      };
    });

    return { results };
  }

  /**
   * Acknowledge a batch of items: remove all from inbox, build acked results,
   * fold them into parent state via a SINGLE `gatherStrategy.reduce` call, and
   * write the checkpoint ONCE for the entire batch.
   */
  async ackBatch(batchResult: ScatterItemBatchResult<TState>): Promise<void> {
    const { scatter, state, inbox, ackedResults, ackedByIndex, itemOutputs, allFreshRecords, gatherStrategy, compactable, watermarkRef, aheadAcked, outcomeTally } = this.#ctx;

    const freshRecordsForBatch: GatherRecord<TState>[] = [];

    for (const res of batchResult.results) {
      const { 'index': itemIndex, 'item': item, 'output': output, 'terminalOutcome': terminalOutcome, 'cloneState': cloneState } = res;

      // Remove from inbox.
      const inboxIdx = inbox.findIndex((e) => e.index === itemIndex);
      if (inboxIdx !== -1) inbox.splice(inboxIdx, 1);

      const freshRecord: GatherRecord<TState> = { 'index': itemIndex, item, output, terminalOutcome, cloneState };
      freshRecordsForBatch.push(freshRecord);
      // Compactable mode: skip accumulation so each cloneState is GC-eligible
      // after the batch reduce below — same bounded-memory invariant as ackItem.
      if (!compactable) allFreshRecords.push(freshRecord);

      if (compactable) {
        // Bounded mode: advance watermark per item.
        advanceWatermark(watermarkRef, aheadAcked, outcomeTally, itemIndex, output);
      } else {
        // Retained mode: build full acked result.
        const ackedResult: ScatterAckedResult = (() => {
          if (scatter.gather?.strategy === 'map' && scatter.gather.mapping !== undefined) {
            const snapshot: Record<string, unknown> = {};
            for (const clonePath of Object.keys(scatter.gather.mapping)) {
              snapshot[clonePath] = this.#adapter.accessor.get(cloneState, clonePath);
            }
            return { 'kind': 'map' as const, 'index': itemIndex, 'item': item, output, 'mappingValues': snapshot };
          }
          if (
            (scatter.gather?.strategy === 'append' || scatter.gather?.strategy === 'partition') &&
            scatter.gather.field !== undefined
          ) {
            return { 'kind': 'field' as const, 'index': itemIndex, 'item': item, output, 'fieldValue': this.#adapter.accessor.get(cloneState, scatter.gather.field) };
          }
          return { 'kind': 'plain' as const, 'index': itemIndex, 'item': item, output };
        })();
        ackedResults.push(ackedResult);
        ackedByIndex.set(itemIndex, ackedResult);
        itemOutputs.set(itemIndex, output);
      }
    }

    // Single reduce call for the whole batch.
    if (scatter.gather !== undefined && gatherStrategy !== null) {
      const batchItems = freshRecordsForBatch.map((r) => ({ 'id': String(r.index), 'state': r }));
      await gatherStrategy.reduce(scatter.gather, Batch.from(batchItems), state, this.#adapter.accessor);
    }

    // Single checkpoint write for the entire batch.
    if (compactable) {
      // shape changed for compactable gathers; result assertion unchanged.
      ScatterCheckpoint.writeBounded(
        state, scatter.name, [...inbox], watermarkRef.value,
        [...aheadAcked.entries()].map(([i, o]) => ({ 'index': i, 'output': o })),
        Object.fromEntries(outcomeTally),
      );
    } else {
      ScatterCheckpoint.writeRetained(state, scatter.name, [...inbox], [...ackedResults]);
    }
  }
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
implements DagonizerInterface<TState, TServices>, WarningEmitter {
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
  private readonly channels: Readonly<Record<string, HandoffChannelInterface>>;
  private readonly registryVersion: string;
  /**
   * Stable `DispatcherHooks` adapter bound to this instance's protected hooks.
   * Created once in the constructor and reused by every `buildObserverRelay`
   * call so that relay construction allocates only the `ObserverRelayImpl`
   * instance (stable hidden class) without a fresh closure-bearing adapter on
   * each invocation.
   */
  readonly #relayHooks: DispatcherHooks<TState>;
  #correlationSeq = 0;

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
    bufferIntermediates: boolean,
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
    const resolved = Dagonizer.options<TState, TServices>(options);
    this.accessor = resolved.accessor;
    this.services = resolved.services;
    this.stateMapper = new StateMapper<TState>(this.accessor);
    this.containers = resolved.containers;
    this.channels = resolved.channels;
    this.registryVersion = resolved.registryVersion;
    // Build the relay hooks adapter once per instance; bound to `this` here
    // (within the class body, so protected hooks are accessible).
    this.#relayHooks = {
      'onNodeStart': (n, s, p) => this.onNodeStart(n, s, p),
      'onNodeEnd':   (n, o, s, p) => this.onNodeEnd(n, o, s, p),
      'onError':     (n, e, s, p) => this.onError(n, e, s, p),
      'onPhaseEnter': (d, ph, pl, s, p) => this.onPhaseEnter(d, ph, pl, s, p),
      'onPhaseExit':  (d, ph, pl, s, p) => this.onPhaseExit(d, ph, pl, s, p),
      'onContractWarning': (m) => this.onContractWarning(m),
    };
    this.dispatch = {
      'EmbeddedDAGNode': (entry, state, _dagName, signal, placementPath, bufferIntermediates) => {
        // Placement.isEmbeddedDAG guard: @type === 'EmbeddedDAGNode' confirmed by
        // the dispatch table key; guard makes the narrowing explicit.
        if (!Placement.isEmbeddedDAG(entry)) throw new DAGError(`Dispatch type mismatch: expected EmbeddedDAGNode`);
        return this.executeEmbeddedDAG(entry, state, signal, placementPath, bufferIntermediates);
      },
      'ScatterNode': (entry, state, dagName, signal, placementPath) => {
        if (!Placement.isScatter(entry)) throw new DAGError(`Dispatch type mismatch: expected ScatterNode`);
        return this.executeScatter(entry, state, dagName, signal, placementPath);
      },
      // SingleNode is handled structurally by the work-set scheduler (via
      // #fireSinglePlacement) before executeDAGNode is called; this entry is
      // unreachable in normal operation but keeps the dispatch table exhaustive
      // over the DAGNodeAtType union. executeSingleNode is preserved here so
      // the method is not flagged as unused by static analysis.
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

  /**
   * Satisfies `WarningEmitter`. Routes contract warnings to the
   * dispatcher's `onContractWarning` hook. Called by
   * `ContractRegistryValidator.validate` when the dispatcher is passed
   * as the emitter directly.
   */
  warn(message: string): void {
    this.onContractWarning(message);
  }

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
   *
   * Returns an `ObserverRelayImpl` instance (stable hidden class) rather than
   * a fresh anonymous object-literal, so V8 inline-caches stay monomorphic
   * on the container dispatch path.
   *
   * A `DispatcherHooks` adapter is constructed here (within the class body so
   * `protected` members are accessible) and passed to `ObserverRelayImpl`.
   */
  private buildObserverRelay(state: TState): ObserverRelay {
    return new ObserverRelayImpl<TState>(this.#relayHooks, state);
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
    options: ExecuteOptionsInterface = {},
  ): readonly Execution<TState>[] {
    return batchStates.map((state) =>
      new Execution<TState>(() => this.runNodes(dagName, state, null, options)),
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
    inputBatch?: Batch<TState>,
    terminalByItemId?: Map<string, 'completed' | 'failed'>,
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
        (n): n is PhaseNode =>
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

    let cursor: null | string = fromStage ?? dag.entrypoint;
    let terminalOutcome: 'completed' | 'failed' | null = null;

    // Skip phase placements in the main loop; they are out-of-band and
    // never the entrypoint. If the consumer's fromStage / entrypoint happens
    // to name a phase placement, treat it as if the main loop is empty.
    if (cursor !== null && this.isPhaseEntry(dagName, cursor)) {
      cursor = null;
    }

    // ── Work-set scheduler ──────────────────────────────────────────────────
    // Initialize the work set with the input state at the entry placement.
    // When cursor is null (phase-entry guard tripped), skip the main loop.
    if (cursor !== null) {
      // Build rank and declaration-index maps once per walk.
      const rankMap = PlacementRank.compute(dag);
      const declIndex = new Map<string, number>();
      for (let i = 0; i < dag.nodes.length; i++) {
        declIndex.set((dag.nodes[i] as DAGNodeType).name, i);
      }

      const rankOf = (name: string): number => rankMap.get(name) ?? Number.MAX_SAFE_INTEGER;
      const declIndexOf = (name: string): number => declIndex.get(name) ?? Number.MAX_SAFE_INTEGER;

      const pending = new WorkSet<TState>();

      // Resume: when fromStage is provided and this is a top-level run, check
      // for a persisted work-set blob. If present, rebuild `pending` from it so
      // every in-flight item's state is restored exactly. If absent, fall through
      // to the size-1 seed below (the cursor model — byte-identical to before).
      if (fromStage !== null && !runOptions.embedded) {
        const workSetBlob = WorkSetCheckpoint.read(state);
        if (workSetBlob !== undefined) {
          // Rebuild pending from the blob: for each placement, reconstruct each
          // item's state via clone + applySnapshot, then accumulate into the
          // work set in declaration order.
          //
          // `state.clone()` copies the current metadata (including the blob),
          // but `applySnapshot` resets metadata and repopulates from the item
          // snapshot, so reconstructed item states do not carry the parent blob.
          for (const entry of workSetBlob.entries) {
            const items: Array<{ 'id': string; 'state': TState }> = [];
            for (const workItem of entry.items) {
              const itemState = state.clone();
              // workItem.snapshot is typed as `{}` by json-schema-to-ts for
              // `{ type: 'object' }`. The engine contract requires snapshots to
              // be JSON-safe objects (they were produced by `state.snapshot()`
              // which returns `JsonObject`). Cast at the single ingest boundary.
              itemState.applySnapshot(workItem.snapshot as JsonObject);
              items.push({ 'id': workItem.id, 'state': itemState });
            }
            pending.add(entry.placement, Batch.from(items));
          }
          // Clear the blob from all reconstructed item states (applySnapshot
          // already reset each clone's metadata from its item snapshot, so the
          // blob is absent there). Clear from the top-level state too so a
          // re-interrupted run captures a fresh blob rather than the old one.
          WorkSetCheckpoint.clear(state);
        } else {
          // Size-1 canonical resume: no blob → seed with the top-level state at
          // the cursor. Byte-identical to the existing checkpoint test path.
          pending.add(cursor, Batch.of(state));
        }
      } else {
        // Fresh execute (fromStage === null) or embedded: seed with the
        // provided inputBatch when supplied (batch-native embedded path),
        // otherwise seed with the single top-level state.
        pending.add(cursor, inputBatch ?? Batch.of(state));
      }

      // Terminal accumulator: collects batches per terminal name so all items
      // reaching terminal nodes are processed before outcome is determined.
      // For size-1 batches this is a map with exactly one entry of size 1,
      // and the behaviour is byte-identical to the prior break-on-first path.
      const terminalAccumulator = new Map<string, { 'outcome': 'completed' | 'failed'; 'batch': Batch<TState> }>();

      // Work-set scheduling loop.
      // For size-1 input: exactly one placement holds exactly one item at all
      // times; nextReady returns that placement, SingleNode fires over the
      // size-1 batch returning one route with one item, and the item advances
      // to the next placement.
      scheduleLoop: while (true) {
        const currentPlacementName = pending.nextReady(rankOf, declIndexOf);
        if (currentPlacementName === null) break scheduleLoop;

        // Advance cursor to the placement about to fire, immediately after
        // picking, so the abort-check result correctly identifies the placement
        // that would have fired.
        cursor = currentPlacementName;

        // Abort check: fires before each placement.
        if (signal?.aborted) {
          const abortInfo = this.handleAbort(state, signal);
          this.onError(currentPlacementName, abortInfo.error, state, placementPath);
          const interruptedAt: InterruptionInfo = {
            'nodeName': currentPlacementName,
            'reason':   abortInfo.reason,
          };

          // Work-set serialization for top-level runs: persist the in-flight
          // work set so a subsequent resume can rebuild `pending` with the
          // correct item states for every placement.
          //
          // Size-1 canonical detection: exactly one item total across the whole
          // work set AND that item's state is reference-equal to the top-level
          // state. When this holds, the cursor model already captures everything
          // (cursor = placement name, state = top-level state) and no blob is
          // needed — byte-identical to existing behaviour. When it does NOT hold
          // (multi-item or a cloned item state), write the blob.
          if (!runOptions.embedded) {
            let totalItems = 0;
            let canonicalState: TState | undefined;
            for (const [, batch] of pending.entries()) {
              for (const item of batch) {
                totalItems++;
                canonicalState = item.state;
              }
            }
            const isSize1Canonical = totalItems === 1 && canonicalState === state;

            if (!isSize1Canonical) {
              // Build the WorkSetProgress blob from the current `pending` map.
              // Each entry serialises one placement's batch (in item order).
              const entries: WorkSetProgress['entries'] = [];
              for (const [placement, batch] of pending.entries()) {
                const items: WorkSetProgress['entries'][number]['items'] = [];
                for (const item of batch) {
                  items.push({ 'id': item.id, 'snapshot': item.state.snapshot() });
                }
                entries.push({ placement, items });
              }
              WorkSetCheckpoint.write(state, { entries });
            }
          }

          const result = this.buildResult(cursor, executedNodes, skippedNodes, terminalOutcome, interruptedAt, state);
          await this.runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, placementPath);
          return result;
        }

        // Take the batch pending at this placement.
        const batch = pending.take(currentPlacementName) as Batch<TState>;

        const node = this.nodeIndex.get(`${dagName}:${currentPlacementName}`);

        if (!node) {
          const error = new DAGError(`Unknown node: ${currentPlacementName} in DAG ${dagName}`);
          this.onError(currentPlacementName, error, state, placementPath);
          if (!runOptions.embedded) {
            try { state.markFailed(error); } catch { /* already terminal */ }
          }
          const result = this.buildResult(cursor, executedNodes, skippedNodes, terminalOutcome, null, state);
          await this.runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, placementPath);
          return result;
        }

        // Representative state: first item in the batch. For size-1 batches
        // this is identical to the single cursor state — byte-identical to today.
        const repState = batch.row(0).state;

        this.onNodeStart(node.name, repState, placementPath);

        // TerminalNode: no-op execution — capture outcome, synthesize result,
        // fire onNodeEnd, and continue the work-set loop so remaining items
        // can reach their own terminals (which may differ in multi-item batches).
        if (Placement.isTerminal(node)) {
          const terminal = node;
          // Accumulate this terminal's batch. Multiple items may arrive at the
          // same terminal (coalesced by the work-set) or at different terminals.
          const existing = terminalAccumulator.get(terminal.name);
          if (existing === undefined) {
            terminalAccumulator.set(terminal.name, { 'outcome': terminal.outcome, 'batch': batch });
          } else {
            // Same terminal reached by items in separate work-set turns; merge.
            const merged: Array<{ 'id': string; 'state': TState }> = [];
            for (const item of existing.batch) merged.push({ 'id': item.id, 'state': item.state });
            for (const item of batch) merged.push({ 'id': item.id, 'state': item.state });
            terminalAccumulator.set(terminal.name, { 'outcome': terminal.outcome, 'batch': Batch.from(merged) });
          }
          // Populate per-item terminal map when the caller requested it (batch-native
          // embedded path needs to know which items ended at which terminal kind).
          if (terminalByItemId !== undefined) {
            for (const item of batch) {
              terminalByItemId.set(item.id, terminal.outcome);
            }
          }
          executedNodes.push(terminal.name);
          const terminalResult: NodeResultInterface<TState> = {
            'output': terminal.outcome,
            'skipped': false,
            'nodeName': terminal.name,
            'state': repState,
            'intermediateResults': [],
          };
          this.onNodeEnd(terminal.name, terminal.outcome, repState, placementPath);
          yield terminalResult;
          continue scheduleLoop;
        }

        // SingleNode: batch-native path.
        if (Placement.isSingle(node)) {
          let nodeResult: NodeResultInterface<TState>;
          try {
            nodeResult = await this.#fireSinglePlacement(node, batch, dagName, signal, pending);
          } catch (caughtError) {
            const error = caughtError instanceof Error ? caughtError : new ExecutionError(String(caughtError));
            this.onError(currentPlacementName, error, repState, placementPath);
            let interruptedAt: InterruptionInfo | null = null;
            if (signal?.aborted) {
              if (!runOptions.embedded) {
                const abortInfo = this.handleAbort(state, signal);
                interruptedAt = { 'nodeName': currentPlacementName, 'reason': abortInfo.reason };
              } else {
                const isTimeout = signal.reason instanceof Error && signal.reason.name === 'TimeoutError';
                interruptedAt = { 'nodeName': currentPlacementName, 'reason': isTimeout ? 'timeout' : 'abort' };
              }
            } else if (error instanceof NodeTimeoutError) {
              interruptedAt = { 'nodeName': currentPlacementName, 'reason': 'timeout' };
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

          executedNodes.push(nodeResult.nodeName);
          this.onNodeEnd(node.name, nodeResult.output, repState, placementPath);
          yield nodeResult;
          continue scheduleLoop;
        }

        // EmbeddedDAGNode batch-native path (in-process only): run the child DAG
        // once over all N items as a single batch rather than N separate calls.
        // This avoids N redundant DAG setups and preserves batch semantics in
        // the child flow. Only applies when the container resolves to null (in-
        // process); the contained path uses per-item executeDAGNode below.
        if (Placement.isEmbeddedDAG(node) && this.resolveContainer(node.container) === null) {
          const inputMapping = EmbeddedDAGNodeDefaults.inputMapping(node);
          const outputMapping = EmbeddedDAGNodeDefaults.outputMapping(node);
          const innerPath: readonly string[] = [...placementPath, node.name];

          // Build child batch: one clone per parent item, seeded via inputMapping.
          const parentItems = [...batch];
          const childItems: Array<{ 'id': string; 'state': TState }> = [];
          for (const item of parentItems) {
            const childClone = this.stateMapper.createChild(item.state, inputMapping);
            childItems.push({ 'id': item.id, 'state': childClone });
          }
          const childBatch = Batch.from(childItems);

          // Per-item terminal outcome map: populated by the child runNodes when
          // each item reaches a TerminalNode. Maps item.id → terminal outcome.
          const childTerminalByItemId = new Map<string, 'completed' | 'failed'>();

          // Run the child DAG once over all N items (batch-native embedded).
          // `childRepState` is a standalone clone used as the `state` argument
          // required by the runNodes signature; the actual items are in childBatch.
          const childRepState = repState.clone();
          const childOptions: ExecuteOptionsInterface = { ...(signal !== null && { 'signal': signal }) };
          const intermediateResults: Array<NodeResultInterface<TState>> = [];
          const iter = this.runNodes(node.dag, childRepState, null, childOptions, { 'embedded': true }, innerPath, childBatch, childTerminalByItemId);

          // Collect inner intermediates when streaming (top-level only); at nested
          // or composite scale, drain without buffering to avoid O(N*M*L) heap.
          if (!runOptions.embedded) {
            let step = await iter.next();
            while (!step.done) {
              const nr = step.value;
              intermediateResults.push({
                'output': nr.output,
                'skipped': nr.skipped,
                'nodeName': `${node.name}.${nr.nodeName}`,
                'state': repState,
                'intermediateResults': [],
              });
              step = await iter.next();
            }
          } else {
            while (true) {
              const step = await iter.next();
              if (step.done) break;
            }
          }

          // Route each parent item by its child clone's terminal outcome + errors.
          const routeOutputByItemId = new Map<string, string>();
          for (let i = 0; i < parentItems.length; i++) {
            // parentItems and childItems are parallel arrays built above, so both
            // index i are always within bounds inside this loop.
            const parentItem = parentItems[i] as (typeof parentItems)[number];
            const childClone = (childItems[i] as (typeof childItems)[number]).state;

            // Propagate errors and warnings from child clone to parent.
            for (const err of childClone.errors) parentItem.state.collectError(err);
            for (const warn of childClone.warnings) parentItem.state.collectWarning(warn);

            // Apply output state mapping: child → parent.
            this.stateMapper.mapOutput(childClone, parentItem.state, outputMapping);

            // Determine route from per-item terminal outcome + unrecoverable errors.
            // childTerminalByItemId is populated by runNodes when each item hits a
            // TerminalNode, giving accurate per-item failed/completed status.
            const childTerminalOutcome = childTerminalByItemId.get(parentItem.id) ?? 'completed';
            const hasUnrecoverable = childClone.errors.some((e) => e.recoverable === false);
            const routeOutput = (childTerminalOutcome === 'failed' || hasUnrecoverable) ? 'error' : 'success';
            routeOutputByItemId.set(parentItem.id, routeOutput);
            const nextPlacement = node.outputs[routeOutput] ?? null;

            if (nextPlacement !== null) {
              pending.add(nextPlacement, Batch.of(parentItem.state, parentItem.id));
            }
          }

          // Representative observability output for the batch firing.
          // Unanimous when all items routed to the same port, else null.
          let repOutput: string | null = null;
          let allSameOutput = true;
          for (const [, output] of routeOutputByItemId) {
            if (repOutput === null) {
              repOutput = output;
            } else if (output !== repOutput) {
              allSameOutput = false;
              break;
            }
          }
          if (!allSameOutput) repOutput = null;

          // Stream intermediates before this node's own result.
          for (const intermediate of intermediateResults) {
            yield intermediate;
          }

          executedNodes.push(node.name);
          this.onNodeEnd(node.name, repOutput, repState, placementPath);
          yield {
            'output': repOutput,
            'skipped': false,
            'nodeName': node.name,
            'state': repState,
            'intermediateResults': [],
          };
          continue scheduleLoop;
        }

        // ScatterNode / EmbeddedDAGNode fire batch-native by running the
        // existing per-item composite logic (executeDAGNode) for each item in
        // the batch, then partitioning the items across output ports by the
        // route each one selected (RFC 0003 §6 — single-item = internal
        // iteration; the sub-walk / scatter machinery is reused unchanged). For
        // a size-1 batch this is byte-identical to the prior single dispatch:
        // one item, one executeDAGNode call, one route.
        const composite: Array<{ 'state': TState; 'nextStage': string | null; 'result': NodeResultInterface<TState> }> = [];
        for (const item of batch) {
          try {
            // bufferIntermediates: only accumulate inner-node results when
            // running at the top level (not embedded). Inside a scatter body
            // or nested embedded DAG, intermediates are discarded by the caller
            // anyway, and buffering at N×M×L scale causes unbounded heap growth.
            const outcome = await this.executeDAGNode(node, item.state, dagName, signal, placementPath, !runOptions.embedded);
            composite.push({ 'state': item.state, 'nextStage': outcome.nextStage, 'result': outcome.result });
          } catch (caughtError) {
            // A thrown firing fails the whole fired batch (RFC 0003 §10.2). Same
            // classification + lifecycle handling as the single-item path; the
            // representative state for telemetry is the batch's first item.
            const error = caughtError instanceof Error ? caughtError : new ExecutionError(String(caughtError));
            this.onError(currentPlacementName, error, repState, placementPath);
            let interruptedAt: InterruptionInfo | null = null;
            if (signal?.aborted) {
              if (!runOptions.embedded) {
                const abortInfo = this.handleAbort(state, signal);
                interruptedAt = { 'nodeName': currentPlacementName, 'reason': abortInfo.reason };
              } else {
                const isTimeout = signal.reason instanceof Error && signal.reason.name === 'TimeoutError';
                interruptedAt = { 'nodeName': currentPlacementName, 'reason': isTimeout ? 'timeout' : 'abort' };
              }
            } else if (error instanceof NodeTimeoutError) {
              interruptedAt = { 'nodeName': currentPlacementName, 'reason': 'timeout' };
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
        }

        // Stream every item's composite intermediates, in item order, before
        // the firing's own result.
        for (const entry of composite) {
          for (const intermediate of entry.result.intermediateResults) {
            yield intermediate;
          }
        }

        // Observability: one onNodeEnd + one yielded result per firing. For a
        // size-1 batch this is the single item's result, byte-identical to the
        // prior single dispatch. For a multi-item batch the representative
        // output is the one distinct output port when every item agrees, else
        // null (the items split across ports).
        const soleResult = composite.length === 1 ? composite[0]?.result : undefined;
        if (soleResult !== undefined) {
          if (soleResult.skipped) {
            skippedNodes.push(soleResult.nodeName);
          } else {
            executedNodes.push(soleResult.nodeName);
          }
          this.onNodeEnd(node.name, soleResult.output, repState, placementPath);
          yield soleResult;
        } else {
          executedNodes.push(node.name);
          let repOutput: string | null = composite[0]?.result.output ?? null;
          for (const entry of composite) {
            if (entry.result.output !== repOutput) { repOutput = null; break; }
          }
          this.onNodeEnd(node.name, repOutput, repState, placementPath);
          yield {
            'output': repOutput,
            'skipped': false,
            'nodeName': node.name,
            'state': repState,
            'intermediateResults': [],
          };
        }

        // Route each item to the next placement its outcome selected.
        for (const entry of composite) {
          if (entry.nextStage !== null) {
            pending.add(entry.nextStage, Batch.of(entry.state));
          }
        }
      }

      // Resolve terminalOutcome and terminalNodeName from the accumulator after
      // the work-set loop drains. For size-1 batches with a single terminal this
      // is identical to the prior break-on-first behaviour. For multi-item batches
      // with multiple terminals: any 'failed' terminal makes the overall outcome
      // 'failed'; terminalNodeName is set only when all items converged on a single
      // terminal (otherwise left null for the lifecycle code below to handle).
      if (terminalAccumulator.size > 0) {
        let allSameTerminal = terminalAccumulator.size === 1;
        let overallFailed = false;
        for (const [tName, { outcome }] of terminalAccumulator) {
          if (outcome === 'failed') overallFailed = true;
          terminalNodeName = tName;
        }
        terminalOutcome = overallFailed ? 'failed' : 'completed';
        if (!allSameTerminal) {
          // Multiple terminal nodes reached — no single representative terminal.
          terminalNodeName = null;
        }
      }
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
      // Clear any stale work-set blob so a completed run carries no lingering
      // progress metadata. This is a no-op for size-1 runs (no blob was written)
      // and ensures a second execution of the same state instance starts clean.
      WorkSetCheckpoint.clear(state);
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
      (n): n is PhaseNode =>
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
            'context': {},
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
    phase: PhaseNode,
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
    await this.withNodeTimeout(node, signal, (nodeSignal) => {
      const context = this.buildContext(dagName, phase.name, nodeSignal);
      return this.#runNodeOnState(node, state, context);
    });
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
      'signal': signal ?? SignalComposer.never(),
      'dagName': dagName,
      nodeName,
      'services': this.services,
    };
  }

  /**
   * Invokes a node on a single state as a size-1 batch.
   *
   * Wraps `state` in `Batch.of(state)`, calls `node.execute(batch, context)`,
   * asserts the size-1 invariant (exactly one route with exactly one item),
   * and returns the single output port key.
   *
   * The node owns error-forwarding: `ScalarNode.execute` forwards per-item
   * errors to `item.state.collectError` during `execute`. Since `Batch.of`
   * wraps the same state reference, mutations are visible after this call.
   *
   * Throws `DAGError` if the returned `RoutedBatch` does not contain exactly
   * one route with exactly one item (invariant violation for size-1 dispatch).
   */
  async #runNodeOnState(
    node: NodeInterface<TState, string, TServices>,
    state: TState,
    context: NodeContextInterface<TServices>,
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
      throw new DAGError(`Node '${node.name}' returned an empty RoutedBatch for a size-1 batch.`);
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
   * Fire a SingleNode placement over a batch in the work-set scheduler.
   *
   * Calls `node.execute(batch, context)` via `withNodeTimeout`, adds each
   * output port's sub-batch to the downstream node's pending work, and returns
   * a representative `NodeResultInterface` for the firing.
   *
   * For a size-1 batch: exactly one route is produced with exactly one item,
   * so `output` equals the single port key and `state` equals the single item.
   *
   * For a multi-item batch: items may split across multiple output ports.
   * `output` is `null` (no single representative output) and `state` is the
   * representative state (`batch.row(0).state`). Each sub-batch is added to the
   * work set for downstream placement processing.
   *
   * Throws `DAGError` when the placement routing map has no entry for a returned
   * output port.
   */
  async #fireSinglePlacement(
    nodeConfig: SingleNodePlacementInterface,
    batch: Batch<TState>,
    dagName: string,
    signal: AbortSignal | null,
    pending: WorkSet<TState>,
  ): Promise<NodeResultInterface<TState>> {
    const dagNode = this.nodes.get(nodeConfig.node);

    if (!dagNode) {
      throw new DAGError(`Unknown node: ${nodeConfig.node}`);
    }

    const routed = await this.withNodeTimeout(dagNode, signal, (nodeSignal) => {
      const context = this.buildContext(dagName, nodeConfig.name, nodeSignal);
      return dagNode.execute(batch, context);
    });

    // Add each output port's sub-batch to the downstream node's pending work.
    for (const [outputPort, subBatch] of routed.entries()) {
      const nextPlacement = nodeConfig.outputs[outputPort];
      if (nextPlacement === undefined) {
        throw new DAGError(
          `Node ${dagNode.name} returned output '${outputPort}' but node ${nodeConfig.name} has no routing for it. `
          + `Available outputs: ${Object.keys(nodeConfig.outputs).join(', ')}`,
        );
      }
      pending.add(nextPlacement, subBatch);
    }

    // For size-1 batches: exactly one route, one item → single representative output.
    // For multi-item batches: items may split → null representative output.
    const repState = batch.row(0).state;
    const output = routed.size === 1 ? (routed.keys().next().value as string) : null;

    return {
      output,
      'skipped': false,
      'nodeName': nodeConfig.name,
      'state': repState,
      'intermediateResults': [],
    };
  }

  /**
   * Returns true when the named placement in the given DAG is a `PhaseNode`.
   * Phase placements are out-of-band lifecycle hooks; they are never valid
   * entrypoints or resume targets for the main loop.
   */
  private isPhaseEntry(dagName: string, name: string): boolean {
    const entry = this.nodeIndex.get(`${dagName}:${name}`);
    return entry?.['@type'] === 'PhaseNode';
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
    bufferIntermediates: boolean = true,
  ): Promise<_InternalNodeResult<TState>> {
    const inputMapping = EmbeddedDAGNodeDefaults.inputMapping(placement);
    const outputMapping = EmbeddedDAGNodeDefaults.outputMapping(placement);
    const innerPath: readonly string[] = [...placementPath, placement.name];

    const cloneState = this.stateMapper.createChild(state, inputMapping);
    const intermediateResults: Array<NodeResultInterface<TState>> = [];
    let terminalOutcome: 'completed' | 'failed' | null;

    const container = this.resolveContainer(placement.container);

    if (container === null) {
      // ── In-process path ────────────────────────────────────────────────────
      const childOptions: ExecuteOptionsInterface = { ...(signal !== null && { 'signal': signal }) };
      const iter = this.runNodes(placement.dag, cloneState, null, childOptions, { 'embedded': true }, innerPath);

      // When bufferIntermediates is true (top-level streaming context), collect
      // each inner stage so the parent runNodes loop can yield them to the
      // consumer before the embedding placement's own result. When false (inside
      // a scatter body or another embedded DAG), skip buffering: at scatter scale
      // (N items × M inner nodes × L nesting levels) the accumulation is
      // O(N*M*L) and causes unbounded heap growth. Inner-node observability is
      // delivered live through onNodeStart/onNodeEnd regardless of this flag.
      if (bufferIntermediates) {
        let step = await iter.next();
        while (!step.done) {
          const nr = step.value;
          intermediateResults.push({
            'output': nr.output,
            'skipped': nr.skipped,
            'nodeName': `${placement.name}.${nr.nodeName}`,
            state,
            'intermediateResults': [],
          });
          step = await iter.next();
        }
        terminalOutcome = step.value.terminalOutcome;
      } else {
        // Drain without buffering.
        while (true) {
          const step = await iter.next();
          if (step.done) {
            terminalOutcome = step.value.terminalOutcome;
            break;
          }
        }
      }
    } else {
      // ── Contained path ─────────────────────────────────────────────────────
      const correlationId = this.nextCorrelationId(placement.dag);
      const context = this.buildContext(placement.dag, placement.name, signal);
      const task = new DagTask<TState, TServices>(
        placement.dag,
        innerPath,
        correlationId,
        Timeout.none(),
        cloneState,
        context,
      );

      const relay = this.buildObserverRelay(state);
      const outcome = await container.runDag(task, { relay });

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

      // Re-yield each intermediate as a NodeResultInterface only when buffering
      // is requested (top-level streaming). Inside a scatter body the observer
      // relay delivers per-node observability live; buffering at scatter scale
      // is O(N*M*L).
      if (bufferIntermediates) {
        for (const wi of outcome.intermediates) {
          intermediateResults.push({
            'output': wi.output,
            'skipped': wi.skipped,
            'nodeName': `${placement.name}.${wi.nodeName}`,
            state,
            'intermediateResults': [],
          });
        }
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
   * **Unified gather fold.** `initial` initialises accumulator state before any
   * clones run; `reduce` folds each completed record into parent state as it
   * arrives (batch of 1 per clone); `finalize` runs end-of-gather work (e.g.
   * node invocation for `custom`) once all clones have reported.
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
    // ── 1. Resolve source and scatter defaults ───────────────────────────────
    // Resolve once here; used at the early-exit, in the worker pool, and at
    // the outcome-reducer step — no repeated `?? default` at each site.
    const reducerName = scatter.reducer ?? 'aggregate';
    const itemKey = scatter.itemKey ?? 'currentItem';
    const concurrencyLimit = scatter.concurrency ?? DEFAULT_SCATTER_CONCURRENCY;

    const raw = this.accessor.get(state, scatter.source);

    // Empty / absent source: skip immediately.
    const isEmpty = raw === null || raw === undefined ||
      (Array.isArray(raw) && raw.length === 0);
    if (isEmpty) {
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

    // ── 2. Restore checkpoint (inbox model) ─────────────────────────────────
    // ScatterCheckpoint.read validates the raw metadata value at the boundary
    // so corrupt or migrated checkpoints throw ValidationError here rather
    // than causing silent type mismatches deep in the scatter loop.
    const storedProgress = ScatterCheckpoint.read(state, scatter.name);

    // Determine gather strategy (needed before compactable check).
    const gatherStrategy = scatter.gather !== undefined
      ? GatherStrategies.resolve(scatter.gather.strategy)
      : null;

    // Compactable: all built-in strategies except custom (retainsRecordsForFinalize=true).
    const compactable = gatherStrategy === null || !gatherStrategy.retainsRecordsForFinalize;

    // Mutable inbox: items pulled but not yet acked; seed from checkpoint on resume.
    const inbox: ScatterInboxItem[] = [...(storedProgress?.inbox ?? [])];

    // V8 shape stability: all accumulators initialised in declaration order
    // regardless of branch. Compactable path uses watermarkRef/aheadAcked/outcomeTally;
    // retained path uses ackedResults/ackedByIndex/itemOutputs.
    const ackedResults: ScatterAckedResult[] = [];
    const ackedByIndex = new Map<number, ScatterAckedResult>();
    const itemOutputs = new Map<number, string>();
    const watermarkRef: { value: number } = { 'value': 0 };
    const aheadAcked = new Map<number, string>();
    const outcomeTally = new Map<string, number>();

    // All indices already accounted for (acked + inbox from prior run).
    const seenIndices = new Set<number>();
    let nextIndex = 0;

    if (compactable) {
      if (storedProgress?.mode === 'bounded') {
        // Restore bounded checkpoint.
        watermarkRef.value = storedProgress.watermark;
        for (const entry of storedProgress.aheadAcked) aheadAcked.set(entry.index, entry.output);
        for (const [output, count] of Object.entries(storedProgress.outcomeTally)) outcomeTally.set(output, count);
        // seenIndices = {0..watermark-1} ∪ aheadAcked.keys() ∪ inbox.indices
        for (let i = 0; i < watermarkRef.value; i++) seenIndices.add(i);
        for (const k of aheadAcked.keys()) seenIndices.add(k);
        for (const entry of inbox) seenIndices.add(entry.index);
        // nextIndex = max(watermark, max(aheadAcked.keys)+1, max(inbox.index)+1, 0)
        nextIndex = watermarkRef.value;
        if (aheadAcked.size > 0) {
          const maxAhead = Math.max(...aheadAcked.keys());
          if (maxAhead + 1 > nextIndex) nextIndex = maxAhead + 1;
        }
        if (inbox.length > 0) {
          const maxInbox = Math.max(...inbox.map((e) => e.index));
          if (maxInbox + 1 > nextIndex) nextIndex = maxInbox + 1;
        }
      } else if (storedProgress?.mode === 'retained') {
        // Defensive: translate retained checkpoint into bounded in-memory form.
        for (const r of storedProgress.ackedResults) {
          advanceWatermark(watermarkRef, aheadAcked, outcomeTally, r.index, r.output);
        }
        for (let i = 0; i < watermarkRef.value; i++) seenIndices.add(i);
        for (const k of aheadAcked.keys()) seenIndices.add(k);
        for (const entry of inbox) seenIndices.add(entry.index);
        nextIndex = watermarkRef.value;
        if (aheadAcked.size > 0) {
          const maxAhead = Math.max(...aheadAcked.keys());
          if (maxAhead + 1 > nextIndex) nextIndex = maxAhead + 1;
        }
        if (inbox.length > 0) {
          const maxInbox = Math.max(...inbox.map((e) => e.index));
          if (maxInbox + 1 > nextIndex) nextIndex = maxInbox + 1;
        }
      }
    } else {
      // Non-compactable (retained mode): restore full ackedResults.
      if (storedProgress?.mode === 'retained') {
        for (const r of storedProgress.ackedResults) {
          ackedResults.push(r);
          ackedByIndex.set(r.index, r);
          itemOutputs.set(r.index, r.output);
          seenIndices.add(r.index);
        }
      }
      for (const entry of inbox) seenIndices.add(entry.index);
      for (const item of [...inbox, ...ackedResults]) {
        if (item.index >= nextIndex) nextIndex = item.index + 1;
      }
    }

    // ── 3. Gather strategy: prepare accumulators ────────────────────────────
    // Accumulate fresh records for the finalize pass and outcome-reducer.
    const allFreshRecords: GatherRecord<TState>[] = [];
    const intermediateResults: Array<NodeResultInterface<TState>> = [];

    // NOTE: Gather contributions from acked items in a prior run are already
    // present in the state snapshot (they were folded per-ack via reduce).
    // No replay is needed here; the finalize pass at step 7 handles any
    // end-of-gather work that needs the full record set.

    // ── 4. Build the source async iterator ──────────────────────────────────
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

    const rawIter = Dagonizer.toAsyncIterator(raw);

    // For index-stable sources on resume: consume items from positions 0 to
    // (nextIndex-1) from the raw source. Items whose position is in seenIndices
    // are silently dropped (already handled). Items NOT in seenIndices were not
    // processed in the prior run (gap in the acked set); add them to the inbox
    // with their canonical index so the pool re-processes them.
    // After this pre-scan, the raw iterator is positioned at nextIndex and ready
    // for normal sequential assignment. The pool's inbox iterator starts at
    // position 0 and traverses the full (possibly extended) inbox array.
    if (isIndexStableSource && seenIndices.size > 0) {
      for (let pos = 0; pos < nextIndex; pos++) {
        const step = await rawIter.next();
        if (step.done) { break; }
        if (!seenIndices.has(pos)) {
          // Gap: this position was never processed. Add to inbox for reprocessing.
          inbox.push({ 'index': pos, 'item': step.value });
        }
      }
    }

    // freshIter: the pre-scanned (or fresh) raw iterator handed to the pool.
    const freshIter = rawIter;

    // ── 5. Bounded worker pool with lazy pull ────────────────────────────────
    // `ScatterWorkerPool` owns the slot semaphore, active-worker counter,
    // error accumulation, and the drain loop. Item body execution and
    // acknowledgment are delegated to `_ScatterPoolDriverImpl` which is
    // constructed with:
    //   - a `_ScatterDispatchAdapter` built here (within the class body so
    //     private members are accessible), and
    //   - a `_ScatterRunContext` holding the scatter-local mutable accumulators.

    const scatterAdapter: _ScatterDispatchAdapter<TState, TServices> = {
      'stateMapper':        this.stateMapper,
      'nodes':              this.nodes,
      'accessor':           this.accessor,
      'withNodeTimeout':    (n, s, fn) => this.withNodeTimeout(n, s, fn),
      'buildContext':       (d, n, s) => this.buildContext(d, n, s),
      'runNodes':           (d, st, f, o, ro, pp, ib, tb) => this.runNodes(d, st, f, o, ro, pp, ib, tb),
      'resolveContainer':   (role) => this.resolveContainer(role),
      'nextCorrelationId':  (d) => this.nextCorrelationId(d),
      'buildObserverRelay': (st) => this.buildObserverRelay(st),
    };

    const scatterCtx: _ScatterRunContext<TState> = {
      scatter,
      state,
      dagName,
      signal,
      placementPath,
      itemKey,
      inbox,
      ackedResults,
      ackedByIndex,
      itemOutputs,
      allFreshRecords,
      intermediateResults,
      gatherStrategy,
      compactable,
      watermarkRef,
      aheadAcked,
      outcomeTally,
    };

    // ── 6. Drive the worker pool or reservoir buffer ─────────────────────────
    const driver = new _ScatterPoolDriverImpl<TState, TServices>(scatterAdapter, scatterCtx);

    if (scatter.reservoir !== undefined) {
      // Reservoir path: buffer-then-release loop keyed by item field.
      const reservoirBuf = new ReservoirBuffer<TState>(driver, {
        'concurrencyLimit': concurrencyLimit,
        'inbox': inbox,
        'freshIter': freshIter,
        'nextIndex': nextIndex,
        'signal': signal,
        'reservoir': scatter.reservoir,
        'accessor': this.accessor,
      });
      // drain() throws on abort or batch error; checkpoint is preserved on throw.
      await reservoirBuf.drain();
    } else {
      // Non-reservoir path: original per-item worker pool (byte-identical).
      const pool = new ScatterWorkerPool<TState>(driver, {
        'concurrencyLimit': concurrencyLimit,
        'inbox': inbox,
        'freshIter': freshIter,
        'nextIndex': nextIndex,
        'signal': signal,
      });
      // drain() throws on abort or worker error; checkpoint is preserved on throw.
      await pool.drain();
    }

    // ── 7. Finalize ──────────────────────────────────────────────────────────
    // `reduce` already folded every clone into state per-ack. `finalize` runs
    // once for EVERY gather (compactable and non-compactable) for end-of-gather
    // work such as building derived state or invoking a registered node.
    if (gatherStrategy !== null && scatter.gather !== undefined) {
      if (compactable) {
        // Compactable: the gather's result is fully in state via per-clone
        // `reduce`. Compactable finalize (e.g. InsightsFoldGather) builds derived
        // state from its own private accumulators and does NOT read the records
        // arg — so `allFreshRecords` is intentionally empty here (ackItem and
        // ackBatch skip the push in compactable mode to allow per-clone GC).
        // Pass an empty list; `finalize` must not depend on it.
        const gatherExecution = this.buildGatherExecution(state, [], dagName, signal);
        await gatherStrategy.finalize(scatter.gather, gatherExecution);
      } else {
        // Non-compactable finalize: synthesise records for prior acked items too,
        // reconstructing each prior-run clone from its persisted gather values so
        // the strategy sees the full record set.
        const freshIndices = new Set<number>(allFreshRecords.map((r) => r.index));
        const syntheticRecords: GatherRecord<TState>[] = [];
        for (const acked of ackedResults) {
          if (freshIndices.has(acked.index)) continue;
          const syntheticClone = state.clone();
          if (acked.kind === 'map') {
            for (const [clonePath, val] of Object.entries(acked.mappingValues)) {
              this.accessor.set(syntheticClone, clonePath, val);
            }
          } else if (acked.kind === 'field' && scatter.gather.field !== undefined) {
            this.accessor.set(syntheticClone, scatter.gather.field, acked.fieldValue);
          }
          syntheticRecords.push({
            'index': acked.index,
            'item': acked.item,
            'output': acked.output,
            'terminalOutcome': null,
            'cloneState': syntheticClone,
          });
        }
        const merged = [...syntheticRecords, ...allFreshRecords]
          .sort((a, b) => a.index - b.index);
        if (merged.length > 0) {
          const gatherExecution = this.buildGatherExecution(state, merged, dagName, signal);
          await gatherStrategy.finalize(scatter.gather, gatherExecution);
        }
      }
    }

    // ── 8. Clear checkpoint after clean completion ───────────────────────────
    ScatterCheckpoint.clear(state, scatter.name);

    // ── 9. Reduce to route ───────────────────────────────────────────────────
    const outcomeRecords: OutcomeRecord[] = [];
    if (compactable) {
      // Expand outcomeTally to OutcomeRecord array (count per output string).
      for (const [output, count] of outcomeTally) {
        for (let c = 0; c < count; c++) {
          outcomeRecords.push({ 'index': -1, output, 'terminalOutcome': null });
        }
      }
    } else {
      for (const [index, output] of itemOutputs) {
        outcomeRecords.push({ index, output, 'terminalOutcome': null });
      }
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
   *
   * The `invoker` satisfies `NodeInvoker` using an inline object that holds
   * direct references to this dispatcher and the enclosing execution context.
   * No injected function callbacks — the dispatcher instance (`this`) and the
   * entity references are the only captured values.
   */
  private buildGatherExecution(
    state: TState,
    records: ReadonlyArray<GatherRecord<TState>>,
    dagName: string,
    signal: AbortSignal | null,
  ): GatherExecution<TState> {
    // Capture stable entity references — no behavior closures injected.
    const dispatcher = this;
    const invoker: NodeInvoker = {
      async invokeNode(nodeName: string): Promise<void> {
        if (!dispatcher.nodes.has(nodeName)) {
          throw new DAGError(`Unknown custom node: ${nodeName}`);
        }
        const dagNode = dispatcher.nodes.get(nodeName);
        if (dagNode === undefined) return;
        const context = dispatcher.buildContext(dagName, nodeName, signal);
        await dispatcher.#runNodeOnState(dagNode, state, context);
      },
    };
    return {
      state,
      'records': [...records],
      dagName,
      signal,
      'accessor': this.accessor,
      invoker,
    };
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
  private async withNodeTimeout<TResult>(
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

    const output = await this.withNodeTimeout(dagNode, signal, (nodeSignal) => {
      const context = this.buildContext(dagName, nodeConfig.name, nodeSignal);
      return this.#runNodeOnState(dagNode, state, context);
    });

    const nextStage = nodeConfig.outputs[output];

    if (nextStage === undefined) {
      throw new DAGError(`Node ${dagNode.name} returned output '${output}' but node ${nodeConfig.name} has no routing for it. `
        + `Available outputs: ${Object.keys(nodeConfig.outputs).join(', ')}`);
    }

    const result: NodeResultInterface<TState> = {
      'output': output,
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
    bufferIntermediates: boolean = true,
  ): Promise<_InternalNodeResult<TState>> {
    const handler = this.dispatch[entry['@type']];
    if (handler === undefined) {
      throw new DAGError(`Unknown node type: ${entry['@type']}`);
    }
    return handler(entry, state, dagName, signal, placementPath, bufferIntermediates);
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
  registerDAG(dag: DAG): void {
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
    // Dangling reads throw DAGError; dead writes call onContractWarning.
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
      const contracts = contractBearingNodes.map((node) => ({
        'name': node.name,
        'outputs': [...node.outputs],
        'hardRequired': node.contract.hardRequired,
        'produces': node.contract.produces,
      }));
      try {
        ContractRegistryValidator.validate(
          contracts,
          this,
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
   * Resolve a `DagonizerOptionsInterface` partial to a fully-populated
   * `_ResolvedDagonizerOptions`. This is the single place where defaults are
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
    partial: DagonizerOptionsInterface<TState, TServices> = {},
  ): Readonly<{
    accessor: StateAccessor;
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
  registerBundle(bundle: DispatcherBundle<TState, TServices>): void {
    for (const node of bundle.nodes) {
      this.registerNode(node);
    }
    for (const dag of bundle.dags) {
      this.registerDAG(dag);
    }
  }
}
