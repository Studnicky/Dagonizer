/**
 * R1 (P0) — scatter async-iterable-source abort data-loss regression test.
 *
 * Defect: when the run-level signal aborts while the scatter pull-loop is
 * actively pulling from an async-iterable source, the current code continues
 * the pull-loop (signal.aborted is not checked), acks and clears the
 * checkpoint for items that never ran, and returns normally — silently
 * discarding unprocessed items. A subsequent `resume()` sees an empty
 * checkpoint and believes the scatter is complete.
 *
 * Fix: the pull-loop condition adds `&& signal?.aborted !== true`; after the
 * drain loop, if the signal is aborted and no pool error occurred, throw
 * `ExecutionError.fromSignal(signal)` BEFORE any `ScatterCheckpoint.clear()`.
 *
 * This test file:
 *   1. Reproduces the defect against current code (should FAIL before the fix).
 *   2. Passes after the fix is applied.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer, SCATTER_PROGRESS_KEY } from '../../src/Dagonizer.js';
import type { ScatterProgress } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import type { JsonObject } from '../../src/entities/json.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

// ── test state ────────────────────────────────────────────────────────────────

/** Union type for scatter source fields: array (array-mode) or async iterable (streaming mode). */
type ScatterSource<T> = T[] | AsyncIterable<T>;

class AbortState extends NodeStateBase {
  /** Scatter source: array or async-iterable. Non-array form is not snapshotted. */
  items: ScatterSource<number> = [];
  processed: number[] = [];

  protected override snapshotData(): JsonObject {
    // items may be an AsyncIterable at runtime; only array form is JSON-serialisable.
    const itemsSnap = Array.isArray(this.items) ? [...this.items] : [];
    return { 'items': itemsSnap, 'processed': [...this.processed] };
  }

