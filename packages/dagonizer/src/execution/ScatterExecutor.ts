import { ScatterCheckpoint } from '../checkpoint/ScatterCheckpoint.js';
import type { GatherRecordType } from '../contracts/GatherExecution.js';
import type { OutcomeRecordType } from '../contracts/OutcomeRecord.js';
import { OutcomeReducers } from '../core/OutcomeReducers.js';
import { ScatterNodeDefaults } from '../entities/dag/ScatterNode.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { NodeResultType } from '../entities/node/NodeResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { BodyExecutor } from './BodyExecutor.js';
import { ReservoirBuffer } from './ReservoirBuffer.js';
import { ScatterDispatchAdapter, ScatterPoolDriver } from './ScatterDispatch.js';
import type {
  GatherRecordSinkType,
  RunNodeResultType,
  ScatterDispatchAdapterInterface,
  ScatterDispatchSourceInterface,
  ScatterRunContextType,
} from './ScatterDispatch.js';
import { ScatterSource } from './ScatterSource.js';
import { ScatterWorkerPool } from './ScatterWorkerPool.js';

/**
 * `ScatterNode` placement executor.
 *
 * Extracts `executeScatter` from `Dagonizer` into a focused domain module.
 * Depends on `ScatterDispatchSourceInterface` (the same port the scatter
 * adapter already uses) and the shared `BodyExecutor`. Scatter is pure
 * fan-out/execution; fan-in is handled by explicit downstream `GatherNode`
 * placements in the scheduler.
 */
export class ScatterExecutor {
  readonly #scatterSource: ScatterDispatchSourceInterface;
  readonly #bodyExecutor: BodyExecutor;

  constructor(
    scatterSource: ScatterDispatchSourceInterface,
    bodyExecutor: BodyExecutor,
  ) {
    this.#scatterSource = scatterSource;
    this.#bodyExecutor = bodyExecutor;
  }

