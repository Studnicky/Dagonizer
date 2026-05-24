import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Checkpoint } from '../../src/checkpoint/Checkpoint.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer, FAN_OUT_PROGRESS_KEY } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import type { JsonObject } from '../../src/entities/json.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

/** State carrying a typed items / processed array plus an optional second
 *  fan-out source. Round-trips through snapshot/restore. */
class FanOutState extends NodeStateBase {
  items: number[] = [];
  items2: number[] = [];
  processed: number[] = [];
  processed2: number[] = [];

  protected override snapshotData(): JsonObject {
    return {
      'items':     [...this.items],
      'items2':    [...this.items2],
      'processed': [...this.processed],
      'processed2': [...this.processed2],
    };
  }

  protected override restoreData(snap: JsonObject): void {
    const items = snap['items'];
    if (Array.isArray(items)) this.items = items.filter((x): x is number => typeof x === 'number');
    const items2 = snap['items2'];
    if (Array.isArray(items2)) this.items2 = items2.filter((x): x is number => typeof x === 'number');
    const processed = snap['processed'];
    if (Array.isArray(processed)) this.processed = processed.filter((x): x is number => typeof x === 'number');
    const processed2 = snap['processed2'];
    if (Array.isArray(processed2)) this.processed2 = processed2.filter((x): x is number => typeof x === 'number');
  }
}

interface FanOutProgressShape {
  readonly placementName: string;
  readonly completedIndices: readonly number[];
  readonly itemResults: readonly { readonly index: number; readonly output: string }[];
}

