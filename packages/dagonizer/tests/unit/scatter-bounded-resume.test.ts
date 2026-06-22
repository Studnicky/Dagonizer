/**
 * scatter-bounded-resume: O(1)-memory scatter checkpoint property tests.
 *
 * Proves three invariants of the bounded watermark checkpoint:
 *
 * 1. aheadAcked is bounded by concurrency — at no point during execution does
 *    the out-of-order buffer exceed the window size, so memory is O(1) in the
 *    number of total items, not O(n).
 *
 * 2. watermark is monotonically non-decreasing and equals the highest contiguous
 *    completed index + 1 (i.e., all indices < watermark are accounted for in
 *    outcomeTally, none remain in aheadAcked).
 *
 * 3. Resume from a bounded checkpoint processes every un-acked item exactly
 *    once — no item is silently lost and no item is processed twice.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { ScatterProgressType, StoredScatterProgressType } from '../../src/Dagonizer.js';
import { SCATTER_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';
import { TestNode } from '../_support/TestNode.js';

// ── state ────────────────────────────────────────────────────────────────────

class BoundedState extends NodeStateBase {
  items: number[] = [];
  processed: number[] = [];

  protected override snapshotData(): JsonObjectType {
    return { 'items': [...this.items], 'processed': [...this.processed] };
  }

  protected override restoreData(snap: JsonObjectType): void {
    const rawItems = snap['items'];
    if (Array.isArray(rawItems)) this.items = rawItems.filter((x): x is number => typeof x === 'number');
    const rawProcessed = snap['processed'];
    if (Array.isArray(rawProcessed)) this.processed = rawProcessed.filter((x): x is number => typeof x === 'number');
  }
}

// ── worker node ──────────────────────────────────────────────────────────────

const boundedWorkerNode = TestNode.make<BoundedState>('worker', ['success']);

// ── minimal scatter DAG ──────────────────────────────────────────────────────

class TestScatterDag {
  private constructor() {}
  static ofConcurrency(name: string, concurrency: number): DAGType {
    return {
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
          'outputs':     {
            'all-success': 'end',
            'partial':     'end',
            'all-error':   'end',
            'empty':       'end',
          },
        },
        {
          '@id':     `urn:noocodex:dag:${name}/node/end`,
          '@type':   'TerminalNode',
          'name':    'end',
          'outcome': 'completed',
        },
      ],
    };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

class ProgressCapture {
  private constructor() {}

  /** Extract all bounded-mode ScatterProgressType snapshots from metadata writes. */
  static install(
    state: BoundedState,
  ): Array<Extract<ScatterProgressType, { mode: 'bounded' }>> {
    const snapshots: Array<Extract<ScatterProgressType, { mode: 'bounded' }>> = [];
    const orig = state.setMetadata.bind(state);
    state.setMetadata = (key: string, value: unknown): void => {
      orig(key, value);
      if (key === SCATTER_PROGRESS_KEY) {
        const isStoredProgress = (v: unknown): v is Record<string, ScatterProgressType> =>
          typeof v === 'object' && v !== null;
        if (isStoredProgress(value)) {
          const entry = value['fan'];
          if (entry?.mode === 'bounded') {
            snapshots.push({ ...entry });
          }
        }
      }
    };
    return snapshots;
  }
}

// ── checkpoint sizer ───────────────────────────────────────────────────────────

class CheckpointSizer {
  private constructor() {}

  /**
   * Run a crash-after-`crashAt` scatter over `n` items and return the JSON byte
   * length of the SCATTER_PROGRESS_KEY checkpoint captured at abort time.
   */
  static async byteLength(n: number, crashAt: number): Promise<number> {
    let completedCount = 0;
    const ctl = new AbortController();

    const dispatcher = new Dagonizer<BoundedState>();

    class SizeWorkerNode extends ScalarNode<BoundedState, 'success'> {
      override readonly name = 'worker';
      override readonly outputs = ['success'] as const;
      override get outputSchema(): Record<'success', SchemaObjectType> { return { 'success': { 'type': 'object' } }; }
      protected override async executeOne(state: BoundedState, context: NodeContextType): Promise<NodeOutputType<'success'>> {
        await new Promise<void>((resolve, reject) => {
          const handle = setTimeout(resolve, 1);
          context.signal.addEventListener('abort', () => {
            clearTimeout(handle);
            reject(context.signal.reason);
          }, { 'once': true });
        });
        const item = state.getter.number('item', -1);
        state.processed.push(item);
        if (++completedCount === crashAt) {
          ctl.abort(new Error('crash'));
        }
        return { 'errors': [], 'output': 'success' };
      }
    }
    dispatcher.registerNode(new SizeWorkerNode());

    const dagName = `size-bound-n${n}`;
    dispatcher.registerDAG(TestScatterDag.ofConcurrency(dagName, 2));

    const st = new BoundedState();
    st.items = Array.from({ 'length': n }, (_, i) => i + 1);

    const result = await dispatcher.execute(dagName, st, { 'signal': ctl.signal });

    const storedRaw = result.state.getMetadata(SCATTER_PROGRESS_KEY);
    assert.ok(storedRaw !== undefined, `checkpoint must be present after abort (n=${n})`);
    const stored: StoredScatterProgressType = Validator.storedScatterProgress.validate(storedRaw);
    const entry = stored['fan'];
    assert.ok(entry !== undefined, `expected progress entry for "fan" (n=${n})`);
    // Narrow to bounded mode — no casts.
    assert.ok(entry.mode === 'bounded', `expected bounded mode checkpoint (n=${n}); got ${entry.mode}`);

    return JSON.stringify(entry).length;
  }
}

