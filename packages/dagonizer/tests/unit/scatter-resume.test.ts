import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Checkpoint } from '../../src/checkpoint/Checkpoint.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer, SCATTER_PROGRESS_KEY } from '../../src/Dagonizer.js';
import type { ScatterProgress } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import type { JsonObject } from '../../src/entities/json.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

/** State carrying a typed items / processed array plus an optional second
 *  scatter source, and a `results` array for the map-gather fix scenario.
 *  Round-trips through snapshot/restore. */
class ScatterState extends NodeStateBase {
  items: number[] = [];
  items2: number[] = [];
  processed: number[] = [];
  processed2: number[] = [];
  produced = 0;
  results: number[] = [];

  protected override snapshotData(): JsonObject {
    return {
      'items':     [...this.items],
      'items2':    [...this.items2],
      'processed': [...this.processed],
      'processed2': [...this.processed2],
      'produced':  this.produced,
      'results':   [...this.results],
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
    const produced = snap['produced'];
    if (typeof produced === 'number') this.produced = produced;
    const results = snap['results'];
    if (Array.isArray(results)) this.results = results.filter((x): x is number => typeof x === 'number');
  }
}

void describe('Dagonizer scatter per-item resume bookkeeping', () => {
  void it('clean run executes every item and leaves no progress entry', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    let calls = 0;
    const worker: NodeInterface<ScatterState, 'success'> = {
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
      '@id':      'urn:noocodex:dag:scatter-clean',
      '@type':    'DAG',
      'name': 'scatter-clean', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:scatter-clean/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'worker' },
          'source': 'items', 'itemKey': 'item',
          'gather': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new ScatterState();
    state.items = [10, 20, 30, 40, 50];
    const result = await dispatcher.execute('scatter-clean', state);

    assert.equal(calls, 5);
    assert.equal(result.cursor, null);
    assert.deepEqual([...result.state.processed].sort((a, b) => a - b), [10, 20, 30, 40, 50]);

    // No scatter progress entry should remain after clean completion.
    const stored = result.state.getMetadata<Record<string, unknown>>(SCATTER_PROGRESS_KEY);
    assert.equal(stored, undefined, 'progress key should be deleted after clean completion');
  });

  void it('records completedIndices on interruption mid-flight', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    let completedCount = 0;
    // Concurrency 1 to make the per-batch progress write deterministic.
    // Worker throws after two completions so the scatter aborts before
    // the loop drains; the per-batch progress writes from completed
    // batches survive on `state.metadata` for inspection.
    const worker: NodeInterface<ScatterState, 'success'> = {
      'name': 'worker',
      'outputs': ['success'],
      async execute() {
        const idx = ++completedCount;
        if (idx === 3) {
          // Throw on the third item so the scatter errors out; the
          // first two batches' progress writes are already persisted.
          throw new Error('simulated mid-flight failure');
        }
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:scatter-interrupt',
      '@type':    'DAG',
      'name': 'scatter-interrupt', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:scatter-interrupt/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'worker' },
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'gather': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new ScatterState();
    state.items = [1, 2, 3, 4, 5];
    const result = await dispatcher.execute('scatter-interrupt', state);

    // Scatter threw; cursor stays on 'fan'.
    assert.equal(result.cursor, 'fan');

    const stored = result.state.getMetadata<Record<string, ScatterProgress>>(SCATTER_PROGRESS_KEY);
    assert.ok(stored !== undefined, 'expected progress entry after interruption');
    const entry = stored['fan'];
    assert.ok(entry !== undefined, 'expected an entry under scatter name');
    // Items 0 and 1 completed before item 2 threw; index 2 should NOT
    // be in completedIndices.
    assert.deepEqual([...entry.completedIndices].sort((a, b) => a - b), [0, 1]);
    assert.equal(entry.itemResults.length, 2);
    for (const r of entry.itemResults) {
      assert.equal(r.output, 'success');
    }
  });

  void it('resume skips already-completed indices and re-executes only the rest', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    let calls = 0;
    const worker: NodeInterface<ScatterState, 'success'> = {
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
      '@id':      'urn:noocodex:dag:scatter-resume',
      '@type':    'DAG',
      'name': 'scatter-resume', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:scatter-resume/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'worker' },
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'gather': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    // Pre-seed progress for items 0 and 1 (simulating a checkpoint
    // restored from an interrupted run).
    const state = new ScatterState();
    state.items = [10, 20, 30, 40, 50];
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      'fan': {
        'placementName': 'fan',
        'completedIndices': [0, 1],
        'itemResults': [
          { 'index': 0, 'output': 'success' },
          { 'index': 1, 'output': 'success' },
        ],
      },
    });

