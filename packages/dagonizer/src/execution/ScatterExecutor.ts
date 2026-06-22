import { ScatterCheckpoint } from '../checkpoint/ScatterCheckpoint.js';
import type { GatherRecordType } from '../contracts/GatherExecution.js';
import type { OutcomeRecordType } from '../contracts/OutcomeRecord.js';
import { GatherStrategies } from '../core/GatherStrategies.js';
import { OutcomeReducers } from '../core/OutcomeReducers.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { NodeResultType } from '../entities/node/NodeResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { BodyExecutor } from './BodyExecutor.js';
import type { Gather } from './Gather.js';
import { ReservoirBuffer } from './ReservoirBuffer.js';
import { ScatterDispatchAdapter, ScatterPoolDriver } from './ScatterDispatch.js';
import type {
  RunNodeResultType,
  ScatterDispatchAdapterInterface,
  ScatterDispatchSourceInterface,
  ScatterRunContextType,
} from './ScatterDispatch.js';
import { ScatterSource } from './ScatterSource.js';
import { ScatterWorkerPool } from './ScatterWorkerPool.js';

/** Default scatter concurrency when `scatter.concurrency` is not specified. */
const DEFAULT_SCATTER_CONCURRENCY = 1;

/**
 * `ScatterNode` placement executor.
 *
 * Extracts `executeScatter` from `Dagonizer` into a focused domain module.
 * Depends on `ScatterDispatchSourceInterface` (the same port the scatter
 * adapter already uses), the shared `BodyExecutor`, and the `Gather` module
 * (for `composeGatherExecution` calls in the finalize pass). Behavior is
 * byte-identical to the original inline method.
 */
export class ScatterExecutor {
  readonly #scatterSource: ScatterDispatchSourceInterface;
  readonly #bodyExecutor: BodyExecutor;
  readonly #gather: Gather;

  constructor(
    scatterSource: ScatterDispatchSourceInterface,
    bodyExecutor: BodyExecutor,
    gather: Gather,
  ) {
    this.#scatterSource = scatterSource;
    this.#bodyExecutor = bodyExecutor;
    this.#gather = gather;
  }

  async executeScatter(
    scatter: ScatterNodeType,
    state: NodeStateInterface,
    dagName: string,
    signal: AbortSignal | null,
    placementPath: readonly string[],
  ): Promise<RunNodeResultType> {
    // ── 1. Resolve source and scatter defaults ───────────────────────────────
    // Resolve once here; used at the early-exit, in the worker pool, and at
    // the outcome-reducer step — no repeated `?? default` at each site.
    const reducerName = scatter.reducer ?? 'aggregate';
    const itemKey = scatter.itemKey ?? 'currentItem';
    const concurrencyLimit = scatter.concurrency ?? DEFAULT_SCATTER_CONCURRENCY;

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
    // so corrupt or migrated checkpoints throw ValidationError here rather
    // than causing silent type mismatches deep in the scatter loop.
    const storedProgress = ScatterCheckpoint.read(state, scatter.name);

    // Determine gather strategy (needed before compactable check).
    const gatherStrategy = scatter.gather !== undefined
      ? GatherStrategies.resolve(scatter.gather.strategy)
      : null;

    // Compactable: all built-in strategies except custom (retainsRecordsForFinalize=true).
    const compactable = gatherStrategy === null || !gatherStrategy.retainsRecordsForFinalize;

    // Materialise the scatter run accumulators from the stored checkpoint. The
    // inbox seeds from the checkpoint; the mode-specific accumulators, seen-index
    // set, and next-index cursor are reconstructed so resume reprocesses inbox
    // gaps and continues sequential index assignment. `nextIndex` advances as
    // fresh items are pulled, so it is read off the mutable bundle.
    const runState = ScatterCheckpoint.restoreRunState(storedProgress, compactable);
    const { inbox, ackedResults, ackedByIndex, itemOutputs, watermarkRef, aheadAcked, outcomeTally, seenIndices } = runState;
    let nextIndex = runState.nextIndex;

    // ── 3. Gather strategy: prepare accumulators ────────────────────────────
    // Accumulate fresh records for the finalize pass and outcome-reducer.
    const allFreshRecords: GatherRecordType<NodeStateInterface>[] = [];
    const intermediateResults: Array<NodeResultType<NodeStateInterface>> = [];

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
    const driver = new ScatterPoolDriver(scatterAdapter, scatterCtx, this.#bodyExecutor);

    if (scatter.reservoir !== undefined) {
      // Reservoir path: buffer-then-release loop keyed by item field.
      const reservoirBuf = new ReservoirBuffer(driver, {
        'concurrencyLimit': concurrencyLimit,
        'inbox': inbox,
        'freshIter': freshIter,
        'nextIndex': nextIndex,
        'signal': signal,
        'reservoir': scatter.reservoir,
        'accessor': this.#scatterSource.accessor,
      });
      // drain() throws on abort or batch error; checkpoint is preserved on throw.
      await reservoirBuf.drain();
    } else {
      // Non-reservoir path: original per-item worker pool (byte-identical).
      const pool = new ScatterWorkerPool(driver, {
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
        const gatherExecution = this.#gather.composeGatherExecution(state, [], dagName, signal);
        await gatherStrategy.finalize(scatter.gather, gatherExecution);
      } else {
        // Non-compactable finalize: synthesise records for prior acked items too,
        // reconstructing each prior-run clone from its persisted gather values so
        // the strategy sees the full record set.
        const freshIndices = new Set<number>(allFreshRecords.map((r) => r.index));
        const syntheticRecords: GatherRecordType[] = [];
        for (const acked of ackedResults) {
          if (freshIndices.has(acked.index)) continue;
          const syntheticClone = state.clone();
          if (acked.variant === 'map') {
            for (const [clonePath, val] of Object.entries(acked.mappingValues)) {
              this.#scatterSource.accessor.set(syntheticClone, clonePath, val);
            }
          } else if (acked.variant === 'field' && scatter.gather.field !== undefined) {
            this.#scatterSource.accessor.set(syntheticClone, scatter.gather.field, acked.fieldValue);
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
          const gatherExecution = this.#gather.composeGatherExecution(state, merged, dagName, signal);
          await gatherStrategy.finalize(scatter.gather, gatherExecution);
        }
      }
    }

    // ── 8. Clear checkpoint after clean completion ───────────────────────────
    ScatterCheckpoint.clear(state, scatter.name);

    // ── 9. Reduce to route ───────────────────────────────────────────────────
    const outcomeRecords: OutcomeRecordType[] = [];
    if (compactable) {
      // Expand outcomeTally to OutcomeRecordType array (count per output string).
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

    const result: NodeResultType<NodeStateInterface> = {
      'output': routeOutput,
      'skipped': false,
      'nodeName': scatter.name,
      state,
      intermediateResults,
    };

    return { nextStage, result };
  }
}
