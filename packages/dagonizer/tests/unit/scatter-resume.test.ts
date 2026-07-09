import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Checkpoint, CheckpointRestoreAdapter } from '../../src/checkpoint/Checkpoint.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { StoredScatterProgressType } from '../../src/Dagonizer.js';
import { SCATTER_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import { DAG_CONTEXT, DAGIdentity } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';
import { TestNode } from '../_support/TestNode.js';

const placementIri = (dagIri: string, placementName: string): string => DAGIdentity.placementId(dagIri, placementName);

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

  protected override snapshotData(): JsonObjectType {
    return {
      'items':     [...this.items],
      'items2':    [...this.items2],
      'processed': [...this.processed],
      'processed2': [...this.processed2],
      'produced':  this.produced,
      'results':   [...this.results],
    };
  }

  protected override restoreData(snap: JsonObjectType): void {
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
    dispatcher.registerNode(TestNode.make<ScatterState>('urn:noocodec:node:worker', ['success'], (state) => {
      calls++;
      const item = state.getMetadata('item') ?? 0;
      state.setMetadata('processedItem', item);
      return 'success';
    }));
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:scatter-clean',
      '@type':    'DAG',
      'name': 'scatter-clean', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodec:dag:scatter-clean', 'fan') },
      'nodes': [
        { '@id': 'urn:noocodec:dag:scatter-clean/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'urn:noocodec:node:worker' },
          'source': 'items', 'itemKey': 'item',
          'outputs': {
            'all-success': placementIri('urn:noocodec:dag:scatter-clean', 'join'),
            'partial': placementIri('urn:noocodec:dag:scatter-clean', 'join'),
            'all-error': placementIri('urn:noocodec:dag:scatter-clean', 'join'),
            'empty': placementIri('urn:noocodec:dag:scatter-clean', 'end'),
          } },
        { '@id': 'urn:noocodec:dag:scatter-clean/node/join', '@type': 'GatherNode',
          'name': 'join', 'sources': { [placementIri('urn:noocodec:dag:scatter-clean', 'fan')]: {} }, 'gather': { 'strategy': 'append', 'target': 'processed' },
          'outputs': {
            'success': placementIri('urn:noocodec:dag:scatter-clean', 'end'),
            'error': placementIri('urn:noocodec:dag:scatter-clean', 'end'),
            'empty': placementIri('urn:noocodec:dag:scatter-clean', 'end'),
          } },
        { '@id': 'urn:noocodec:dag:scatter-clean/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new ScatterState();
    state.items = [10, 20, 30, 40, 50];
    const result = await dispatcher.execute('urn:noocodec:dag:scatter-clean', state);

    assert.equal(calls, 5);
    assert.equal(result.cursor, null);
    assert.deepEqual([...result.state.processed].sort((a, b) => a - b), [10, 20, 30, 40, 50]);

    // No scatter progress entry should remain after clean completion.
    const stored = result.state.getMetadata(SCATTER_PROGRESS_KEY);
    assert.equal(stored, undefined, 'progress key should be deleted after clean completion');
  });

  void it('records ackedResults on interruption mid-flight', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    let completedCount = 0;
    // Concurrency 1 to make per-item ack writes deterministic.
    // Worker throws after two completions so the scatter aborts before
    // the loop drains; the acked progress entries survive on state.metadata.
    dispatcher.registerNode(TestNode.make<ScatterState>('urn:noocodec:node:worker', ['success'], () => {
      const idx = ++completedCount;
      if (idx === 3) {
        throw new Error('simulated mid-flight failure');
      }
      return 'success';
    }));
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:scatter-interrupt',
      '@type':    'DAG',
      'name': 'scatter-interrupt', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodec:dag:scatter-interrupt', 'fan') },
      'nodes': [
        { '@id': 'urn:noocodec:dag:scatter-interrupt/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'urn:noocodec:node:worker' },
          'source': 'items', 'itemKey': 'item', 'execution': { 'mode': 'item', 'concurrency': 1 },
          'outputs': {
            'all-success': placementIri('urn:noocodec:dag:scatter-interrupt', 'end'),
            'partial': placementIri('urn:noocodec:dag:scatter-interrupt', 'end'),
            'all-error': placementIri('urn:noocodec:dag:scatter-interrupt', 'end'),
            'empty': placementIri('urn:noocodec:dag:scatter-interrupt', 'end'),
          } },
        { '@id': 'urn:noocodec:dag:scatter-interrupt/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new ScatterState();
    state.items = [1, 2, 3, 4, 5];
    const result = await dispatcher.execute('urn:noocodec:dag:scatter-interrupt', state);

    // Scatter threw; cursor stays on 'fan'.
    assert.equal(result.cursor, placementIri('urn:noocodec:dag:scatter-interrupt', 'fan'));

    const storedRaw = result.state.getMetadata(SCATTER_PROGRESS_KEY);
    assert.ok(storedRaw !== undefined, 'expected progress entry after interruption');
    const stored: StoredScatterProgressType = Validator.storedScatterProgress.validate(storedRaw);
    const entry = stored[placementIri('urn:noocodec:dag:scatter-interrupt', 'fan')];
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
    dispatcher.registerNode(TestNode.make<ScatterState>('urn:noocodec:node:worker', ['success'], () => {
      calls++;
      return 'success';
    }));
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:scatter-resume',
      '@type':    'DAG',
      'name': 'scatter-resume', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodec:dag:scatter-resume', 'fan') },
      'nodes': [
        { '@id': 'urn:noocodec:dag:scatter-resume/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'urn:noocodec:node:worker' },
          'source': 'items', 'itemKey': 'item', 'execution': { 'mode': 'item', 'concurrency': 1 },
          'outputs': {
            'all-success': placementIri('urn:noocodec:dag:scatter-resume', 'end'),
            'partial': placementIri('urn:noocodec:dag:scatter-resume', 'end'),
            'all-error': placementIri('urn:noocodec:dag:scatter-resume', 'end'),
            'empty': placementIri('urn:noocodec:dag:scatter-resume', 'end'),
          } },
        { '@id': 'urn:noocodec:dag:scatter-resume/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    // Pre-seed progress for items 0 and 1 using bounded checkpoint mode.
    // Append is compactable → bounded shape; result assertions are unchanged.
    const state = new ScatterState();
    state.items = [10, 20, 30, 40, 50];
    const fanIri = placementIri('urn:noocodec:dag:scatter-resume', 'fan');
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      [fanIri]: {
        'mode': 'bounded' as const,
        'placementName': fanIri,
        'inbox': [],
        'watermark': 2,
        'aheadAcked': [],
        'outcomeTally': { 'success': 2 },
      },
    });

    const result = await dispatcher.resume('urn:noocodec:dag:scatter-resume', state, fanIri);

    // Worker called only for items 2, 3, 4: three new executions.
    assert.equal(calls, 3, `expected 3 fresh worker calls, got ${calls}`);
    assert.equal(result.cursor, null);
    // Progress entry cleared on clean completion.
    const stored = result.state.getMetadata(SCATTER_PROGRESS_KEY);
    assert.equal(stored, undefined);
  });

  void it('resumed aggregate output reflects every item including prior-run ones', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    dispatcher.registerNode(TestNode.make<ScatterState>('urn:noocodec:node:worker', ['success']));
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:scatter-aggregate',
      '@type':    'DAG',
      'name': 'scatter-aggregate', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodec:dag:scatter-aggregate', 'fan') },
      'nodes': [
        { '@id': 'urn:noocodec:dag:scatter-aggregate/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'urn:noocodec:node:worker' },
          'source': 'items', 'itemKey': 'item', 'execution': { 'mode': 'item', 'concurrency': 1 },
          'outputs': {
            'all-success': placementIri('urn:noocodec:dag:scatter-aggregate', 'join'),
            'partial': placementIri('urn:noocodec:dag:scatter-aggregate', 'join'),
            'all-error': placementIri('urn:noocodec:dag:scatter-aggregate', 'join'),
            'empty': placementIri('urn:noocodec:dag:scatter-aggregate', 'end'),
          } },
        { '@id': 'urn:noocodec:dag:scatter-aggregate/node/join', '@type': 'GatherNode',
          'name': 'join', 'sources': { [placementIri('urn:noocodec:dag:scatter-aggregate', 'fan')]: {} }, 'gather': { 'strategy': 'append', 'target': 'processed' },
          'outputs': {
            'success': placementIri('urn:noocodec:dag:scatter-aggregate', 'end'),
            'error': placementIri('urn:noocodec:dag:scatter-aggregate', 'end'),
            'empty': placementIri('urn:noocodec:dag:scatter-aggregate', 'end'),
          } },
        { '@id': 'urn:noocodec:dag:scatter-aggregate/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new ScatterState();
    state.items = [11, 22, 33, 44, 55];
    const fanIri = placementIri('urn:noocodec:dag:scatter-aggregate', 'fan');
    // Simulate a real checkpoint: items 0 and 1 were gathered incrementally
    // during the prior run. Their gather contributions (append: item values)
    // are already in state.processed as they would be in a real state snapshot.
    state.processed = [11, 22];
    // Append is compactable → bounded checkpoint shape; result assertions unchanged.
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      [fanIri]: {
        'mode': 'bounded' as const,
        'placementName': fanIri,
        'inbox': [],
        'watermark': 2,
        'aheadAcked': [],
        'outcomeTally': { 'success': 2 },
      },
    });

    const result = await dispatcher.resume('urn:noocodec:dag:scatter-aggregate', state, fanIri);

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
    interruptDispatcher.registerNode(TestNode.make<ScatterState>('urn:noocodec:node:producer', ['success'], (state) => {
      const item = state.getter.number('item');
      const idx = ++runCount;
      if (idx === 3) {
        // Throw on the third executed item so the scatter aborts after
        // indices 0 and 1 have been persisted with their produced values.
        throw new Error('simulated mid-flight failure');
      }
      state.produced = f(item);
      return 'success';
    }));
    const mapDag = (dagName: string): DAGType => {
      const dagIri = `urn:noocodec:dag:${dagName}`;
      const fanIri = placementIri(dagIri, 'fan');
      const joinIri = placementIri(dagIri, 'join');
      const endIri = placementIri(dagIri, 'end');
      return {
        '@context': DAG_CONTEXT,
        '@id':      dagIri,
        '@type':    'DAG',
        'name': dagName, 'version': '1', 'entrypoints': { 'main': fanIri },
        'nodes': [
          { '@id': fanIri, '@type': 'ScatterNode',
            'name': 'fan', 'body': { 'node': 'urn:noocodec:node:producer' },
            'source': 'items', 'itemKey': 'item', 'execution': { 'mode': 'item', 'concurrency': 1 },
            'outputs': {
              'all-success': joinIri,
              'partial': joinIri,
              'all-error': joinIri,
              'empty': endIri,
            } },
          { '@id': joinIri, '@type': 'GatherNode',
            'name': 'join', 'sources': { [fanIri]: {} }, 'gather': { 'strategy': 'map', 'mapping': { 'produced': 'results' } },
            'outputs': {
              'success': endIri,
              'error': endIri,
              'empty': endIri,
            } },
          { '@id': endIri, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
        ],
      };
    };
    interruptDispatcher.registerDAG(mapDag('scatter-map-interrupt'));

    const interruptState = new ScatterState();
    interruptState.items = [2, 4, 6, 8, 10];
    const partial = await interruptDispatcher.execute('urn:noocodec:dag:scatter-map-interrupt', interruptState);

    // Scatter aborted on the third item; cursor stays on 'fan', and the
    // first two indices are persisted with their produced values.
    assert.equal(partial.cursor, placementIri('urn:noocodec:dag:scatter-map-interrupt', 'fan'));
    const persistedRaw = partial.state.getMetadata(SCATTER_PROGRESS_KEY);
    assert.ok(persistedRaw !== undefined, 'expected progress after interruption');
    const persisted: StoredScatterProgressType = Validator.storedScatterProgress.validate(persistedRaw);
    const persistedEntry = persisted[placementIri('urn:noocodec:dag:scatter-map-interrupt', 'fan')];
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
    resumeDispatcher.registerNode(TestNode.make<ScatterState>('urn:noocodec:node:producer', ['success'], (state) => {
      resumeRunCount++;
      const item = state.getter.number('item');
      state.produced = f(item);
      return 'success';
    }));
    resumeDispatcher.registerDAG(mapDag('scatter-map-interrupt'));

    const result = await resumeDispatcher.resume('urn:noocodec:dag:scatter-map-interrupt', restored, placementIri('urn:noocodec:dag:scatter-map-interrupt', 'fan'));

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
    const stored = result.state.getMetadata(SCATTER_PROGRESS_KEY);
    assert.equal(stored, undefined);
  });

  void it('two distinct scatters in one flow keep independent progress entries', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    let aCalls = 0;
    let bCalls = 0;
    dispatcher.registerNode(TestNode.make<ScatterState>('urn:noocodec:node:workerA', ['success'], () => { aCalls++; return 'success'; }));
    dispatcher.registerNode(TestNode.make<ScatterState>('urn:noocodec:node:workerB', ['success'], () => { bCalls++; return 'success'; }));
    const fanAIri = placementIri('urn:noocodec:dag:scatter-twin', 'fanA');
    const fanBIri = placementIri('urn:noocodec:dag:scatter-twin', 'fanB');
    const fanAJoinIri = placementIri('urn:noocodec:dag:scatter-twin', 'fanA-join');
    const fanBJoinIri = placementIri('urn:noocodec:dag:scatter-twin', 'fanB-join');
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:scatter-twin',
      '@type':    'DAG',
      'name': 'scatter-twin', 'version': '1', 'entrypoints': { 'main': fanAIri },
      'nodes': [
        { '@id': fanAIri, '@type': 'ScatterNode',
          'name': 'fanA', 'body': { 'node': 'urn:noocodec:node:workerA' },
          'source': 'items', 'itemKey': 'item', 'execution': { 'mode': 'item', 'concurrency': 1 },
          'outputs': {
            'all-success': fanAJoinIri,
            'partial': fanAJoinIri,
            'all-error': fanAJoinIri,
            'empty': fanBIri,
          } },
        { '@id': fanAJoinIri, '@type': 'GatherNode',
          'name': 'fanA-join',
          'sources': { [fanAIri]: {} },
          'gather': { 'strategy': 'append', 'target': 'processed' },
          'outputs': {
            'success': fanBIri,
            'error': fanBIri,
            'empty': fanBIri,
          } },
        { '@id': fanBIri, '@type': 'ScatterNode',
          'name': 'fanB', 'body': { 'node': 'urn:noocodec:node:workerB' },
          'source': 'items2', 'itemKey': 'item', 'execution': { 'mode': 'item', 'concurrency': 1 },
          'outputs': {
            'all-success': fanBJoinIri,
            'partial': fanBJoinIri,
            'all-error': fanBJoinIri,
            'empty': placementIri('urn:noocodec:dag:scatter-twin', 'end'),
          } },
        { '@id': fanBJoinIri, '@type': 'GatherNode',
          'name': 'fanB-join',
          'sources': { [fanBIri]: {} },
          'gather': { 'strategy': 'append', 'target': 'processed2' },
          'outputs': {
            'success': placementIri('urn:noocodec:dag:scatter-twin', 'end'),
            'error': placementIri('urn:noocodec:dag:scatter-twin', 'end'),
            'empty': placementIri('urn:noocodec:dag:scatter-twin', 'end'),
          } },
        { '@id': 'urn:noocodec:dag:scatter-twin/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
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
      [fanAIri]: {
        'mode': 'bounded' as const,
        'placementName': fanAIri,
        'inbox': [],
        'watermark': 1,
        'aheadAcked': [],
        'outcomeTally': { 'success': 1 },
      },
      [fanBIri]: {
        'mode': 'bounded' as const,
        'placementName': fanBIri,
        'inbox': [],
        'watermark': 1,
        'aheadAcked': [{ 'index': 2, 'output': 'success' }],
        'outcomeTally': { 'success': 2 },
      },
    });

    const result = await dispatcher.resume('urn:noocodec:dag:scatter-twin', state, fanAIri);

    // fanA had 1 completed of 3 → 2 fresh calls.
    assert.equal(aCalls, 2, `expected 2 workerA calls, got ${aCalls}`);
    // fanB had 2 completed of 4 → 2 fresh calls.
    assert.equal(bCalls, 2, `expected 2 workerB calls, got ${bCalls}`);
    assert.equal(result.cursor, null);
    // Both placement entries cleared after their respective scatters complete.
    const stored = result.state.getMetadata(SCATTER_PROGRESS_KEY);
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

    dispatcher.registerNode(TestNode.make<ScatterState>('urn:noocodec:node:worker', ['success']));
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:scatter-batched',
      '@type':    'DAG',
      'name': 'scatter-batched', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodec:dag:scatter-batched', 'fan') },
      'nodes': [
        { '@id': 'urn:noocodec:dag:scatter-batched/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'urn:noocodec:node:worker' },
          'source': 'items', 'itemKey': 'item', 'execution': { 'mode': 'item', 'concurrency': 3 },
          'outputs': {
            'all-success': placementIri('urn:noocodec:dag:scatter-batched', 'end'),
            'partial': placementIri('urn:noocodec:dag:scatter-batched', 'end'),
            'all-error': placementIri('urn:noocodec:dag:scatter-batched', 'end'),
            'empty': placementIri('urn:noocodec:dag:scatter-batched', 'end'),
          } },
        { '@id': 'urn:noocodec:dag:scatter-batched/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    await dispatcher.execute('urn:noocodec:dag:scatter-batched', state);

    // 6 items → 6 acks → 6 progress writes (one per successful ack).
    assert.equal(progressUpdates, 6, `expected 6 ack writes, got ${progressUpdates}`);
  });
});

void describe('Dagonizer scatter checkpoint round-trip', () => {
  void it('survives snapshot/restore through Checkpoint and resumes correctly', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    let calls = 0;
    dispatcher.registerNode(TestNode.make<ScatterState>('urn:noocodec:node:worker', ['success'], () => {
      calls++;
      return 'success';
    }));
    const fanIri = placementIri('urn:noocodec:dag:scatter-ckpt', 'fan');
    const joinIri = placementIri('urn:noocodec:dag:scatter-ckpt', 'join');
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:scatter-ckpt',
      '@type':    'DAG',
      'name': 'scatter-ckpt', 'version': '1', 'entrypoints': { 'main': fanIri },
      'nodes': [
        { '@id': fanIri, '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'urn:noocodec:node:worker' },
          'source': 'items', 'itemKey': 'item', 'execution': { 'mode': 'item', 'concurrency': 1 },
          'outputs': {
            'all-success': joinIri,
            'partial': joinIri,
            'all-error': joinIri,
            'empty': placementIri('urn:noocodec:dag:scatter-ckpt', 'tail'),
          } },
        { '@id': joinIri, '@type': 'GatherNode',
          'name': 'join',
          'sources': { [fanIri]: {} },
          'gather': { 'strategy': 'append', 'target': 'processed' },
          'outputs': {
            'success': placementIri('urn:noocodec:dag:scatter-ckpt', 'tail'),
            'error': placementIri('urn:noocodec:dag:scatter-ckpt', 'tail'),
            'empty': placementIri('urn:noocodec:dag:scatter-ckpt', 'tail'),
          } },
        { '@id': 'urn:noocodec:dag:scatter-ckpt/node/tail', '@type': 'SingleNode',
          'name': 'tail', 'node': 'urn:noocodec:node:worker', 'outputs': { 'success': placementIri('urn:noocodec:dag:scatter-ckpt', 'end') } },
        { '@id': 'urn:noocodec:dag:scatter-ckpt/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
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
      [fanIri]: {
        'mode': 'bounded' as const,
        'placementName': fanIri,
        'inbox': [],
        'watermark': 2,
        'aheadAcked': [],
        'outcomeTally': { 'success': 2 },
      },
    });
    const snap = state.snapshot();
    const restored = ScatterState.restore(snap);
    const storedRestoredRaw = restored.getMetadata(SCATTER_PROGRESS_KEY);
    assert.ok(storedRestoredRaw !== undefined);
    const storedRestored: StoredScatterProgressType = Validator.storedScatterProgress.validate(storedRestoredRaw);
    const fanEntry = storedRestored[fanIri];
    assert.ok(fanEntry !== undefined);
    // Bounded checkpoint survives snapshot/restore; shape changed from retained.
    assert.equal(fanEntry.mode, 'bounded');
    if (fanEntry.mode === 'bounded') {
      assert.equal(fanEntry.watermark, 2);
    }

    const result = await dispatcher.resume('urn:noocodec:dag:scatter-ckpt', restored, fanIri);
    // fan ran 2 fresh items + tail node = 3 calls.
    assert.equal(calls, 3);
    assert.equal(result.cursor, null);
    assert.equal(result.state.processed.length, 4);
  });

  void it('end-to-end Checkpoint capture/load round-trip preserves progress', async () => {
    const dispatcher = new Dagonizer<ScatterState>();
    dispatcher.registerNode(TestNode.make<ScatterState>('urn:noocodec:node:worker', ['success'], async (_state, context) => {
      // Long-running so we can abort mid-flight.
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 1000);
        context.signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(context.signal.reason);
        }, { 'once': true });
      });
      return 'success';
    }));
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:scatter-e2e',
      '@type':    'DAG',
      'name': 'scatter-e2e', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodec:dag:scatter-e2e', 'fan') },
      'nodes': [
        { '@id': 'urn:noocodec:dag:scatter-e2e/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'body': { 'node': 'urn:noocodec:node:worker' },
          'source': 'items', 'itemKey': 'item', 'execution': { 'mode': 'item', 'concurrency': 1 },
          'outputs': {
            'all-success': placementIri('urn:noocodec:dag:scatter-e2e', 'end'),
            'partial': placementIri('urn:noocodec:dag:scatter-e2e', 'end'),
            'all-error': placementIri('urn:noocodec:dag:scatter-e2e', 'end'),
            'empty': placementIri('urn:noocodec:dag:scatter-e2e', 'end'),
          } },
        { '@id': 'urn:noocodec:dag:scatter-e2e/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new ScatterState();
    state.items = [1, 2, 3, 4];
    const fanIri = placementIri('urn:noocodec:dag:scatter-e2e', 'fan');
    // Pre-seed one acked index. Append is compactable → bounded checkpoint shape.
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      [fanIri]: {
        'mode': 'bounded' as const,
        'placementName': fanIri,
        'inbox': [],
        'watermark': 1,
        'aheadAcked': [],
        'outcomeTally': { 'success': 1 },
      },
    });

    const ctl = new AbortController();
    setTimeout(() => ctl.abort(new Error('pause')), 5);
    const exec = dispatcher.execute('urn:noocodec:dag:scatter-e2e', state, { 'signal': ctl.signal });
    const partial = await exec;

    // The scatter itself aborted; cursor still on 'fan'.
    assert.equal(partial.cursor, fanIri);
    const ckpt = await Checkpoint.capture('urn:noocodec:dag:scatter-e2e', partial);
    const round = ckpt.toJson();
    const parsed: unknown = JSON.parse(round);
    const ckpt2 = Checkpoint.load(parsed);
    const { 'state': rehydrated, cursor, dagName } = ckpt2.restoreState(CheckpointRestoreAdapter.wrap((snap) => ScatterState.restore(snap)));
    assert.equal(cursor, fanIri);

    const storedRaw2 = rehydrated.getMetadata(SCATTER_PROGRESS_KEY);
    assert.ok(storedRaw2 !== undefined, 'progress key should survive checkpoint codec');
    // At minimum one item should have been acked (the pre-seeded entry or any fresh ack).
    const stored: StoredScatterProgressType = Validator.storedScatterProgress.validate(storedRaw2);
    const fanStored = stored[fanIri];
    assert.ok(fanStored !== undefined, 'expected progress entry for fan scatter');
    const ackedCount = fanStored.mode === 'bounded'
      ? fanStored.watermark + fanStored.aheadAcked.length
      : fanStored.ackedResults.length;
    assert.ok(ackedCount >= 1, 'at least one item should be acked after partial run');

    // Sanity: the checkpoint carries the DAG IRI used by the resume path.
    assert.equal(dagName, 'urn:noocodec:dag:scatter-e2e');
  });
});