    const result = await dispatcher.resume('scatter-resume', state, 'fan');

    // Worker called only for items 2, 3, 4: three new executions.
    assert.equal(calls, 3, `expected 3 fresh worker calls, got ${calls}`);
    assert.equal(result.cursor, null);
    // Progress entry cleared on clean completion.
    const stored = result.state.getMetadata<Record<string, unknown>>(SCATTER_PROGRESS_KEY);
    assert.equal(stored, undefined);
  });

  void it('resumed aggregate output reflects every item including prior-run ones', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    const worker: NodeInterface<ScatterState, 'success'> = {
      'name': 'worker',
      'outputs': ['success'],
      async execute() {
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:scatter-aggregate',
      '@type':    'DAG',
      'name': 'scatter-aggregate', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:scatter-aggregate/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'worker' },
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'gather': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new ScatterState();
    state.items = [11, 22, 33, 44, 55];
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      'fan': {
        'placementName': 'fan',
        'completedIndices': [0, 1],
        'itemResults': [
          { 'index': 0, 'output': 'success' },
          { 'index': 1, 'output': 'success' },
        ],
      },
    });

    const result = await dispatcher.resume('scatter-aggregate', state, 'fan');

    // Gather appended every item (resumed + fresh); the append strategy
    // operates over the full source-index-ordered record set that now
    // includes synthesized records for the restored indices.
    assert.equal(result.state.processed.length, 5);
    assert.deepEqual([...result.state.processed].sort((a, b) => a - b), [11, 22, 33, 44, 55]);
  });

  void it('resumed map gather is complete, source-ordered, and free of duplicates', async () => {
    // Fix-locking scenario. Each item's node writes state.produced = f(item).
    // A map gather collects `produced` from every clone into the parent
    // `results` array in source-index order. The scatter is interrupted
    // mid-run; on resume the parent `results` must contain a contribution
    // for EVERY item (restored + fresh), in source order, with no double-
    // append. This exercises the resume reconstruction of restored items'
    // produced values from persisted progress.
    const f = (item: number): number => item * 10 + 1;

    // --- Phase 1: run to interruption ---------------------------------------
    const interruptDispatcher = new Dagonizer<ScatterState>();
    let runCount = 0;
    const interruptingWorker: NodeInterface<ScatterState, 'success'> = {
      'name': 'producer',
      'outputs': ['success'],
      async execute(state) {
        const item = state.getMetadata<number>('item') ?? 0;
        const idx = ++runCount;
        if (idx === 3) {
          // Throw on the third executed item so the scatter aborts after
          // indices 0 and 1 have been persisted with their produced values.
          throw new Error('simulated mid-flight failure');
        }
        state.produced = f(item);
        return { 'output': 'success' };
      },
    };
    interruptDispatcher.registerNode(interruptingWorker);
    const mapDag = (dagName: string): DAG => ({
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${dagName}`,
      '@type':    'DAG',
      'name': dagName, 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': `urn:noocodex:dag:${dagName}/node/fan`, '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'producer' },
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'gather': { 'strategy': 'map', 'mapping': { 'produced': 'results' } },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    });
    interruptDispatcher.registerDAG(mapDag('scatter-map-interrupt'));

    const interruptState = new ScatterState();
    interruptState.items = [2, 4, 6, 8, 10];
    const partial = await interruptDispatcher.execute('scatter-map-interrupt', interruptState);

    // Scatter aborted on the third item; cursor stays on 'fan', and the
    // first two indices are persisted with their produced values.
    assert.equal(partial.cursor, 'fan');
    const persisted = partial.state.getMetadata<Record<string, ScatterProgress>>(SCATTER_PROGRESS_KEY);
    assert.ok(persisted !== undefined, 'expected progress after interruption');
    const persistedEntry = persisted['fan'];
    assert.ok(persistedEntry !== undefined);
    assert.deepEqual([...persistedEntry.completedIndices].sort((a, b) => a - b), [0, 1]);
    // The persisted itemResults carry the per-clone mapping values so the
    // resume can reconstruct the gather contribution.
    for (const r of persistedEntry.itemResults) {
      assert.ok(r.mappingValues !== undefined, 'expected mappingValues persisted for map gather');
      assert.equal(r.mappingValues['produced'], f(interruptState.items[r.index] as number));
    }
    // The parent results array must NOT carry the prior-run produced values
    // yet; gather only runs once the loop drains, so the array stays empty
    // across the interruption and the resume gather is a single, complete append.
    assert.deepEqual(partial.state.results, []);

    // --- Phase 2: round-trip through snapshot, then resume ------------------
    const snap = partial.state.snapshot();
    const restored = ScatterState.restore(snap);
    assert.deepEqual(restored.results, []);

    const resumeDispatcher = new Dagonizer<ScatterState>();
    let resumeRunCount = 0;
    const resumeWorker: NodeInterface<ScatterState, 'success'> = {
      'name': 'producer',
      'outputs': ['success'],
      async execute(state) {
        resumeRunCount++;
        const item = state.getMetadata<number>('item') ?? 0;
        state.produced = f(item);
        return { 'output': 'success' };
      },
    };
    resumeDispatcher.registerNode(resumeWorker);
    resumeDispatcher.registerDAG(mapDag('scatter-map-interrupt'));

    const result = await resumeDispatcher.resume('scatter-map-interrupt', restored, 'fan');

    // Only the three uncompleted items (indices 2, 3, 4) ran on resume.
    assert.equal(resumeRunCount, 3, `expected 3 fresh runs on resume, got ${resumeRunCount}`);
    assert.equal(result.cursor, null);

    // The parent `results` array is COMPLETE: one entry per item, in
    // SOURCE ORDER, with NO duplicates.
    const expected = interruptState.items.map(f);
    assert.equal(result.state.results.length, interruptState.items.length,
      `expected ${interruptState.items.length} results, got ${result.state.results.length}`);
    assert.deepEqual(result.state.results, expected,
      'results must be complete and in source order with no duplicates');

    // Progress cleared after clean completion.
    const stored = result.state.getMetadata<Record<string, unknown>>(SCATTER_PROGRESS_KEY);
    assert.equal(stored, undefined);
  });

  void it('two distinct scatters in one flow keep independent progress entries', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    let aCalls = 0;
    let bCalls = 0;
    const workerA: NodeInterface<ScatterState, 'success'> = {
      'name': 'workerA',
      'outputs': ['success'],
      async execute() {
        aCalls++;
        return { 'output': 'success' };
      },
    };
    const workerB: NodeInterface<ScatterState, 'success'> = {
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
      '@id':      'urn:noocodex:dag:scatter-twin',
      '@type':    'DAG',
      'name': 'scatter-twin', 'version': '1', 'entrypoint': 'fanA',
      'nodes': [
        { '@id': 'urn:noocodex:dag:scatter-twin/node/fanA', '@type': 'ScatterNode',
          'name': 'fanA', 'body': { 'node': 'workerA' },
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'gather': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': 'fanB', 'partial': 'fanB', 'all-error': 'fanB', 'empty': 'fanB' } },
        { '@id': 'urn:noocodex:dag:scatter-twin/node/fanB', '@type': 'ScatterNode',
          'name': 'fanB', 'body': { 'node': 'workerB' },
          'source': 'items2', 'itemKey': 'item', 'concurrency': 1,
          'gather': { 'strategy': 'append', 'target': 'processed2' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    // Pre-seed progress for BOTH scatters simultaneously, each having
    // completed different indices in different sources.
    const state = new ScatterState();
    state.items = [100, 200, 300];
    state.items2 = [1, 2, 3, 4];
    state.setMetadata(SCATTER_PROGRESS_KEY, {
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

    const result = await dispatcher.resume('scatter-twin', state, 'fanA');

    // fanA had 1 completed of 3 → 2 fresh calls.
    assert.equal(aCalls, 2, `expected 2 workerA calls, got ${aCalls}`);
    // fanB had 2 completed of 4 → 2 fresh calls.
    assert.equal(bCalls, 2, `expected 2 workerB calls, got ${bCalls}`);
    assert.equal(result.cursor, null);
    // Both placement entries cleared after their respective scatters complete.
    const stored = result.state.getMetadata<Record<string, unknown>>(SCATTER_PROGRESS_KEY);
    assert.equal(stored, undefined);
    // Aggregate outputs include every item (prior + fresh).
    assert.equal(result.state.processed.length, 3);
    assert.equal(result.state.processed2.length, 4);
  });

  void it('treats indices verbatim when the source array changes between checkpoint and resume', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    let calls = 0;
    const observedItems: number[] = [];
    const worker: NodeInterface<ScatterState, 'success'> = {
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
      '@id':      'urn:noocodex:dag:scatter-strict-index',
      '@type':    'DAG',
      'name': 'scatter-strict-index', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:scatter-strict-index/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'worker' },
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'gather': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    // Pre-existing progress claims indices 0 and 1 are done. Then the
    // consumer rewrites the source array (re-slicing, reordering) before
    // calling resume. The scatter trusts the persisted indices; it
    // skips positions 0 and 1 of the NEW array.
    const state = new ScatterState();
    state.items = [10, 20, 30, 40, 50];
    state.setMetadata(SCATTER_PROGRESS_KEY, {
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

    const result = await dispatcher.resume('scatter-strict-index', state, 'fan');

    // 3 fresh executions for the items at positions 2..4 of the NEW
    // array (strict index semantics): items 777, 666, 555.
    assert.equal(calls, 3);
    assert.deepEqual(observedItems.sort((a, b) => a - b), [555, 666, 777]);
    assert.equal(result.cursor, null);
    // Aggregate also picks up the prior items as recorded (the items at
    // indices 0 and 1 of the rewritten array, since strict semantics
    // reads back through the current source).
    assert.equal(result.state.processed.length, 5);
    assert.deepEqual([...result.state.processed].sort((a, b) => a - b), [555, 666, 777, 888, 999]);
  });

  void it('per-batch write cadence: one progress update per batch, not per item', async () => {
    // Snapshot the progress entry after every batch boundary; verify
    // the snapshot count equals the number of batches (not items).
    const dispatcher = new Dagonizer<ScatterState>();
    let setMetadataCalls = 0;
    let progressUpdates = 0;
    const state = new ScatterState();
    state.items = [1, 2, 3, 4, 5, 6];

    // Wrap setMetadata to count progress-key writes specifically.
    const originalSet = state.setMetadata.bind(state);
    state.setMetadata = (key: string, value: unknown): void => {
      setMetadataCalls++;
      if (key === SCATTER_PROGRESS_KEY) progressUpdates++;
      originalSet(key, value);
    };

    const worker: NodeInterface<ScatterState, 'success'> = {
      'name': 'worker',
      'outputs': ['success'],
      async execute() {
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:scatter-batched',
      '@type':    'DAG',
      'name': 'scatter-batched', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:scatter-batched/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'worker' },
          'source': 'items', 'itemKey': 'item', 'concurrency': 3,
          'gather': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    await dispatcher.execute('scatter-batched', state);

    // 6 items / concurrency 3 = 2 batches → exactly 2 progress writes.
    assert.equal(progressUpdates, 2, `expected 2 batch writes, got ${progressUpdates}`);
    // sanity: setMetadata also fires for itemKey + itemIndex per item
    // on each cloned itemState, not on the parent state; so those do
    // not contribute to setMetadataCalls on the parent.
    assert.ok(setMetadataCalls >= 2);
  });
});

void describe('Dagonizer scatter checkpoint round-trip', () => {
  void it('survives snapshot/restore through Checkpoint and resumes correctly', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    let calls = 0;
    const worker: NodeInterface<ScatterState, 'success'> = {
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
      '@id':      'urn:noocodex:dag:scatter-ckpt',
      '@type':    'DAG',
      'name': 'scatter-ckpt', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:scatter-ckpt/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'worker' },
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'gather': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': 'tail', 'partial': 'tail', 'all-error': 'tail', 'empty': 'tail' } },
        { '@id': 'urn:noocodex:dag:scatter-ckpt/node/tail', '@type': 'SingleNode',
          'name': 'tail', 'node': 'worker', 'outputs': { 'success': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    // Build a state with pre-existing progress as if it had been
    // captured. Round-trip through Checkpoint codec.
    const state = new ScatterState();
    state.items = [7, 14, 21, 28];
    state.setMetadata(SCATTER_PROGRESS_KEY, {
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
    const restored = ScatterState.restore(snap);
    const storedRestored = restored.getMetadata<Record<string, ScatterProgress>>(SCATTER_PROGRESS_KEY);
    assert.ok(storedRestored !== undefined);
    assert.deepEqual(storedRestored['fan']?.completedIndices, [0, 1]);

    const result = await dispatcher.resume('scatter-ckpt', restored, 'fan');
    // fan ran 2 fresh items + tail node = 3 calls.
    assert.equal(calls, 3);
    assert.equal(result.cursor, null);
    assert.equal(result.state.processed.length, 4);
  });

  void it('end-to-end Checkpoint capture/load round-trip preserves progress', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    const worker: NodeInterface<ScatterState, 'success'> = {
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
      '@id':      'urn:noocodex:dag:scatter-e2e',
      '@type':    'DAG',
      'name': 'scatter-e2e', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        { '@id': 'urn:noocodex:dag:scatter-e2e/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'worker' },
          'source': 'items', 'itemKey': 'item', 'concurrency': 1,
          'gather': { 'strategy': 'append', 'target': 'processed' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new ScatterState();
    state.items = [1, 2, 3, 4];
    // Pre-seed one completed index so the partial-result path is
    // exercised even though the scatter aborts before any natural item
    // completion.
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      'fan': {
        'placementName': 'fan',
        'completedIndices': [0],
        'itemResults': [{ 'index': 0, 'output': 'success' }],
      },
    });

    const ctl = new AbortController();
    setTimeout(() => ctl.abort(new Error('pause')), 5);
    const exec = dispatcher.execute('scatter-e2e', state, { 'signal': ctl.signal });
    const partial = await exec;

    // The scatter itself aborted; cursor still on 'fan'.
    assert.equal(partial.cursor, 'fan');
    const ckpt = await Checkpoint.capture('scatter-e2e', partial);
    const round = ckpt.toJson();
    const parsed = JSON.parse(round) as unknown;
    const ckpt2 = Checkpoint.load(parsed);
    const { 'state': rehydrated, cursor, dagName } = ckpt2.restoreState((snap) => ScatterState.restore(snap));
    assert.equal(cursor, 'fan');

    const stored = rehydrated.getMetadata<Record<string, ScatterProgress>>(SCATTER_PROGRESS_KEY);
    assert.ok(stored !== undefined, 'progress key should survive checkpoint codec');
    assert.deepEqual(stored['fan']?.completedIndices, [0]);

    // Sanity: dagName/state types route through the resume path. We
    // do not drive the resume to completion here because the worker
    // would block on a 1s timer.
    assert.equal(dagName, 'scatter-e2e');
  });
});