  async executeScatter(
    scatter: ScatterNodeType,
    state: NodeStateInterface,
    dagName: string,
    signal: AbortSignal,
    placementPath: readonly string[],
    gatherRecordSink: GatherRecordSinkType | null = null,
  ): Promise<RunNodeResultType> {
    // ── 1. Resolve source and scatter defaults ───────────────────────────────
    // Resolve once here; used at the early-exit, in the worker pool, and at
    // the outcome-reducer step — no repeated `?? default` at each site.
    const reducerName = scatter.reducer ?? 'aggregate';
    const itemKey = scatter.itemKey ?? 'currentItem';
    // Unified concurrency-limiting policy: one discriminated `mode` structure
    // instead of three uncoordinated sibling knobs (see ScatterNode.ts doc
    // comment). `concurrency` gates item dispatch in 'item' mode and batch
    // dispatch in 'reservoir' mode; `throttle` is only meaningful in 'item' mode.
    const executionPolicy = ScatterNodeDefaults.executionPolicy(scatter);

    const raw = this.#scatterSource.accessor.get(state, scatter.source);

    // Empty / absent source: skip immediately.
    const isEmpty = raw === null || raw === undefined ||
      (Array.isArray(raw) && raw.length === 0);
    if (isEmpty) {
      const routeOutput = OutcomeReducers.resolve(reducerName).reduce([]);
      const nextStage = scatter.outputs[routeOutput] ?? null;
      const result: NodeResultType<NodeStateInterface> = {
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
    // so corrupt or migrated checkpoints throw a DAGError (code
    // VALIDATION_ERROR) here rather than causing silent type mismatches
    // deep in the scatter loop.
    const storedProgress = ScatterCheckpoint.read(state, scatter['@id']);

    // Materialise the scatter run accumulators from the stored checkpoint. The
    // inbox seeds from the checkpoint; the mode-specific accumulators, seen-index
    // set, and next-index cursor are reconstructed so resume reprocesses inbox
    // gaps and continues sequential index assignment. `nextIndex` advances as
    // fresh items are pulled, so it is read off the mutable bundle.
    const runState = ScatterCheckpoint.restoreRunState(storedProgress, true);
    const { inbox, watermarkRef, aheadAcked, outcomeTally, seenIndices } = runState;
    let nextIndex = runState.nextIndex;

    // ── 3. Prepare exported producer records ────────────────────────────────
    // Accumulate fresh records for downstream first-class gather placements.
    const allFreshRecords: GatherRecordType[] = [];
    const intermediateResults: Array<NodeResultType<NodeStateInterface>> = [];

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
      Symbol.iterator in raw &&
      !(Symbol.asyncIterator in raw);

    const rawIter = ScatterSource.toAsyncIterator(raw);

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
    // acknowledgment are delegated to `ScatterPoolDriver` which is
    // constructed with:
    //   - a `ScatterDispatchAdapterInterface` built here, and
    //   - a `ScatterRunContextType` holding the scatter-local mutable accumulators.

    const scatterAdapter: ScatterDispatchAdapterInterface =
      new ScatterDispatchAdapter(this.#scatterSource);

    const scatterCtx: ScatterRunContextType = {
      scatter,
      state,
      dagName,
      signal,
      placementPath,
      itemKey,
      inbox,
      allFreshRecords,
      intermediateResults,
      watermarkRef,
      aheadAcked,
      outcomeTally,
      gatherRecordSink,
    };

    // ── 6. Drive the worker pool or reservoir buffer ─────────────────────────
    const driver = new ScatterPoolDriver(scatterAdapter, scatterCtx, this.#bodyExecutor);

    if (executionPolicy.mode === 'reservoir') {
      // Reservoir mode: buffer-then-release loop keyed by item field.
      // `concurrency` gates batch dispatch here (same Semaphore concept as
      // item mode, at batch instead of item granularity) — there is no
      // `throttle` field in this mode; the schema structurally prevents it
      // (see ScatterNode.ts doc comment for why a per-item Throttle does not
      // compose with variable-size batch dispatch).
      const reservoirBuf = new ReservoirBuffer(driver, {
        'concurrencyLimit': executionPolicy.concurrency,
        'inbox': inbox,
        'freshIter': freshIter,
        'nextIndex': nextIndex,
        'signal': signal,
        'reservoir': executionPolicy.reservoir,
        'accessor': this.#scatterSource.accessor,
      });
      // drain() throws on abort or batch error; checkpoint is preserved on throw.
      await reservoirBuf.drain();
    } else {
      // Item mode: per-item worker pool, optionally throttled.
      const pool = new ScatterWorkerPool(driver, {
        'concurrencyLimit': executionPolicy.concurrency,
        'inbox': inbox,
        'freshIter': freshIter,
        'nextIndex': nextIndex,
        'signal': signal,
        'throttle': executionPolicy.throttle,
      });
      // drain() throws on abort or worker error; checkpoint is preserved on throw.
      await pool.drain();
    }

    // ── 7. Clear checkpoint after clean completion ───────────────────────────
    ScatterCheckpoint.clear(state, scatter['@id']);

    // ── 8. Reduce to route ───────────────────────────────────────────────────
    const outcomeRecords: OutcomeRecordType[] = [];
    for (const [output, count] of outcomeTally) {
      for (let c = 0; c < count; c++) {
        outcomeRecords.push({ 'index': -1, output, 'terminalOutcome': null });
      }
    }
    const routeOutput = OutcomeReducers.resolve(reducerName).reduce(outcomeRecords);
    const nextStage = scatter.outputs[routeOutput] ?? null;

    const result: NodeResultType<NodeStateInterface> = {
      'output': routeOutput,
      'skipped': false,
      'nodeName': scatter.name,
      state,
      intermediateResults,
    };

    return { nextStage, result, 'gatherRecords': allFreshRecords };
  }
}