void describe('Dagonizer fan-out per-item resume bookkeeping', () => {
  void it('clean run executes every item and leaves no progress entry', async () => {
    const dispatcher = new Dagonizer<FanOutState>();
    let calls = 0;
    const worker: NodeInterface<FanOutState, 'success'> = {
      'name': 'worker',
      'outputs': ['success'],
      async execute(state) {
        calls++;
        const item = state.getMetadata<number>('item') ?? 0;
        state.setMetadata('processedItem', item);
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fanout-clean',
      '@type':    'DAG',
      'name': 'fanout-clean', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:fanout-clean/node/fan', '@type': 'FanOutNode',
          'name': 'fan', 'node': 'worker',
          'source': 'items', 'itemKey': 'item',
          'fanIn': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new FanOutState();
    state.items = [10, 20, 30, 40, 50];
    const result = await dispatcher.execute('fanout-clean', state);

    assert.equal(calls, 5);
    assert.equal(result.cursor, null);
    assert.deepEqual([...result.state.processed].sort((a, b) => a - b), [10, 20, 30, 40, 50]);

    // No fan-out progress entry should remain after clean completion.
    const stored = result.state.getMetadata<Record<string, unknown>>(FAN_OUT_PROGRESS_KEY);
    assert.equal(stored, undefined, 'progress key should be deleted after clean completion');
  });

  void it('records completedIndices on interruption mid-flight', async () => {
    const dispatcher = new Dagonizer<FanOutState>();
    let completedCount = 0;
    // Concurrency 1 to make the per-batch progress write deterministic.
    // Worker throws after two completions so the fan-out aborts before
    // the loop drains; the per-batch progress writes from completed
    // batches survive on `state.metadata` for inspection.
    const worker: NodeInterface<FanOutState, 'success'> = {
      'name': 'worker',
      'outputs': ['success'],
      async execute() {
        const idx = ++completedCount;
        if (idx === 3) {
          // Throw on the third item so the fan-out errors out — the
          // first two batches' progress writes are already persisted.
          throw new Error('simulated mid-flight failure');
        }
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fanout-interrupt',
      '@type':    'DAG',
      'name': 'fanout-interrupt', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:fanout-interrupt/node/fan', '@type': 'FanOutNode',
          'name': 'fan', 'node': 'worker',
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'fanIn': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new FanOutState();
    state.items = [1, 2, 3, 4, 5];
    const result = await dispatcher.execute('fanout-interrupt', state);

    // Fan-out threw — cursor stays on 'fan'.
    assert.equal(result.cursor, 'fan');

    const stored = result.state.getMetadata<Record<string, FanOutProgressShape>>(FAN_OUT_PROGRESS_KEY);
    assert.ok(stored !== undefined, 'expected progress entry after interruption');
    const entry = stored['fan'];
    assert.ok(entry !== undefined, 'expected an entry under fan-out name');
    // Items 0 and 1 completed before item 2 threw; index 2 should NOT
    // be in completedIndices.
    assert.deepEqual([...entry.completedIndices].sort((a, b) => a - b), [0, 1]);
    assert.equal(entry.itemResults.length, 2);
    for (const r of entry.itemResults) {
      assert.equal(r.output, 'success');
    }
  });

  void it('resume skips already-completed indices and re-executes only the rest', async () => {
    const dispatcher = new Dagonizer<FanOutState>();
    let calls = 0;
    const worker: NodeInterface<FanOutState, 'success'> = {
      'name': 'worker',
      'outputs': ['success'],
      async execute() {
        calls++;
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fanout-resume',
      '@type':    'DAG',
      'name': 'fanout-resume', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:fanout-resume/node/fan', '@type': 'FanOutNode',
          'name': 'fan', 'node': 'worker',
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'fanIn': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    // Pre-seed progress for items 0 and 1 (simulating a checkpoint
    // restored from an interrupted run).
    const state = new FanOutState();
    state.items = [10, 20, 30, 40, 50];
    state.setMetadata(FAN_OUT_PROGRESS_KEY, {
      'fan': {
        'placementName': 'fan',
        'completedIndices': [0, 1],
        'itemResults': [
          { 'index': 0, 'output': 'success' },
          { 'index': 1, 'output': 'success' },
        ],
      },
    });

    const result = await dispatcher.resume('fanout-resume', state, 'fan');

    // Worker called only for items 2, 3, 4 — three new executions.
    assert.equal(calls, 3, `expected 3 fresh worker calls, got ${calls}`);
    assert.equal(result.cursor, null);
    // Progress entry cleared on clean completion.
    const stored = result.state.getMetadata<Record<string, unknown>>(FAN_OUT_PROGRESS_KEY);
    assert.equal(stored, undefined);
  });

  void it('resumed aggregate output reflects every item including prior-run ones', async () => {
    const dispatcher = new Dagonizer<FanOutState>();
    const worker: NodeInterface<FanOutState, 'success'> = {
      'name': 'worker',
      'outputs': ['success'],
      async execute() {
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fanout-aggregate',
      '@type':    'DAG',
      'name': 'fanout-aggregate', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:fanout-aggregate/node/fan', '@type': 'FanOutNode',
          'name': 'fan', 'node': 'worker',
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'fanIn': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new FanOutState();
    state.items = [11, 22, 33, 44, 55];
    state.setMetadata(FAN_OUT_PROGRESS_KEY, {
      'fan': {
        'placementName': 'fan',
        'completedIndices': [0, 1],
        'itemResults': [
          { 'index': 0, 'output': 'success' },
          { 'index': 1, 'output': 'success' },
        ],
      },
    });

    const result = await dispatcher.resume('fanout-aggregate', state, 'fan');

    // Fan-in appended every item (resumed + fresh) — append uses the
    // resultsByOutput buckets that include rehydrated prior items.
    assert.equal(result.state.processed.length, 5);
    assert.deepEqual([...result.state.processed].sort((a, b) => a - b), [11, 22, 33, 44, 55]);
  });

  void it('two distinct fan-outs in one flow keep independent progress entries', async () => {
    const dispatcher = new Dagonizer<FanOutState>();
    let aCalls = 0;
    let bCalls = 0;
    const workerA: NodeInterface<FanOutState, 'success'> = {
      'name': 'workerA',
      'outputs': ['success'],
      async execute() {
        aCalls++;
        return { 'output': 'success' };
      },
    };
    const workerB: NodeInterface<FanOutState, 'success'> = {
      'name': 'workerB',
      'outputs': ['success'],
      async execute() {
        bCalls++;
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(workerA);
    dispatcher.registerNode(workerB);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fanout-twin',
      '@type':    'DAG',
      'name': 'fanout-twin', 'version': '1', 'entrypoint': 'fanA',
      'nodes': [
        { '@id': 'urn:noocodex:dag:fanout-twin/node/fanA', '@type': 'FanOutNode',
          'name': 'fanA', 'node': 'workerA',
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'fanIn': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': 'fanB', 'partial': 'fanB', 'all-error': 'fanB', 'empty': 'fanB' } },
        { '@id': 'urn:noocodex:dag:fanout-twin/node/fanB', '@type': 'FanOutNode',
          'name': 'fanB', 'node': 'workerB',
          'source': 'items2', 'itemKey': 'item', 'concurrency': 1,
          'fanIn': { 'strategy': 'append', 'target': 'processed2' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    // Pre-seed progress for BOTH fan-outs simultaneously, each having
    // completed different indices in different sources.
    const state = new FanOutState();
    state.items = [100, 200, 300];
    state.items2 = [1, 2, 3, 4];
    state.setMetadata(FAN_OUT_PROGRESS_KEY, {
      'fanA': {
        'placementName': 'fanA',
        'completedIndices': [0],
        'itemResults': [{ 'index': 0, 'output': 'success' }],
      },
      'fanB': {
        'placementName': 'fanB',
        'completedIndices': [0, 2],
        'itemResults': [
          { 'index': 0, 'output': 'success' },
          { 'index': 2, 'output': 'success' },
        ],
      },
    });

    const result = await dispatcher.resume('fanout-twin', state, 'fanA');

    // fanA had 1 completed of 3 → 2 fresh calls.
    assert.equal(aCalls, 2, `expected 2 workerA calls, got ${aCalls}`);
    // fanB had 2 completed of 4 → 2 fresh calls.
    assert.equal(bCalls, 2, `expected 2 workerB calls, got ${bCalls}`);
    assert.equal(result.cursor, null);
    // Both placement entries cleared after their respective fan-outs complete.
    const stored = result.state.getMetadata<Record<string, unknown>>(FAN_OUT_PROGRESS_KEY);
    assert.equal(stored, undefined);
    // Aggregate outputs include every item (prior + fresh).
    assert.equal(result.state.processed.length, 3);
    assert.equal(result.state.processed2.length, 4);
  });

  void it('treats indices verbatim when the source array changes between checkpoint and resume', async () => {
    const dispatcher = new Dagonizer<FanOutState>();
    let calls = 0;
    const observedItems: number[] = [];
    const worker: NodeInterface<FanOutState, 'success'> = {
      'name': 'worker',
      'outputs': ['success'],
      async execute(state) {
        calls++;
        const item = state.getMetadata<number>('item') ?? -1;
        observedItems.push(item);
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fanout-strict-index',
      '@type':    'DAG',
      'name': 'fanout-strict-index', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:fanout-strict-index/node/fan', '@type': 'FanOutNode',
          'name': 'fan', 'node': 'worker',
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'fanIn': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    // Pre-existing progress claims indices 0 and 1 are done. Then the
    // consumer rewrites the source array (re-slicing, reordering) before
    // calling resume. The fan-out trusts the persisted indices — it
    // skips positions 0 and 1 of the NEW array.
    const state = new FanOutState();
    state.items = [10, 20, 30, 40, 50];
    state.setMetadata(FAN_OUT_PROGRESS_KEY, {
      'fan': {
        'placementName': 'fan',
        'completedIndices': [0, 1],
        'itemResults': [
          { 'index': 0, 'output': 'success' },
          { 'index': 1, 'output': 'success' },
        ],
      },
    });
    // Consumer rewrites the source. Items now: [999, 888, 777, 666, 555].
    state.items = [999, 888, 777, 666, 555];

    const result = await dispatcher.resume('fanout-strict-index', state, 'fan');

    // 3 fresh executions for the items at positions 2..4 of the NEW
    // array — strict index semantics, items 777, 666, 555.
    assert.equal(calls, 3);
    assert.deepEqual(observedItems.sort((a, b) => a - b), [555, 666, 777]);
    assert.equal(result.cursor, null);
    // Aggregate also picks up the prior items as recorded (the items at
    // indices 0 and 1 of the rewritten array, since strict semantics
    // reads back through the current source).
    assert.equal(result.state.processed.length, 5);
    assert.deepEqual([...result.state.processed].sort((a, b) => a - b), [555, 666, 777, 888, 999]);
  });

  void it('per-batch write cadence — one progress update per batch, not per item', async () => {
    // Snapshot the progress entry after every batch boundary; verify
    // the snapshot count equals the number of batches (not items).
    const dispatcher = new Dagonizer<FanOutState>();
    let setMetadataCalls = 0;
    let progressUpdates = 0;
    const state = new FanOutState();
    state.items = [1, 2, 3, 4, 5, 6];

    // Wrap setMetadata to count progress-key writes specifically.
    const originalSet = state.setMetadata.bind(state);
    state.setMetadata = (key: string, value: unknown): void => {
      setMetadataCalls++;
      if (key === FAN_OUT_PROGRESS_KEY) progressUpdates++;
      originalSet(key, value);
    };

    const worker: NodeInterface<FanOutState, 'success'> = {
      'name': 'worker',
      'outputs': ['success'],
      async execute() {
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fanout-batched',
      '@type':    'DAG',
      'name': 'fanout-batched', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:fanout-batched/node/fan', '@type': 'FanOutNode',
          'name': 'fan', 'node': 'worker',
          'source': 'items', 'itemKey': 'item', 'concurrency': 3,
          'fanIn': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    await dispatcher.execute('fanout-batched', state);

    // 6 items / concurrency 3 = 2 batches → exactly 2 progress writes.
    assert.equal(progressUpdates, 2, `expected 2 batch writes, got ${progressUpdates}`);
    // sanity: setMetadata also fires for itemKey + itemIndex per item
    // on each cloned itemState, not on the parent state — so those do
    // not contribute to setMetadataCalls on the parent.
    assert.ok(setMetadataCalls >= 2);
  });
});

void describe('Dagonizer fan-out checkpoint round-trip', () => {
  void it('survives snapshot/restore through Checkpoint and resumes correctly', async () => {
    const dispatcher = new Dagonizer<FanOutState>();
    let calls = 0;
    const worker: NodeInterface<FanOutState, 'success'> = {
      'name': 'worker',
      'outputs': ['success'],
      async execute() {
        calls++;
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fanout-ckpt',
      '@type':    'DAG',
      'name': 'fanout-ckpt', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:fanout-ckpt/node/fan', '@type': 'FanOutNode',
          'name': 'fan', 'node': 'worker',
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'fanIn': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': 'tail', 'partial': 'tail', 'all-error': 'tail', 'empty': 'tail' } },
        { '@id': 'urn:noocodex:dag:fanout-ckpt/node/tail', '@type': 'SingleNode',
          'name': 'tail', 'node': 'worker', 'outputs': { 'success': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    // Build a state with pre-existing progress as if it had been
    // captured. Round-trip through Checkpoint codec.
    const state = new FanOutState();
    state.items = [7, 14, 21, 28];
    state.setMetadata(FAN_OUT_PROGRESS_KEY, {
      'fan': {
        'placementName': 'fan',
        'completedIndices': [0, 1],
        'itemResults': [
          { 'index': 0, 'output': 'success' },
          { 'index': 1, 'output': 'success' },
        ],
      },
    });
    // Use snapshot/restore directly to verify the codec carries the key.
    const snap = state.snapshot();
    const restored = FanOutState.restore(snap);
    const storedRestored = restored.getMetadata<Record<string, FanOutProgressShape>>(FAN_OUT_PROGRESS_KEY);
    assert.ok(storedRestored !== undefined);
    assert.deepEqual(storedRestored['fan']?.completedIndices, [0, 1]);

    const result = await dispatcher.resume('fanout-ckpt', restored, 'fan');
    // fan ran 2 fresh items + tail node = 3 calls.
    assert.equal(calls, 3);
    assert.equal(result.cursor, null);
    assert.equal(result.state.processed.length, 4);
  });

  void it('end-to-end Checkpoint capture/load round-trip preserves progress', async () => {
    const dispatcher = new Dagonizer<FanOutState>();
    const worker: NodeInterface<FanOutState, 'success'> = {
      'name': 'worker',
      'outputs': ['success'],
      async execute(_state, context) {
        // Long-running so we can abort mid-flight.
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 1000);
          context.signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(context.signal.reason);
          }, { 'once': true });
        });
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fanout-e2e',
      '@type':    'DAG',
      'name': 'fanout-e2e', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:fanout-e2e/node/fan', '@type': 'FanOutNode',
          'name': 'fan', 'node': 'worker',
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'fanIn': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new FanOutState();
    state.items = [1, 2, 3, 4];
    // Pre-seed one completed index so the partial-result path is
    // exercised even though the fan-out aborts before any natural item
    // completion.
    state.setMetadata(FAN_OUT_PROGRESS_KEY, {
      'fan': {
        'placementName': 'fan',
        'completedIndices': [0],
        'itemResults': [{ 'index': 0, 'output': 'success' }],
      },
    });

    const ctl = new AbortController();
    setTimeout(() => ctl.abort(new Error('pause')), 5);
    const exec = dispatcher.execute('fanout-e2e', state, { 'signal': ctl.signal });
    const partial = await exec;

    // The fan-out itself aborted — cursor still on 'fan'.
    assert.equal(partial.cursor, 'fan');
    const ckpt = await Checkpoint.capture('fanout-e2e', partial);
    const round = ckpt.toJson();
    const parsed = JSON.parse(round) as unknown;
    const ckpt2 = Checkpoint.load(parsed);
    const { 'state': rehydrated, cursor, dagName } = ckpt2.restoreState((snap) => FanOutState.restore(snap));
    assert.equal(cursor, 'fan');

    const stored = rehydrated.getMetadata<Record<string, FanOutProgressShape>>(FAN_OUT_PROGRESS_KEY);
    assert.ok(stored !== undefined, 'progress key should survive checkpoint codec');
    assert.deepEqual(stored['fan']?.completedIndices, [0]);

    // Sanity: dagName/state types route through the resume path. We
    // do not drive the resume to completion here because the worker
    // would block on a 1s timer.
    assert.equal(dagName, 'fanout-e2e');
  });
});
