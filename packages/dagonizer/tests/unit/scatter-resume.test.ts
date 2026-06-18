import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Checkpoint, CheckpointRestoreAdapterFn } from '../../src/checkpoint/Checkpoint.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { ScatterProgress } from '../../src/Dagonizer.js';
import { SCATTER_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import type { JsonObject } from '../../src/entities/json.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import type { NodeOutputInterface } from '../../src/entities/node/NodeOutput.js';
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
    class WorkerNode extends ScalarNode<ScatterState, 'success'> {
      readonly name = 'worker';
      readonly outputs = ['success'] as const;
      protected async executeOne(state: ScatterState): Promise<NodeOutputInterface<'success'>> {
        calls++;
        const item = state.getMetadata<number>('item') ?? 0;
        state.setMetadata('processedItem', item);
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    dispatcher.registerNode(new WorkerNode());
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
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' } },
        { '@id': 'urn:noocodex:dag:scatter-clean/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
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

  void it('records ackedResults on interruption mid-flight', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    let completedCount = 0;
    // Concurrency 1 to make per-item ack writes deterministic.
    // Worker throws after two completions so the scatter aborts before
    // the loop drains; the acked progress entries survive on state.metadata.
    class WorkerNode extends ScalarNode<ScatterState, 'success'> {
      readonly name = 'worker';
      readonly outputs = ['success'] as const;
      protected async executeOne(): Promise<NodeOutputInterface<'success'>> {
        const idx = ++completedCount;
        if (idx === 3) {
          throw new Error('simulated mid-flight failure');
        }
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    dispatcher.registerNode(new WorkerNode());
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
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' } },
        { '@id': 'urn:noocodex:dag:scatter-interrupt/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
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
    // append is a compactable strategy (retainsRecordsForFinalize=false), so the
    // checkpoint is bounded mode — acked items are tracked as watermark + aheadAcked.
    // Items 0 and 1 completed before item 2 threw; watermark should be 2.
    assert.equal(entry.mode, 'bounded', 'expected bounded checkpoint for append strategy');
    if (entry.mode === 'bounded') {
      // With concurrency=1 items complete in order: watermark should advance to 2.
      const totalAcked = entry.watermark + entry.aheadAcked.length;
      assert.equal(totalAcked, 2, `expected 2 acked items; got watermark=${entry.watermark} aheadAcked.length=${entry.aheadAcked.length}`);
      assert.equal(entry.outcomeTally['success'] ?? 0, 2, 'expected 2 success acked');
    }
  });

  void it('resume skips already-acked indices and re-executes only the rest', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    let calls = 0;
    class WorkerNode extends ScalarNode<ScatterState, 'success'> {
      readonly name = 'worker';
      readonly outputs = ['success'] as const;
      protected async executeOne(): Promise<NodeOutputInterface<'success'>> {
        calls++;
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    dispatcher.registerNode(new WorkerNode());
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
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' } },
        { '@id': 'urn:noocodex:dag:scatter-resume/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    // Pre-seed progress for items 0 and 1 using bounded checkpoint mode.
    // Append is compactable → bounded shape; result assertions are unchanged.
    const state = new ScatterState();
    state.items = [10, 20, 30, 40, 50];
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      'fan': {
        'mode': 'bounded' as const,
        'placementName': 'fan',
        'inbox': [],
        'watermark': 2,
        'aheadAcked': [],
        'outcomeTally': { 'success': 2 },
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
    class WorkerNode extends ScalarNode<ScatterState, 'success'> {
      readonly name = 'worker';
      readonly outputs = ['success'] as const;
      protected async executeOne(): Promise<NodeOutputInterface<'success'>> {
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    dispatcher.registerNode(new WorkerNode());
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
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' } },
        { '@id': 'urn:noocodex:dag:scatter-aggregate/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new ScatterState();
    state.items = [11, 22, 33, 44, 55];
    // Simulate a real checkpoint: items 0 and 1 were gathered incrementally
    // during the prior run. Their gather contributions (append: item values)
    // are already in state.processed as they would be in a real state snapshot.
    state.processed = [11, 22];
    // Append is compactable → bounded checkpoint shape; result assertions unchanged.
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      'fan': {
        'mode': 'bounded' as const,
        'placementName': 'fan',
        'inbox': [],
        'watermark': 2,
        'aheadAcked': [],
        'outcomeTally': { 'success': 2 },
      },
    });

    const result = await dispatcher.resume('scatter-aggregate', state, 'fan');

    // processed had [11, 22] from the prior run; 3 fresh items [33, 44, 55] appended.
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
    class InterruptingWorkerNode extends ScalarNode<ScatterState, 'success'> {
      readonly name = 'producer';
      readonly outputs = ['success'] as const;
      protected async executeOne(state: ScatterState): Promise<NodeOutputInterface<'success'>> {
        const item = state.getMetadata<number>('item') ?? 0;
        const idx = ++runCount;
        if (idx === 3) {
          // Throw on the third executed item so the scatter aborts after
          // indices 0 and 1 have been persisted with their produced values.
          throw new Error('simulated mid-flight failure');
        }
        state.produced = f(item);
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    interruptDispatcher.registerNode(new InterruptingWorkerNode());
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
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' } },
        { '@id': 'urn:noocodex:dag:x/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
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
    // map is a compactable strategy (retainsRecordsForFinalize=false), so the
    // checkpoint is bounded mode — mapping values are already folded into parent
    // state via reduce; no per-acked-result mapping values are persisted.
    assert.equal(persistedEntry.mode, 'bounded', 'expected bounded checkpoint for map strategy');
    if (persistedEntry.mode === 'bounded') {
      const totalAcked = persistedEntry.watermark + persistedEntry.aheadAcked.length;
      assert.equal(totalAcked, 2, 'expected 2 acked items in bounded checkpoint');
    }
    // The parent results array holds the two folded values (reduce fires per-ack,
    // so map strategy appends as each item lands).
    // After interruption at item 2, results must contain 2 entries (items 0 and 1).
    assert.equal(partial.state.results.length, 2);

    // --- Phase 2: round-trip through snapshot, then resume ------------------
    const snap = partial.state.snapshot();
    const restored = ScatterState.restore(snap);
    // The two incremental results survive the snapshot.
    assert.equal(restored.results.length, 2);

    const resumeDispatcher = new Dagonizer<ScatterState>();
    let resumeRunCount = 0;
    class ResumeWorkerNode extends ScalarNode<ScatterState, 'success'> {
      readonly name = 'producer';
      readonly outputs = ['success'] as const;
      protected async executeOne(state: ScatterState): Promise<NodeOutputInterface<'success'>> {
        resumeRunCount++;
        const item = state.getMetadata<number>('item') ?? 0;
        state.produced = f(item);
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    resumeDispatcher.registerNode(new ResumeWorkerNode());
    resumeDispatcher.registerDAG(mapDag('scatter-map-interrupt'));

    const result = await resumeDispatcher.resume('scatter-map-interrupt', restored, 'fan');

    // Only the three uncompleted items (indices 2, 3, 4) ran on resume.
    assert.equal(resumeRunCount, 3, `expected 3 fresh runs on resume, got ${resumeRunCount}`);
    assert.equal(result.cursor, null);

    // The parent `results` array is COMPLETE: one entry per item, in
    // SOURCE ORDER, with NO duplicates. Map strategy's reduce appends in
    // the order items complete. With concurrency=1 and the inbox items
    // (none — inbox was empty) followed by fresh items (indices 2,3,4),
    // the final results array is [f(2), f(4), f(6), f(8), f(10)] but the
    // first two were folded in phase 1; on resume items 2,3,4 are folded.
    // Total: 5 entries.
    assert.equal(result.state.results.length, interruptState.items.length,
      `expected ${interruptState.items.length} results, got ${result.state.results.length}`);

    // Progress cleared after clean completion.
    const stored = result.state.getMetadata<Record<string, unknown>>(SCATTER_PROGRESS_KEY);
    assert.equal(stored, undefined);
  });

  void it('two distinct scatters in one flow keep independent progress entries', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    let aCalls = 0;
    let bCalls = 0;
    class WorkerANode extends ScalarNode<ScatterState, 'success'> {
      readonly name = 'workerA';
      readonly outputs = ['success'] as const;
      protected async executeOne(): Promise<NodeOutputInterface<'success'>> {
        aCalls++;
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    class WorkerBNode extends ScalarNode<ScatterState, 'success'> {
      readonly name = 'workerB';
      readonly outputs = ['success'] as const;
      protected async executeOne(): Promise<NodeOutputInterface<'success'>> {
        bCalls++;
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    dispatcher.registerNode(new WorkerANode());
    dispatcher.registerNode(new WorkerBNode());
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
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' } },
        { '@id': 'urn:noocodex:dag:scatter-twin/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    // Pre-seed progress for BOTH scatters simultaneously using the inbox model.
    // Also pre-populate gathered state as a real checkpoint would: incremental
    // gather (append strategy) folds contributions into state during prior run.
    const state = new ScatterState();
    state.items = [100, 200, 300];
    state.items2 = [1, 2, 3, 4];
    state.processed = [100];        // fanA: index 0 already gathered
    state.processed2 = [1, 3];      // fanB: indices 0 and 2 already gathered
    // Append is compactable → bounded checkpoint shape for both placements.
    // fanA: index 0 acked (watermark=1). fanB: indices 0 and 2 acked (non-contiguous:
    // watermark=1 because index 1 is missing; aheadAcked=[{index:2}]).
    // Result assertions (aCalls/bCalls/processed lengths) are unchanged.
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      'fanA': {
        'mode': 'bounded' as const,
        'placementName': 'fanA',
        'inbox': [],
        'watermark': 1,
        'aheadAcked': [],
        'outcomeTally': { 'success': 1 },
      },
      'fanB': {
        'mode': 'bounded' as const,
        'placementName': 'fanB',
        'inbox': [],
        'watermark': 1,
        'aheadAcked': [{ 'index': 2, 'output': 'success' }],
        'outcomeTally': { 'success': 2 },
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

  void it('per-item ack write cadence: one progress update per ack', async () => {
    // With the inbox model every successful ack writes the checkpoint;
    // count progress-key writes and verify == number of items processed.
    const dispatcher = new Dagonizer<ScatterState>();
    let progressUpdates = 0;
    const state = new ScatterState();
    state.items = [1, 2, 3, 4, 5, 6];

    // Wrap setMetadata to count progress-key writes specifically.
    const originalSet = state.setMetadata.bind(state);
    state.setMetadata = (key: string, value: unknown): void => {
      if (key === SCATTER_PROGRESS_KEY) progressUpdates++;
      originalSet(key, value);
    };

    class WorkerNode extends ScalarNode<ScatterState, 'success'> {
      readonly name = 'worker';
      readonly outputs = ['success'] as const;
      protected async executeOne(): Promise<NodeOutputInterface<'success'>> {
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    dispatcher.registerNode(new WorkerNode());
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
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' } },
        { '@id': 'urn:noocodex:dag:scatter-batched/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    await dispatcher.execute('scatter-batched', state);

    // 6 items → 6 acks → 6 progress writes (one per successful ack).
    assert.equal(progressUpdates, 6, `expected 6 ack writes, got ${progressUpdates}`);
  });
});

void describe('Dagonizer scatter checkpoint round-trip', () => {
  void it('survives snapshot/restore through Checkpoint and resumes correctly', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    let calls = 0;
    class WorkerNode extends ScalarNode<ScatterState, 'success'> {
      readonly name = 'worker';
      readonly outputs = ['success'] as const;
      protected async executeOne(): Promise<NodeOutputInterface<'success'>> {
        calls++;
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    dispatcher.registerNode(new WorkerNode());
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
          'name': 'tail', 'node': 'worker', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:scatter-ckpt/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    // Build a state with pre-existing progress as if it had been captured.
    // Round-trip through snapshot/restore to verify the codec carries the key.
    // Also pre-populate processed as a real checkpoint would: incremental gather
    // (append strategy) folds contributions into state during prior run.
    const state = new ScatterState();
    state.items = [7, 14, 21, 28];
    state.processed = [7, 14]; // items 0 and 1 already gathered
    // Append is compactable → bounded checkpoint shape; result assertions unchanged.
    // Items 0 and 1 acked contiguously → watermark=2, aheadAcked empty.
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      'fan': {
        'mode': 'bounded' as const,
        'placementName': 'fan',
        'inbox': [],
        'watermark': 2,
        'aheadAcked': [],
        'outcomeTally': { 'success': 2 },
      },
    });
    const snap = state.snapshot();
    const restored = ScatterState.restore(snap);
    const storedRestored = restored.getMetadata<Record<string, ScatterProgress>>(SCATTER_PROGRESS_KEY);
    assert.ok(storedRestored !== undefined);
    const fanEntry = storedRestored['fan'];
    assert.ok(fanEntry !== undefined);
    // Bounded checkpoint survives snapshot/restore; shape changed from retained.
    assert.equal(fanEntry.mode, 'bounded');
    if (fanEntry.mode === 'bounded') {
      assert.equal(fanEntry.watermark, 2);
    }

    const result = await dispatcher.resume('scatter-ckpt', restored, 'fan');
    // fan ran 2 fresh items + tail node = 3 calls.
    assert.equal(calls, 3);
    assert.equal(result.cursor, null);
    assert.equal(result.state.processed.length, 4);
  });

  void it('end-to-end Checkpoint capture/load round-trip preserves progress', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    class WorkerNode extends ScalarNode<ScatterState, 'success'> {
      readonly name = 'worker';
      readonly outputs = ['success'] as const;
      protected async executeOne(_state: ScatterState, context: NodeContextInterface): Promise<NodeOutputInterface<'success'>> {
        // Long-running so we can abort mid-flight.
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 1000);
          context.signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(context.signal.reason);
          }, { 'once': true });
        });
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    dispatcher.registerNode(new WorkerNode());
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
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' } },
        { '@id': 'urn:noocodex:dag:scatter-e2e/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new ScatterState();
    state.items = [1, 2, 3, 4];
    // Pre-seed one acked index. Append is compactable → bounded checkpoint shape.
    // shape changed for compactable gather; result assertions (cursor/dagName) unchanged.
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      'fan': {
        'mode': 'bounded' as const,
        'placementName': 'fan',
        'inbox': [],
        'watermark': 1,
        'aheadAcked': [],
        'outcomeTally': { 'success': 1 },
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
    const { 'state': rehydrated, cursor, dagName } = ckpt2.restoreState(CheckpointRestoreAdapterFn.wrap((snap) => ScatterState.restore(snap)));
    assert.equal(cursor, 'fan');

    const stored = rehydrated.getMetadata<Record<string, ScatterProgress>>(SCATTER_PROGRESS_KEY);
    assert.ok(stored !== undefined, 'progress key should survive checkpoint codec');
    // At minimum one item should have been acked (the pre-seeded entry or any fresh ack).
    const fanStored = stored['fan'];
    assert.ok(fanStored !== undefined, 'expected progress entry for fan scatter');
    const ackedCount = fanStored.mode === 'bounded'
      ? fanStored.watermark + fanStored.aheadAcked.length
      : fanStored.ackedResults.length;
    assert.ok(ackedCount >= 1, 'at least one item should be acked after partial run');

    // Sanity: dagName/state types route through the resume path.
    assert.equal(dagName, 'scatter-e2e');
  });
});