  protected override restoreData(snap: JsonObject): void {
    const iv = snap['items'];
    if (Array.isArray(iv)) this.items = iv.filter((x): x is number => typeof x === 'number');
    const v = snap['processed'];
    if (Array.isArray(v)) {
      this.processed = v.filter((x): x is number => typeof x === 'number');
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a simple scatter DAG over an `items` source with an append gather. */
const makeAbortDag = (name: string, concurrency: number): DAG => ({
  '@context': DAG_CONTEXT,
  '@id':      `urn:noocodex:dag:${name}`,
  '@type':    'DAG',
  'name':     name,
  'version':  '1',
  'entrypoint': 'fan',
  'nodes': [
    {
      '@id':         `urn:noocodex:dag:${name}/node/fan`,
      '@type':       'ScatterNode',
      'name':        'fan',
      'body':        { 'node': 'worker' },
      'source':      'items',
      'itemKey':     'item',
      'concurrency': concurrency,
      'gather':      { 'strategy': 'append', 'target': 'processed' },
      'outputs':     { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
    },
  ],
});

// ── tests ─────────────────────────────────────────────────────────────────────

void describe('R1 — scatter abort with async-iterable source: data-loss regression', () => {
  /**
   * Core scenario: 50-item async generator, abort fires after the first few
   * items complete, many items remain unprocessed. After abort the checkpoint
   * must still record those unprocessed items (inbox or partial ackedResults),
   * so a resume can reprocess them.
   *
   * Defect behaviour (before fix): the pull-loop ignores signal.aborted, drains
   * the full source, acks everything, calls ScatterCheckpoint.clear(), and
   * returns success — items that never ran are silently dropped.
   *
   * Correct behaviour (after fix): the pull-loop exits when signal.aborted is
   * true, the throw fires before clear(), the run returns with cursor='fan',
   * and the checkpoint contains the unprocessed items.
   */
  void it('aborted scatter over async-iterable source preserves checkpoint — resume sees remaining items', async () => {
    const TOTAL_ITEMS = 50;
    const ABORT_AFTER_COMPLETE = 3; // abort after this many items complete

    // Gate: workers resolve only when permitted (gives us control over abort timing).
    let completedCount = 0;
    const controller = new AbortController();

    const dispatcher = new Dagonizer<AbortState>();

    const worker: NodeInterface<AbortState, 'success'> = {
      'name':    'worker',
      'outputs': ['success'],
      async execute(state, context) {
        // Simulate some async work.
        await new Promise<void>((resolve, reject) => {
          const handle = setTimeout(resolve, 2);
          context.signal.addEventListener('abort', () => {
            clearTimeout(handle);
            reject(context.signal.reason);
          }, { 'once': true });
        });
        const n = ++completedCount;
        // Abort after the configured number of completions.
        if (n === ABORT_AFTER_COMPLETE) {
          controller.abort(new Error('test-abort'));
        }
        state.processed.push(state.getMetadata<number>('item') ?? -1);
        return { 'output': 'success' };
      },
    };

    dispatcher.registerNode(worker);
    dispatcher.registerDAG(makeAbortDag('abort-async-50', 2));

    const state = new AbortState();

    // Place an async-iterable at state.items (50 items).
    async function* makeSource(): AsyncGenerator<number> {
      for (let i = 1; i <= TOTAL_ITEMS; i++) {
        yield i;
      }
    }
    state.items = makeSource();

    const result = await dispatcher.execute('abort-async-50', state, { 'signal': controller.signal });

    // ── Post-abort invariants ────────────────────────────────────────────────

    // 1. The run must have been interrupted — cursor stays on 'fan'.
    assert.equal(result.cursor, 'fan',
      `cursor should be 'fan' after abort; got '${result.cursor}'`);

    // 2. The checkpoint must survive — progress entry must still be present.
    const stored = result.state.getMetadata<Record<string, ScatterProgress>>(SCATTER_PROGRESS_KEY);
    assert.ok(stored !== undefined,
      'checkpoint must be present after abort (ScatterCheckpoint.clear must NOT have run)');

    const entry = stored['fan'];
    assert.ok(entry !== undefined, 'expected a progress entry for placement "fan"');

    // 3. Not all items were acked — the acked count must be fewer than total.
    //    If the defect is present, ackedResults.length === TOTAL_ITEMS and the
    //    test fails here, exposing the silent data-loss.
    const ackedCount = entry.ackedResults.length;
    assert.ok(
      ackedCount < TOTAL_ITEMS,
      `only ${ackedCount} of ${TOTAL_ITEMS} items should be acked after abort; ` +
      `got all ${TOTAL_ITEMS} — checkpoint was cleared prematurely (data-loss bug)`,
    );

    // 4. A subsequent resume must successfully process the remaining items.
    //    The resume dispatcher gets a fresh source of the same total size;
    //    it should skip already-acked indices and complete the rest.
    //    (For async-iterable sources the caller provides a re-positioned
    //    iterator — here we supply a full fresh source and rely on the engine
    //    skipping already-acked items via seenIndices, which is only applicable
    //    to index-stable sources. For non-index-stable async sources the caller
    //    must supply the remainder. We test the simpler array-based resume path
    //    to confirm the checkpoint is usable.)
    const resumeDispatcher = new Dagonizer<AbortState>();
    const resumeWorker: NodeInterface<AbortState, 'success'> = {
      'name':    'worker',
      'outputs': ['success'],
      async execute(state) {
        state.processed.push(state.getMetadata<number>('item') ?? -1);
        return { 'output': 'success' };
      },
    };
    resumeDispatcher.registerNode(resumeWorker);

    // Supply an array-based resume DAG so the engine can skip seen indices.
    const resumeDag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:abort-async-resume',
      '@type':    'DAG',
      'name':     'abort-async-resume',
      'version':  '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id':         'urn:noocodex:dag:abort-async-resume/node/fan',
          '@type':       'ScatterNode',
          'name':        'fan',
          'body':        { 'node': 'worker' },
          'source':      'items',
          'itemKey':     'item',
          'concurrency': 2,
          'gather':      { 'strategy': 'append', 'target': 'processed' },
          'outputs':     { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
        },
      ],
    };
    resumeDispatcher.registerDAG(resumeDag);

    // Build resume state: rehydrate the aborted state's snapshot, set a full
    // array source (index-stable), preserve the checkpoint metadata.
    const resumeState = new AbortState();
    // Copy the checkpoint metadata from the aborted state.
    const abortedCheckpoint = result.state.getMetadata<Record<string, ScatterProgress>>(SCATTER_PROGRESS_KEY);
    if (abortedCheckpoint !== undefined) {
      resumeState.setMetadata(SCATTER_PROGRESS_KEY, abortedCheckpoint);
    }
    // Copy already-processed items so aggregate is correct.
    resumeState.processed = [...result.state.processed];
    // Provide full array source for index-stable resume.
    resumeState.items = Array.from({ 'length': TOTAL_ITEMS }, (_, i) => i + 1);

    const resumeResult = await resumeDispatcher.resume('abort-async-resume', resumeState, 'fan');

    // 5. Resume must complete successfully (cursor null).
    assert.equal(resumeResult.cursor, null,
      `resume must complete; cursor should be null, got '${resumeResult.cursor}'`);

    // 6. All TOTAL_ITEMS must appear in processed exactly once.
    assert.equal(
      resumeResult.state.processed.length,
      TOTAL_ITEMS,
      `expected ${TOTAL_ITEMS} processed items total; got ${resumeResult.state.processed.length}`,
    );
  });

  /**
   * Simpler scenario: signal already aborted when the pull-loop starts.
   * The loop must exit immediately without pulling or acking any items.
   * The checkpoint (if present) must be preserved as-is.
   */
  void it('pre-aborted signal: pull-loop exits before processing any items', async () => {
    const dispatcher = new Dagonizer<AbortState>();

    const worker: NodeInterface<AbortState, 'success'> = {
      'name':    'worker',
      'outputs': ['success'],
      async execute(state) {
        state.processed.push(state.getMetadata<number>('item') ?? -1);
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    dispatcher.registerDAG(makeAbortDag('pre-aborted', 2));

    const state = new AbortState();

    async function* lazySource(): AsyncGenerator<number> {
      for (let i = 1; i <= 10; i++) yield i;
    }
    state.items = lazySource();

    // Abort before execution starts.
    const ctl = new AbortController();
    ctl.abort(new Error('pre-abort'));

    const result = await dispatcher.execute('pre-aborted', state, { 'signal': ctl.signal });

    // Pre-abort is caught in runNodes mainLoop before executeScatter is even
    // reached, so cursor stays on 'fan', processed is empty.
    assert.equal(result.cursor, 'fan', 'cursor should be fan after pre-abort');
    assert.equal(result.state.processed.length, 0, 'no items should have been processed');
  });

  /**
   * Abort-then-resume: verify that acked items from the aborted run are NOT
   * re-executed on resume (exactly-once guarantee).
   */
  void it('items acked before abort are not re-executed on resume', async () => {
    const TOTAL_ITEMS = 20;
    const ABORT_AFTER = 5;

    let completedCount = 0;
    const controller = new AbortController();
    const executedItems: number[] = [];

    const dispatcher = new Dagonizer<AbortState>();
    const worker: NodeInterface<AbortState, 'success'> = {
      'name':    'worker',
      'outputs': ['success'],
      async execute(state, context) {
        await new Promise<void>((resolve, reject) => {
          const handle = setTimeout(resolve, 1);
          context.signal.addEventListener('abort', () => {
            clearTimeout(handle);
            reject(context.signal.reason);
          }, { 'once': true });
        });
        const item = state.getMetadata<number>('item') ?? -1;
        executedItems.push(item);
        if (++completedCount === ABORT_AFTER) {
          controller.abort(new Error('abort-at-5'));
        }
        state.processed.push(item);
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);

    // Use array source for deterministic index-stable resume.
    const abortDag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:exactly-once-abort',
      '@type':    'DAG',
      'name':     'exactly-once-abort',
      'version':  '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id':         'urn:noocodex:dag:exactly-once-abort/node/fan',
          '@type':       'ScatterNode',
          'name':        'fan',
          'body':        { 'node': 'worker' },
          'source':      'items',
          'itemKey':     'item',
          'concurrency': 1,
          'gather':      { 'strategy': 'append', 'target': 'processed' },
          'outputs':     { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
        },
      ],
    };
    dispatcher.registerDAG(abortDag);

    const state = new AbortState();
    state.items = Array.from({ 'length': TOTAL_ITEMS }, (_, i) => i + 1);

    const partial = await dispatcher.execute('exactly-once-abort', state, { 'signal': controller.signal });

    assert.equal(partial.cursor, 'fan', 'run must be interrupted');

    // Resume with fresh dispatcher.
    const resumeItems: number[] = [];
    const resumeDispatcher = new Dagonizer<AbortState>();
    const resumeWorker: NodeInterface<AbortState, 'success'> = {
      'name':    'worker',
      'outputs': ['success'],
      async execute(state) {
        const item = state.getMetadata<number>('item') ?? -1;
        resumeItems.push(item);
        state.processed.push(item);
        return { 'output': 'success' };
      },
    };
    resumeDispatcher.registerNode(resumeWorker);
    resumeDispatcher.registerDAG(abortDag);

    // Restore state for resume.
    const resumeState = new AbortState();
    const checkpoint = partial.state.getMetadata<Record<string, ScatterProgress>>(SCATTER_PROGRESS_KEY);
    if (checkpoint !== undefined) {
      resumeState.setMetadata(SCATTER_PROGRESS_KEY, checkpoint);
    }
    resumeState.processed = [...partial.state.processed];
    resumeState.items = Array.from({ 'length': TOTAL_ITEMS }, (_, i) => i + 1);

    const resumeResult = await resumeDispatcher.resume('exactly-once-abort', resumeState, 'fan');

    assert.equal(resumeResult.cursor, null, 'resume must complete');

    // No item appears in both executedItems (first run) AND resumeItems (resume).
    const firstRunSet = new Set(executedItems);
    const overlap = resumeItems.filter((v) => firstRunSet.has(v));
    assert.equal(
      overlap.length,
      0,
      `items re-executed on resume that were already completed in first run: [${overlap.join(', ')}]`,
    );

    // All TOTAL_ITEMS must appear across the two runs.
    const allExecuted = new Set([...executedItems, ...resumeItems]);
    assert.equal(allExecuted.size, TOTAL_ITEMS,
      `expected ${TOTAL_ITEMS} unique items across both runs; got ${allExecuted.size}`);
  });
});