// ── tests ────────────────────────────────────────────────────────────────────

void describe('Scatter: O(1) bounded watermark checkpoint', () => {
  void it('aheadAcked length never exceeds concurrency during execution', async () => {
    const CONCURRENCY = 3;
    const TOTAL = 20;

    const dispatcher = new Dagonizer<BoundedState>();
    dispatcher.registerNode(boundedWorkerNode);
    dispatcher.registerDAG(TestScatterDag.ofConcurrency('bounded-ahead-cap', CONCURRENCY));

    const state = new BoundedState();
    state.items = Array.from({ 'length': TOTAL }, (_, i) => i + 1);
    const snapshots = ProgressCapture.install(state);

    await dispatcher.execute('bounded-ahead-cap', state);

    assert.ok(snapshots.length > 0, 'expected checkpoint writes to have occurred');

    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      assert.ok(snap !== undefined);
      assert.ok(
        snap.aheadAcked.length <= CONCURRENCY,
        `snapshot[${i}]: aheadAcked.length=${snap.aheadAcked.length} must not exceed concurrency=${CONCURRENCY}`,
      );
    }
  });

  void it('watermark is monotonically non-decreasing across checkpoint writes', async () => {
    const TOTAL = 10;

    const dispatcher = new Dagonizer<BoundedState>();
    dispatcher.registerNode(boundedWorkerNode);
    dispatcher.registerDAG(TestScatterDag.ofConcurrency('bounded-watermark-mono', 2));

    const state = new BoundedState();
    state.items = Array.from({ 'length': TOTAL }, (_, i) => (i + 1) * 10);
    const snapshots = ProgressCapture.install(state);

    await dispatcher.execute('bounded-watermark-mono', state);

    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1];
      const curr = snapshots[i];
      assert.ok(prev !== undefined && curr !== undefined);
      assert.ok(
        curr.watermark >= prev.watermark,
        `watermark must be non-decreasing: snapshot[${i - 1}].watermark=${prev.watermark} > snapshot[${i}].watermark=${curr.watermark}`,
      );
    }
  });

  void it('outcomeTally total equals watermark + aheadAcked.length at every checkpoint', async () => {
    const TOTAL = 8;

    const dispatcher = new Dagonizer<BoundedState>();
    dispatcher.registerNode(boundedWorkerNode);
    dispatcher.registerDAG(TestScatterDag.ofConcurrency('bounded-tally', 2));

    const state = new BoundedState();
    state.items = Array.from({ 'length': TOTAL }, (_, i) => i);
    const snapshots = ProgressCapture.install(state);

    await dispatcher.execute('bounded-tally', state);

    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      assert.ok(snap !== undefined);
      const tallyTotal = Object.values(snap.outcomeTally).reduce((s: number, n: number) => s + n, 0);
      const expectedTotal = snap.watermark + snap.aheadAcked.length;
      assert.equal(
        tallyTotal,
        expectedTotal,
        `snapshot[${i}]: outcomeTally total=${tallyTotal} must equal watermark+aheadAcked=${expectedTotal}`,
      );
    }
  });

  void it('resume from bounded checkpoint delivers all items exactly once', async () => {
    // Simulate an interrupted run: 5 items total, items 0 and 1 were acked
    // (watermark=2), item 2 was in inbox. Resume must process items 2, 3, 4.
    const processedItems: number[] = [];

    const dispatcher = new Dagonizer<BoundedState>();
    dispatcher.registerNode(TestNode.make<BoundedState>('worker', ['success'], (state) => {
      const item = state.getter.number('item', -1);
      processedItems.push(item);
      return 'success';
    }));
    dispatcher.registerDAG(TestScatterDag.ofConcurrency('bounded-resume', 2));

    const state = new BoundedState();
    state.items = [10, 20, 30, 40, 50];
    // Items 0 (value=10) and 1 (value=20) already gathered into processed.
    state.processed = [10, 20];

    // Pre-seed a bounded checkpoint: items 0 and 1 acked (watermark=2),
    // item 2 in inbox (in-flight at crash time).
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      'fan': {
        'mode':          'bounded' as const,
        'placementName': 'fan',
        'inbox':         [{ 'index': 2, 'item': 30 }],
        'watermark':     2,
        'aheadAcked':    [],
        'outcomeTally':  { 'success': 2 },
      },
    });

    const result = await dispatcher.resume('bounded-resume', state, 'fan');

    assert.equal(result.cursor, null, 'flow must complete cleanly on resume');

    // Items processed in this run: inbox item 2 (value=30) + fresh items 3,4 (40,50).
    assert.equal(processedItems.length, 3,
      `expected 3 items processed in resume run (inbox + 2 fresh), got ${processedItems.length}: ${JSON.stringify(processedItems)}`);

    // Values 10 and 20 are NOT reprocessed (already acked).
    assert.ok(!processedItems.includes(10), 'item 10 (index 0, already acked) must not be reprocessed');
    assert.ok(!processedItems.includes(20), 'item 20 (index 1, already acked) must not be reprocessed');

    // Values 30, 40, 50 ARE processed exactly once.
    assert.ok(processedItems.includes(30), 'inbox item 30 must be processed');
    assert.ok(processedItems.includes(40), 'fresh item 40 must be processed');
    assert.ok(processedItems.includes(50), 'fresh item 50 must be processed');

    assert.equal(processedItems.filter((v) => v === 30).length, 1, 'item 30 must not be processed twice');

    // Final processed array: pre-seeded [10, 20] + appended [30, 40, 50] (order may vary).
    assert.equal(result.state.processed.length, 5,
      `expected 5 total processed items, got ${result.state.processed.length}`);

    // Progress cleared on clean completion.
    assert.equal(result.state.getMetadata(SCATTER_PROGRESS_KEY), undefined,
      'SCATTER_PROGRESS_KEY must be cleared after clean completion');
  });

  // The resumed accumulator is byte-identical to an uninterrupted run over the
  // same N; the bounded checkpoint loses no correctness.
  void it('abort+resume produces byte-identical accumulator to an uninterrupted run', async () => {
    const N = 200;
    const K = 50; // abort after K completions

    // ── baseline: uninterrupted run ──────────────────────────────────────────

    const baselineDispatcher = new Dagonizer<BoundedState>();
    baselineDispatcher.registerNode(boundedWorkerNode);
    baselineDispatcher.registerDAG(TestScatterDag.ofConcurrency('byte-identity-baseline', 2));

    const baselineDispatcher2 = new Dagonizer<BoundedState>();
    baselineDispatcher2.registerNode(TestNode.make<BoundedState>('worker', ['success'], (state) => {
      const item = state.getter.number('item', -1);
      state.processed.push(item);
      return 'success';
    }));
    baselineDispatcher2.registerDAG(TestScatterDag.ofConcurrency('byte-identity-baseline', 2));

    const baselineState = new BoundedState();
    baselineState.items = Array.from({ 'length': N }, (_, i) => i + 1);

    const baselineResult = await baselineDispatcher2.execute('byte-identity-baseline', baselineState);
    const baseline = [...baselineResult.state.processed].sort((a, b) => a - b);

    // ── interrupted run: abort after K completions ───────────────────────────

    let completedCount = 0;
    const controller = new AbortController();

    const interruptedDispatcher = new Dagonizer<BoundedState>();

    class InterruptedWorkerNode extends ScalarNode<BoundedState, 'success'> {
      override readonly name = 'worker';
      override readonly outputs = ['success'] as const;
      override get outputSchema(): Record<'success', SchemaObjectType> { return { 'success': { 'type': 'object' } }; }
      protected override async executeOne(state: BoundedState, context: NodeContextType): Promise<NodeOutputType<'success'>> {
        await new Promise<void>((resolve, reject) => {
          const handle = setTimeout(resolve, 1);
          context.signal.addEventListener('abort', () => {
            clearTimeout(handle);
            reject(context.signal.reason);
          }, { 'once': true });
        });
        const item = state.getter.number('item', -1);
        state.processed.push(item);
        if (++completedCount === K) {
          controller.abort(new Error('crash'));
        }
        return { 'errors': [], 'output': 'success' };
      }
    }
    interruptedDispatcher.registerNode(new InterruptedWorkerNode());
    interruptedDispatcher.registerDAG(TestScatterDag.ofConcurrency('byte-identity-interrupted', 2));

    const interruptedState = new BoundedState();
    interruptedState.items = Array.from({ 'length': N }, (_, i) => i + 1);

    const partial = await interruptedDispatcher.execute(
      'byte-identity-interrupted',
      interruptedState,
      { 'signal': controller.signal },
    );

    assert.equal(partial.cursor, 'fan', 'interrupted run must pause at fan');

    // ── resume: fresh dispatcher + fresh worker (no abort) ───────────────────

    const resumeDispatcher = new Dagonizer<BoundedState>();

    resumeDispatcher.registerNode(TestNode.make<BoundedState>('worker', ['success'], (state) => {
      const item = state.getter.number('item', -1);
      state.processed.push(item);
      return 'success';
    }));
    resumeDispatcher.registerDAG(TestScatterDag.ofConcurrency('byte-identity-interrupted', 2));

    const resumeState = new BoundedState();
    // Carry the bounded checkpoint metadata from the partial run.
    const checkpoint = partial.state.getMetadata(SCATTER_PROGRESS_KEY);
    if (checkpoint !== undefined) {
      resumeState.setMetadata(SCATTER_PROGRESS_KEY, checkpoint);
    }
    // Carry already-processed items so the accumulator is cumulative.
    resumeState.processed = [...partial.state.processed];
    // Full index-stable array source so the engine skips already-acked indices.
    resumeState.items = Array.from({ 'length': N }, (_, i) => i + 1);

    const resumeResult = await resumeDispatcher.resume('byte-identity-interrupted', resumeState, 'fan');

    assert.equal(resumeResult.cursor, null, 'resume must complete cleanly');

    // ── byte-identity assertion ───────────────────────────────────────────────

    assert.equal(
      resumeResult.state.processed.length,
      N,
      `expected ${N} items in processed after resume; got ${resumeResult.state.processed.length} — every item must appear exactly once`,
    );

    assert.deepStrictEqual(
      [...resumeResult.state.processed].sort((a, b) => a - b),
      baseline,
      'resumed accumulator must be byte-identical (sorted) to an uninterrupted run over the same N items',
    );
  });

  // The bounded checkpoint (watermark + ahead-acked window + outcome tally)
  // stays O(1) in serialised size regardless of item count; an O(N) acked
  // array would roughly 10x from N=200 to N=2000.
  void it('mid-stream checkpoint size stays bounded as item count grows', async () => {
    const K = 50; // fixed crash point for both runs — same ahead-acked window size

    const size200 = await CheckpointSizer.byteLength(200, K);
    const size2000 = await CheckpointSizer.byteLength(2000, K);

    assert.ok(
      size2000 < size200 * 2,
      `checkpoint size must be bounded: size200=${size200}, size2000=${size2000}; ` +
      `expected size2000 < size200*2 (${size200 * 2}) — an O(N) acked array would roughly 10x`,
    );
  });

  void it('final checkpoint after clean run uses bounded mode with watermark = item count', async () => {
    const TOTAL = 5;
    const dispatcher = new Dagonizer<BoundedState>();
    dispatcher.registerNode(boundedWorkerNode);
    dispatcher.registerDAG(TestScatterDag.ofConcurrency('bounded-final', 2));

    const state = new BoundedState();
    state.items = Array.from({ 'length': TOTAL }, (_, i) => i + 1);
    const snapshots = ProgressCapture.install(state);

    await dispatcher.execute('bounded-final', state);

    assert.ok(snapshots.length === TOTAL,
      `expected ${TOTAL} checkpoint writes (one per ack), got ${snapshots.length}`);

    // Last snapshot before clear: watermark = TOTAL, aheadAcked empty.
    const last = snapshots[TOTAL - 1];
    assert.ok(last !== undefined);
    assert.equal(last.mode, 'bounded');
    assert.equal(last.watermark, TOTAL, `final watermark must equal total items (${TOTAL})`);
    assert.equal(last.aheadAcked.length, 0, 'aheadAcked must be empty after all contiguous acks');
    const tallyTotal = Object.values(last.outcomeTally).reduce((s: number, n: number) => s + n, 0);
    assert.equal(tallyTotal, TOTAL, `outcomeTally total must equal ${TOTAL}`);
  });
});
