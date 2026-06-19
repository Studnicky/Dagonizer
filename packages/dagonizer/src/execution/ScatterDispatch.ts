import { ScatterCheckpoint } from '../checkpoint/ScatterCheckpoint.js';
import { DagContainerBase } from '../container/DagContainerBase.js';
import type { BatchRunResultType } from '../container/DagOutcome.js';
import { DagTask } from '../container/DagTask.js';
import { TransportErrorCode } from '../container/TransportErrorCode.js';
import type { DagContainerInterface } from '../contracts/DagContainerInterface.js';
import type { ExecuteOptionsType } from '../contracts/ExecuteOptionsType.js';
import type { GatherRecordType } from '../contracts/GatherExecution.js';
import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { ObserverRelayInterface } from '../contracts/ObserverRelayInterface.js';
import type { ReservoirDriverInterface, ScatterItemBatchResultType } from '../contracts/ReservoirDriver.js';
import type { ScatterItemResultType, ScatterPoolDriverInterface } from '../contracts/ScatterPoolDriver.js';
import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import type { GatherStrategy } from '../core/GatherStrategies.js';
import { Batch } from '../entities/batch/Batch.js';
import { SCATTER_PROGRESS_KEY, WORKSET_PROGRESS_KEY } from '../entities/constants/ProgressKey.js';
import { ScatterNodeDefaults } from '../entities/dag/ScatterNode.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { ExecutionResultType } from '../entities/execution/ExecutionResult.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { NodeResultType } from '../entities/node/NodeResult.js';
import type { ScatterAckedResultType, ScatterInboxItemType } from '../entities/scatter/ScatterProgress.js';
import { Timeout } from '../entities/Timeout.js';
import { DAGError, ExecutionError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import type { StateMapper } from '../runtime/StateMapper.js';

import type { BodyExecutor } from './BodyExecutor.js';
import { PlacementRouter } from './PlacementRouter.js';

/** Engine-private result envelope returned by every node executor method. */
export type RunNodeResultType<TState extends NodeStateInterface> = {
  'nextStage': null | string;
  'result': NodeResultType<TState>;
};

/** Engine-private execution context for `runNodes` and `runPostPhasesAndFinalize`. */
export type RunOptionsType = { embedded: boolean };

/**
 * Trailing config object for the batch-native embedded-DAG re-entry path of
 * `runNodes`. Consolidates the two formerly-optional positional tail params so
 * there is no optional positional tail: `runNodes(..., placementPath, batch?)`.
 *
 * `inputBatch` seeds the per-item batch the embedded sub-DAG runs over;
 * `terminalByItemId` is populated by the child run with each item's terminal
 * outcome. Both are absent on the ordinary (non-batch) execution path, so the
 * whole object defaults to `{}`.
 */
export type RunNodesBatchType<TState extends NodeStateInterface> = {
  inputBatch?: Batch<TState>;
  terminalByItemId?: Map<string, 'completed' | 'failed'>;
};

/**
 * Module-private adapter interface that `ScatterPoolDriver` uses to call
 * dispatcher methods without requiring access to private class members.
 *
 * The concrete `ScatterDispatchAdapter` is constructed within
 * `Dagonizer.executeScatter` (where private members are in scope) and passed to
 * `ScatterPoolDriver`. Each member is bound at construction time so the adapter
 * has a stable hidden class (same shape every construction).
 */
export interface ScatterDispatchAdapterInterface<TState extends NodeStateInterface, TServices> {
  readonly stateMapper: StateMapper<TState>;
  readonly nodes: ReadonlyMap<string, NodeInterface<TState, string, TServices>>;
  readonly accessor: StateAccessorInterface;
  withNodeTimeout<TResult>(
    node: NodeInterface<TState, string, TServices>,
    signal: AbortSignal | null,
    fn: (sig: AbortSignal) => Promise<TResult>,
  ): Promise<TResult>;
  context(dagName: string, nodeName: string, signal: AbortSignal | null): NodeContextType<TServices>;
  runNodes(
    dagName: string,
    state: TState,
    fromStage: string | null,
    options: ExecuteOptionsType,
    runOptions: RunOptionsType,
    placementPath: readonly string[],
    batch?: RunNodesBatchType<TState>,
  ): AsyncGenerator<NodeResultType<TState>, ExecutionResultType<TState>, void>;
  resolveContainer(role: string | undefined): DagContainerInterface<TState> | null;
  nextCorrelationId(dagName: string): string;
  relayFor(state: TState): ObserverRelayInterface;
}

/**
 * Dispatcher surface the `ScatterDispatchAdapter` forwards into. `Dagonizer`
 * implements it so the scatter adapter is a named class with a stable shape,
 * not an object-literal of bound arrow closures rebuilt per scatter call.
 */
export interface ScatterDispatchSourceInterface<TState extends NodeStateInterface, TServices> {
  readonly stateMapper: StateMapper<TState>;
  readonly nodes: ReadonlyMap<string, NodeInterface<TState, string, TServices>>;
  readonly accessor: StateAccessorInterface;
  withNodeTimeout<TResult>(
    node: NodeInterface<TState, string, TServices>,
    signal: AbortSignal | null,
    fn: (sig: AbortSignal) => Promise<TResult>,
  ): Promise<TResult>;
  bodyContext(dagName: string, nodeName: string, signal: AbortSignal | null): NodeContextType<TServices>;
  runScatterNodes(
    dagName: string,
    state: TState,
    fromStage: string | null,
    options: ExecuteOptionsType,
    runOptions: RunOptionsType,
    placementPath: readonly string[],
    batch?: RunNodesBatchType<TState>,
  ): AsyncGenerator<NodeResultType<TState>, ExecutionResultType<TState>, void>;
  resolveContainer(role: string | undefined): DagContainerInterface<TState> | null;
  nextCorrelationId(dagName: string): string;
  relayFor(state: TState): ObserverRelayInterface;
}

/**
 * Stable `ScatterDispatchAdapterInterface` implementation bound to a dispatcher.
 *
 * The three collaborator fields (`stateMapper`, `nodes`, `accessor`) are read
 * directly by `ScatterPoolDriver`; the six methods forward into the dispatcher
 * source. Fields are initialised in constructor-declaration order for a
 * consistent hidden class across constructions.
 */
export class ScatterDispatchAdapter<TState extends NodeStateInterface, TServices>
  implements ScatterDispatchAdapterInterface<TState, TServices>
{
  readonly stateMapper: StateMapper<TState>;
  readonly nodes: ReadonlyMap<string, NodeInterface<TState, string, TServices>>;
  readonly accessor: StateAccessorInterface;
  readonly #source: ScatterDispatchSourceInterface<TState, TServices>;

  constructor(source: ScatterDispatchSourceInterface<TState, TServices>) {
    this.stateMapper = source.stateMapper;
    this.nodes = source.nodes;
    this.accessor = source.accessor;
    this.#source = source;
  }

  withNodeTimeout<TResult>(
    node: NodeInterface<TState, string, TServices>,
    signal: AbortSignal | null,
    fn: (sig: AbortSignal) => Promise<TResult>,
  ): Promise<TResult> {
    return this.#source.withNodeTimeout(node, signal, fn);
  }

  context(dagName: string, nodeName: string, signal: AbortSignal | null): NodeContextType<TServices> {
    return this.#source.bodyContext(dagName, nodeName, signal);
  }

  runNodes(
    dagName: string,
    state: TState,
    fromStage: string | null,
    options: ExecuteOptionsType,
    runOptions: RunOptionsType,
    placementPath: readonly string[],
    batch?: RunNodesBatchType<TState>,
  ): AsyncGenerator<NodeResultType<TState>, ExecutionResultType<TState>, void> {
    return this.#source.runScatterNodes(dagName, state, fromStage, options, runOptions, placementPath, batch);
  }

  resolveContainer(role: string | undefined): DagContainerInterface<TState> | null {
    return this.#source.resolveContainer(role);
  }

  nextCorrelationId(dagName: string): string {
    return this.#source.nextCorrelationId(dagName);
  }

  relayFor(state: TState): ObserverRelayInterface {
    return this.#source.relayFor(state);
  }
}

/**
 * Context bundle for a single `executeScatter` invocation.
 *
 * Captures the scatter placement config plus the mutable accumulators that
 * `ScatterPoolDriver.ackItem` writes to. All fields are initialised before the
 * driver is constructed; the driver never creates its own accumulators.
 */
export type ScatterRunContextType<TState extends NodeStateInterface> = {
  readonly scatter: ScatterNodeType;
  readonly state: TState;
  readonly dagName: string;
  readonly signal: AbortSignal | null;
  readonly placementPath: readonly string[];
  readonly itemKey: string;
  readonly inbox: ScatterInboxItemType[];
  readonly ackedResults: ScatterAckedResultType[];
  readonly ackedByIndex: Map<number, ScatterAckedResultType>;
  readonly itemOutputs: Map<number, string>;
  readonly allFreshRecords: GatherRecordType<TState>[];
  readonly intermediateResults: Array<NodeResultType<TState>>;
  readonly gatherStrategy: GatherStrategy | null;
  readonly compactable: boolean;
  readonly watermarkRef: { value: number };
  readonly aheadAcked: Map<number, string>;
  readonly outcomeTally: Map<string, number>;
}

/**
 * Engine-private driver: bridges `ScatterWorkerPool` to `Dagonizer` internals.
 *
 * Constructed once per `executeScatter` call with a stable adapter + context.
 * Implements `ScatterPoolDriverInterface<TState>` without accessing private
 * members on `Dagonizer` directly.
 */
export class ScatterPoolDriver<TState extends NodeStateInterface, TServices>
  implements ScatterPoolDriverInterface<TState>, ReservoirDriverInterface<TState>
{
  readonly #adapter: ScatterDispatchAdapterInterface<TState, TServices>;
  readonly #ctx: ScatterRunContextType<TState>;
  readonly #bodyExecutor: BodyExecutor<TState, TServices>;

  constructor(
    adapter: ScatterDispatchAdapterInterface<TState, TServices>,
    ctx: ScatterRunContextType<TState>,
    bodyExecutor: BodyExecutor<TState, TServices>,
  ) {
    this.#adapter = adapter;
    this.#ctx = ctx;
    this.#bodyExecutor = bodyExecutor;
  }

  async executeItem(itemIndex: number, item: unknown): Promise<ScatterItemResultType<TState>> {
    const { scatter, state, dagName, signal, placementPath, itemKey } = this.#ctx;
    const cloneState = this.#adapter.stateMapper.cloneChild(
      state,
      ScatterNodeDefaults.inputMapping(scatter),
    );
    // Strip engine-internal metadata keys from the clone. The parent state's
    // scatter-progress and work-set-progress metadata are engine bookkeeping for
    // the PARENT scatter/workset loop — the child body DAG must not inherit them.
    // Without this, each clone carries the full parent inbox (O(N) payload), and
    // serializing the clone for the container transport sends that inbox N times,
    // producing O(N²) heap growth across concurrent batches.
    cloneState.deleteMetadata(SCATTER_PROGRESS_KEY);
    cloneState.deleteMetadata(WORKSET_PROGRESS_KEY);
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
        const context = this.#adapter.context(dagName, scatter.name, nodeSignal);
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
      // DAG body — runs in-process or through a bound container via the shared
      // BodyExecutor. The in-process drain and the container snapshot/error
      // collection live there; the scatter path never buffers intermediates
      // (bufferIntermediates: false) — at scatter scale (N items × M inner
      // nodes) that accumulation is O(N*M) and inner-node observability is
      // delivered live through the observer relay regardless.
      const body = await this.#bodyExecutor.run(
        scatter.body.dag,
        scatter.name,
        cloneState,
        state,
        scatter.container,
        signal,
        placementPath,
        false,
      );

      // Infrastructure/transport failure (worker died, channel lost): the child
      // DAG never ran to a terminal. Throw so the pool takes the reject branch →
      // poolError set → item is NOT acked → it stays in the inbox → resume
      // reprocesses it. This matches the in-process path (a body crash throws)
      // and preserves at-least-once. A legitimate body that ran and routed to
      // 'error' (terminalOutput 'failed' from a TerminalNode) is NOT an
      // infrastructure failure and acks normally. BodyExecutor has already
      // collected the error into cloneState; the throw is the scatter-only
      // re-queue policy (embedded routes the collected error instead).
      if (body.infrastructureError !== null) {
        throw new ExecutionError(
          `ScatterNode '${scatter.name}': container infrastructure failure — ${body.infrastructureError.message ?? 'transport lost'}`,
        );
      }

      const hasUnrecoverable = cloneState.errors.some((e) => e.recoverable === false);
      const output = PlacementRouter.route(body.terminalOutcome, hasUnrecoverable);

      for (const err of cloneState.errors) state.collectError(err);
      for (const warn of cloneState.warnings) state.collectWarning(warn);

      return { 'index': itemIndex, item, output, 'terminalOutcome': body.terminalOutcome, 'cloneState': cloneState };
    }
  }

  async ackItem(res: ScatterItemResultType<TState>): Promise<void> {
    const { scatter, state, inbox, ackedResults, ackedByIndex, itemOutputs, allFreshRecords, gatherStrategy, compactable, watermarkRef, aheadAcked, outcomeTally } = this.#ctx;
    const { 'index': itemIndex, 'item': item, 'output': output, 'terminalOutcome': terminalOutcome, 'cloneState': cloneState } = res;

    // Remove from inbox.
    const inboxIdx = inbox.findIndex((e) => e.index === itemIndex);
    if (inboxIdx !== -1) inbox.splice(inboxIdx, 1);

    const freshRecord: GatherRecordType<TState> = {
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
      ScatterCheckpoint.advanceWatermark(watermarkRef, aheadAcked, outcomeTally, itemIndex, output);
      ScatterCheckpoint.writeBounded(
        state, scatter.name, [...inbox], watermarkRef.value,
        [...aheadAcked.entries()].map(([i, o]) => ({ 'index': i, 'output': o })),
        Object.fromEntries(outcomeTally),
      );
    } else {
      // Retained mode: persist full acked result for reconstruct on resume.
      const ackedResult: ScatterAckedResultType = (() => {
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
   * - **Branch B (DAG body, in-process):** runs the released batch through the
   *   sub-DAG in a single batch-native `runNodes` call (the `inputBatch` +
   *   `terminalByItemId` seam), deriving each item's `terminalOutcome` from the map.
   * - **Branch C (DAG body, container):** routes to `DagContainerBase.runDagBatch`
   *   when the container is a `DagContainerBase` instance (one transport round-trip
   *   for all items); falls back to per-item `container.runDag` for plain
   *   `DagContainerInterface` implementations.
   *
   * Errors and warnings from each clone are collected into the parent state.
   */
  async executeBatch(items: { index: number; item: unknown; bufferKey: string }[]): Promise<ScatterItemBatchResultType<TState>> {
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
        const clone = this.#adapter.stateMapper.cloneChild(state, ScatterNodeDefaults.inputMapping(scatter));
        // Strip engine-internal metadata keys — the child body must not inherit
        // the parent scatter/workset progress (O(N) payload, see executeItem).
        clone.deleteMetadata(SCATTER_PROGRESS_KEY);
        clone.deleteMetadata(WORKSET_PROGRESS_KEY);
        clone.setMetadata(itemKey, buffered.item);
        clone.setMetadata('itemIndex', buffered.index);
        clones.push(clone);
        batchItems.push({ 'id': String(buffered.index), 'state': clone });
      }

      const batch = Batch.from(batchItems);
      const routed = await this.#adapter.withNodeTimeout(dagNode, signal, async (nodeSignal) => {
        const context = this.#adapter.context(dagName, scatter.name, nodeSignal);
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
      const results: ScatterItemResultType<TState>[] = items.map((buffered, i) => {
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
      const clone = this.#adapter.stateMapper.cloneChild(state, ScatterNodeDefaults.inputMapping(scatter));
      // Strip engine-internal metadata keys — the child body must not inherit
      // the parent scatter/workset progress (O(N) payload, see executeItem).
      clone.deleteMetadata(SCATTER_PROGRESS_KEY);
      clone.deleteMetadata(WORKSET_PROGRESS_KEY);
      clone.setMetadata(itemKey, buffered.item);
      clone.setMetadata('itemIndex', buffered.index);
      clones.push(clone);
      batchItems.push({ 'id': String(buffered.index), 'state': clone });
    }
    const batch = Batch.from(batchItems);

    if (container === null) {
      // ── Branch B: DAG body, in-process (batch-native) ───────────────────────
      // Run the child DAG once over all N items as a single batch via the wave-1
      // seam (inputBatch + terminalByItemId), mirroring the batch-native embedded
      // -DAG firing in runNodes. The per-item items live in `batch`; `repClone`
      // is a standalone clone supplied only to satisfy the `state` argument.
      const childOptions: ExecuteOptionsType = { ...(signal !== null && { 'signal': signal }) };
      const terminalByItemId = new Map<string, 'completed' | 'failed'>();
      const repClone = state.clone();
      const iter = this.#adapter.runNodes(scatter.body.dag, repClone, null, childOptions, { 'embedded': true }, innerPath, { 'inputBatch': batch, terminalByItemId });

      // Drain the generator fully; per-item terminal outcomes land in the map.
      let step = await iter.next();
      while (!step.done) {
        step = await iter.next();
      }

      const results: ScatterItemResultType<TState>[] = items.map((buffered, i) => {
        const clone = clones[i] as TState;
        const terminalOutcome = terminalByItemId.get(String(buffered.index)) ?? null;
        const hasUnrecoverable = clone.errors.some((e) => e.recoverable === false);
        const output = PlacementRouter.route(terminalOutcome, hasUnrecoverable);
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
    const context = this.#adapter.context(scatter.body.dag, scatter.name, signal);
    const scatterRelay = this.#adapter.relayFor(state);

    let outcomes: BatchRunResultType[];

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
        const itemContext = this.#adapter.context(scatter.body.dag, scatter.name, signal);
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
    const results: ScatterItemResultType<TState>[] = items.map((buffered, i) => {
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
      const output = PlacementRouter.route(terminalOutcome, hasUnrecoverable);

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
  async ackBatch(batchResult: ScatterItemBatchResultType<TState>): Promise<void> {
    const { scatter, state, inbox, ackedResults, ackedByIndex, itemOutputs, allFreshRecords, gatherStrategy, compactable, watermarkRef, aheadAcked, outcomeTally } = this.#ctx;

    const freshRecordsForBatch: GatherRecordType<TState>[] = [];

    // Collect all item indexes to remove up-front so the inbox scan is O(inbox)
    // total rather than O(inbox × batch) from per-item findIndex+splice.
    const toRemove = new Set<number>(batchResult.results.map((r) => r.index));

    for (const res of batchResult.results) {
      const { 'index': itemIndex, 'item': item, 'output': output, 'terminalOutcome': terminalOutcome, 'cloneState': cloneState } = res;

      const freshRecord: GatherRecordType<TState> = { 'index': itemIndex, item, output, terminalOutcome, cloneState };
      freshRecordsForBatch.push(freshRecord);
      // Compactable mode: skip accumulation so each cloneState is GC-eligible
      // after the batch reduce below — same bounded-memory invariant as ackItem.
      if (!compactable) allFreshRecords.push(freshRecord);

      if (compactable) {
        // Bounded mode: advance watermark per item.
        ScatterCheckpoint.advanceWatermark(watermarkRef, aheadAcked, outcomeTally, itemIndex, output);
      } else {
        // Retained mode: build full acked result.
        const ackedResult: ScatterAckedResultType = (() => {
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

    // Bulk-remove all batch items from inbox in a single O(inbox) pass.
    // Per-item findIndex+splice would be O(inbox × batch); this is O(inbox) total.
    let writeIdx = 0;
    for (let readIdx = 0; readIdx < inbox.length; readIdx++) {
      const entry = inbox[readIdx] as ScatterInboxItemType;
      if (!toRemove.has(entry.index)) {
        inbox[writeIdx++] = entry;
      }
    }
    inbox.length = writeIdx;

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
