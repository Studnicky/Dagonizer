/**
 * Tests for the unified streaming scatter executor.
 *
 * Covers:
 *   - Array source: result correctness + backward-compat ordering semantics
 *   - Bounded concurrency: max in-flight ≤ N
 *   - AsyncIterable source: same gathered result as the equivalent array
 *   - True backpressure: source is NOT fully drained before processing starts
 *   - Resume mid-stream (array source): exactly-once delivery
 *   - Resume mid-stream (AsyncIterable source): exactly-once delivery
 *   - Incremental gather: map / append / partition fold progressively
 *   - Run-level abort over an async-iterable source: the pull-loop exits on
 *     signal.aborted, the checkpoint survives (no premature clear), and a
 *     subsequent resume reprocesses the remaining items exactly once
 *   - Pre-aborted signal: the run is interrupted before any item is pulled
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { ScatterProgressType } from '../../src/Dagonizer.js';
import { SCATTER_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { GatherConfigType } from '../../src/entities/dag/GatherConfig.js';
import type { DAGType } from '../../src/entities/index.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

// ─── shared test state ───────────────────────────────────────────────────────

/** Union type for scatter source fields: array (array-mode) or async iterable (streaming mode). */
type ScatterSource<T> = T[] | AsyncIterable<T>;

class StreamState extends NodeStateBase {
  items: ScatterSource<number> = [];
  processed: number[] = [];
  mappedResults: number[] = [];
  partition_success: number[] = [];
  partition_error: number[] = [];
  produced = 0;

  protected override snapshotData(): JsonObjectType {
    // items may be an AsyncIterable at runtime (scatter engine reads it via
    // accessor); only array form is JSON-serialisable. Non-array sources are
    // snapshotted as empty — resume callers supply a re-positioned iterator.
    const itemsSnap = Array.isArray(this.items) ? [...this.items] : [];
    return {
      'items':             itemsSnap,
      'processed':         [...this.processed],
      'mappedResults':     [...this.mappedResults],
      'partition_success': [...this.partition_success],
      'partition_error':   [...this.partition_error],
      'produced':          this.produced,
    };
  }

  protected override restoreData(snap: JsonObjectType): void {
    const num = (k: string): number[] => {
      const v = snap[k];
      return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
    };
    this.items             = num('items');
    this.processed         = num('processed');
    this.mappedResults     = num('mappedResults');
    this.partition_success = num('partition_success');
    this.partition_error   = num('partition_error');
    const p = snap['produced'];
    if (typeof p === 'number') this.produced = p;
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

class TestScatterDag {
  private constructor() {}
  static streaming(
    dagName: string,
    gatherStrategy: GatherConfigType,
    options: { concurrency?: number } = {},
  ): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${dagName}`,
      '@type':    'DAG',
      'name': dagName, 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        {
          '@id':    `urn:noocodex:dag:${dagName}/node/fan`,
          '@type':  'ScatterNode',
          'name':   'fan',
          'body':   { 'node': 'worker' },
          'source': 'items',
          'itemKey': 'item',
          ...(options.concurrency !== undefined ? { 'concurrency': options.concurrency } : {}),
          'gather': gatherStrategy,
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        },
        { '@id': 'urn:noocodex:dag:x/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
  }
}

// ─── tests ───────────────────────────────────────────────────────────────────

void describe('Scatter: array source backward compatibility', () => {
  void it('produces the same gathered result as before for a plain array', async () => {
    const dispatcher = new Dagonizer<StreamState>();
    let calls = 0;
    dispatcher.registerNode(TestNode.make<StreamState>('worker', ['success'], () => { calls++; return 'success'; }));
    dispatcher.registerDAG(TestScatterDag.streaming('arr-compat',
      { 'strategy': 'append', 'target': 'processed' }));

    const state = new StreamState();
    state.items = [1, 2, 3, 4, 5];
    const result = await dispatcher.execute('arr-compat', state);

    assert.equal(calls, 5);
    assert.equal(result.cursor, null);
    assert.deepEqual([...result.state.processed].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  });

  void it('bounded concurrency caps max in-flight workers to N', async () => {
    const dispatcher = new Dagonizer<StreamState>();
    let peakConcurrent = 0;
    let current = 0;

    dispatcher.registerNode(TestNode.make<StreamState>('worker', ['success'], async () => {
      current++;
      if (current > peakConcurrent) peakConcurrent = current;
      // Yield to allow other workers to start before decrementing.
      await new Promise<void>((r) => setImmediate(r));
      current--;
      return 'success';
    }));
    // concurrency=2 on 6 items: peak should never exceed 2.
    dispatcher.registerDAG(TestScatterDag.streaming('arr-bounded',
      { 'strategy': 'append', 'target': 'processed' },
      { 'concurrency': 2 }));

    const state = new StreamState();
    state.items = [1, 2, 3, 4, 5, 6];
    await dispatcher.execute('arr-bounded', state);

    assert.ok(peakConcurrent <= 2,
      `peak concurrent workers was ${peakConcurrent}, expected ≤ 2`);
  });
});

void describe('Scatter: AsyncIterable source', () => {
  void it('drains an async-iterable source and produces the same result as an array', async () => {
    const dispatcher = new Dagonizer<StreamState>();
    dispatcher.registerNode(TestNode.make<StreamState>('worker', ['success']));
    dispatcher.registerDAG(TestScatterDag.streaming('async-source',
      { 'strategy': 'append', 'target': 'processed' },
      { 'concurrency': 1 }));

    // Place an AsyncIterable at state.items.
    async function* makeSource(): AsyncGenerator<number> {
      for (const n of [10, 20, 30]) yield n;
    }

    const state = new StreamState();
    // The schema type for items is number[], but at runtime the scatter engine
    // reads the value via the accessor and passes it to toAsyncIterator.
    // Cast to any to set a non-array source value on the state field.
    state.items = makeSource();

    const result = await dispatcher.execute('async-source', state);
    assert.equal(result.cursor, null);
    assert.deepEqual([...result.state.processed].sort((a, b) => a - b), [10, 20, 30]);
  });

  void it('true backpressure: source is not fully drained before processing begins', async () => {
    const dispatcher = new Dagonizer<StreamState>();

    // Interleaving log: each entry is either { event: 'pull', item: N } or
    // { event: 'process', item: N }. With true backpressure and concurrency=1
    // the sequence must be: pull(1) → process(1) → pull(2) → process(2) → …
    const log: Array<{ event: 'pull' | 'process'; item: number }> = [];

    async function* lazySource(): AsyncGenerator<number> {
      for (const n of [1, 2, 3, 4, 5]) {
        log.push({ 'event': 'pull', 'item': n });
        yield n;
      }
    }

    dispatcher.registerNode(TestNode.make<StreamState>('worker', ['success'], async (state) => {
      const item = state.getMetadata<number>('item') ?? 0;
      log.push({ 'event': 'process', 'item': item });
      // Yield to the event loop so the pull loop can advance if backpressure
      // is broken; with correct backpressure the next pull happens only AFTER
      // this item completes.
      await new Promise<void>((r) => setImmediate(r));
      return 'success';
    }));
    // concurrency=1: only one item in-flight at a time.
    dispatcher.registerDAG(TestScatterDag.streaming('bp-test',
      { 'strategy': 'append', 'target': 'processed' },
      { 'concurrency': 1 }));

    const st = new StreamState();
    st.items = lazySource();

    await dispatcher.execute('bp-test', st);

    // All 5 items pulled and processed.
    const pulls = log.filter((e) => e.event === 'pull').map((e) => e.item);
    const procs = log.filter((e) => e.event === 'process').map((e) => e.item);
    assert.equal(pulls.length, 5);
    assert.equal(procs.length, 5);
    assert.deepEqual([...st.processed].sort((a, b) => a - b), [1, 2, 3, 4, 5]);

    // Interleaving invariant: for each item N > 1, its pull must come AFTER the
    // process of item N-1. Scan the log for the first 'pull' of item 2: the
    // 'process' of item 1 must appear before it.
    for (let n = 2; n <= 5; n++) {
      const pullIdx  = log.findIndex((e) => e.event === 'pull'    && e.item === n);
      const procIdx  = log.findIndex((e) => e.event === 'process' && e.item === n - 1);
      assert.ok(
        procIdx !== -1 && pullIdx !== -1 && procIdx < pullIdx,
        `interleaving violated: process(${n - 1}) at log[${procIdx}] must precede pull(${n}) at log[${pullIdx}]`,
      );
    }
  });
});

void describe('Scatter: resume mid-stream (array source)', () => {
  void it('processes all items exactly once when resuming after K successes', async () => {
    // Simulate: 5-item array, items 0+1 already acked in checkpoint.
    // Resume should process only items 2, 3, 4 — exactly 3 calls.
    const dispatcher = new Dagonizer<StreamState>();
    let calls = 0;
    const seenItems: number[] = [];
    dispatcher.registerNode(TestNode.make<StreamState>('worker', ['success'], (state) => {
      calls++;
      seenItems.push(state.getMetadata<number>('item') ?? -1);
      return 'success';
    }));
    dispatcher.registerDAG(TestScatterDag.streaming('resume-arr',
      { 'strategy': 'append', 'target': 'processed' },
      { 'concurrency': 1 }));

    const state = new StreamState();
    state.items = [10, 20, 30, 40, 50];
    // Simulate what a real checkpoint looks like after 2 successful acks:
    // the gather contributions (append strategy) were already folded into
    // state.processed during the prior run. A real snapshot carries these values.
    state.processed = [10, 20];
    // Seed checkpoint: items 0 and 1 already acked.
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      'fan': {
        'mode':          'bounded' as const,
        'placementName': 'fan',
        'inbox':         [],
        'watermark':     2,
        'aheadAcked':    [],
        'outcomeTally':  { 'success': 2 },
      },
    });

    const result = await dispatcher.resume('resume-arr', state, 'fan');

    assert.equal(calls, 3, `expected 3 fresh calls on resume, got ${calls}`);
    assert.equal(result.cursor, null);
    // processed already had [10, 20] from the prior run; 3 fresh items appended.
    assert.equal(result.state.processed.length, 5,
      `expected 5 processed items, got ${result.state.processed.length}`);
    assert.deepEqual([...result.state.processed].sort((a, b) => a - b),
      [10, 20, 30, 40, 50]);
    // Progress cleared.
    assert.equal(result.state.getMetadata<unknown>(SCATTER_PROGRESS_KEY), undefined);
  });

  void it('inbox items (in-flight at crash time) are reprocessed on resume', async () => {
    // Inbox holds items that were pulled but not yet acked.
    // Resume must reprocess them; they must appear in the final result.
    const dispatcher = new Dagonizer<StreamState>();
    const processedItems: number[] = [];
    dispatcher.registerNode(TestNode.make<StreamState>('worker', ['success'], (state) => {
      processedItems.push(state.getMetadata<number>('item') ?? -1);
      return 'success';
    }));
    dispatcher.registerDAG(TestScatterDag.streaming('resume-inbox',
      { 'strategy': 'append', 'target': 'processed' },
      { 'concurrency': 1 }));

    const state = new StreamState();
    state.items = [1, 2, 3, 4, 5];
    // Simulate what a real checkpoint looks like: item 0 acked and its gather
    // contribution (append strategy, value=1) was already folded into processed.
    // Item 1 was in-flight (in inbox) at crash — not yet gathered.
    state.processed = [1]; // item 0 already gathered
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      'fan': {
        'mode':          'bounded' as const,
        'placementName': 'fan',
        'inbox':         [{ 'index': 1, 'item': 2 }],  // item 1 (value=2) was in-flight
        'watermark':     1,
        'aheadAcked':    [],
        'outcomeTally':  { 'success': 1 },
      },
    });

    const result = await dispatcher.resume('resume-inbox', state, 'fan');

    assert.equal(result.cursor, null);
    // Item 1 (from inbox) + items 2,3,4 (fresh from source) = 4 calls.
    assert.equal(processedItems.length, 4, `expected 4 calls, got ${processedItems.length}`);
    // processed had [1] from prior run; 4 more items (inbox+fresh) appended.
    assert.equal(result.state.processed.length, 5,
      `expected 5 processed, got ${result.state.processed.length}`);
    // No double-processing: item with value=2 appears exactly once.
    const count2 = result.state.processed.filter((x) => x === 2).length;
    assert.equal(count2, 1, `item value 2 should appear exactly once, got ${count2}`);
    // Progress cleared.
    assert.equal(result.state.getMetadata<unknown>(SCATTER_PROGRESS_KEY), undefined);
  });
});

void describe('Scatter: resume mid-stream (AsyncIterable source)', () => {
  void it('processes all items exactly once when resuming with an async-iterable source', async () => {
    // AsyncIterable that yields items 0-4 (values 10-50).
    // Checkpoint: items 0 and 1 already acked; item 2 was in inbox (in-flight).
    // Resume must: reprocess inbox item 2, then pull items 3 and 4 from source.
    const dispatcher = new Dagonizer<StreamState>();
    let calls = 0;
    const processedValues: number[] = [];
    dispatcher.registerNode(TestNode.make<StreamState>('worker', ['success'], (state) => {
      calls++;
      processedValues.push(state.getMetadata<number>('item') ?? -1);
      return 'success';
    }));
    dispatcher.registerDAG(TestScatterDag.streaming('resume-async',
      { 'strategy': 'append', 'target': 'processed' },
      { 'concurrency': 1 }));

    // The source yields items starting at index 3 onward (0,1,2 already
    // handled in checkpoint). The scatter engine assigns nextIndex=3 since
    // max(acked[0,1], inbox[2]) + 1 = 3.
    async function* remainingSource(): AsyncGenerator<number> {
      // Only yield items that haven't been processed yet (values 40, 50).
      // The engine assigns indices 3 and 4 to these.
      yield 40;
      yield 50;
    }

    const st = new StreamState();
    st.items = remainingSource();

    // Simulate what a real checkpoint looks like: items 0 and 1 were acked
    // and their gather contributions (append strategy) are already in processed.
    st.processed = [10, 20];

    // Checkpoint: indices 0,1 acked; index 2 in inbox (value 30).
    st.setMetadata(SCATTER_PROGRESS_KEY, {
      'fan': {
        'mode':          'bounded' as const,
        'placementName': 'fan',
        'inbox':         [{ 'index': 2, 'item': 30 }],
        'watermark':     2,
        'aheadAcked':    [],
        'outcomeTally':  { 'success': 2 },
      },
    });

    const result = await dispatcher.resume('resume-async', st, 'fan');

    assert.equal(result.cursor, null);
    // 3 calls: inbox item (30) + 2 fresh items (40, 50).
    assert.equal(calls, 3, `expected 3 calls, got ${calls}`);
    // processed had [10, 20] from prior run; 3 fresh calls add [30, 40, 50] → 5 total.
    assert.equal(result.state.processed.length, 5,
      `expected 5 processed, got ${result.state.processed.length}`);
    // Values that were processed fresh in this run.
    assert.ok(processedValues.includes(30), 'inbox item 30 must be reprocessed');
    assert.ok(processedValues.includes(40), 'fresh item 40 must be processed');
    assert.ok(processedValues.includes(50), 'fresh item 50 must be processed');
    // No double-processing: inbox value 30 appears only once.
    assert.equal(processedValues.filter((v) => v === 30).length, 1,
      'inbox item must not be processed twice');
    // Progress cleared.
    assert.equal(result.state.getMetadata<unknown>(SCATTER_PROGRESS_KEY), undefined);
  });
});

void describe('Scatter: incremental gather', () => {
  void it('map strategy folds each record into parent state as it completes', async () => {
    const dispatcher = new Dagonizer<StreamState>();
    const foldsAfterEachItem: number[] = [];

    dispatcher.registerNode(TestNode.make<StreamState>('worker', ['success'], (state) => {
      const item = state.getMetadata<number>('item') ?? 0;
      state.produced = item * 2;
      return 'success';
    }));

    const dagName = 'incr-map';
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${dagName}`,
      '@type':    'DAG',
      'name': dagName, 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        {
          '@id':    `urn:noocodex:dag:${dagName}/node/fan`,
          '@type':  'ScatterNode',
          'name':   'fan',
          'body':   { 'node': 'worker' },
          'source': 'items',
          'itemKey': 'item',
          'concurrency': 1,
          'gather': { 'strategy': 'map', 'mapping': { 'produced': 'mappedResults' } },
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        },
        { '@id': 'urn:noocodex:dag:x/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    // Intercept setMetadata on state to record mappedResults length after each
    // reduce call (an ack triggers both a metadata write for progress and
    // a reduce call that appends to mappedResults).
    const st = new StreamState();
    st.items = [1, 2, 3];
    let lastMappedLen = 0;
    const origSet = st.setMetadata.bind(st);
    st.setMetadata = (key: string, value: unknown): void => {
      origSet(key, value);
      if (key === SCATTER_PROGRESS_KEY) {
        // After each ack write, record how many mapped results exist so far.
        foldsAfterEachItem.push(st.mappedResults.length);
        lastMappedLen = st.mappedResults.length;
      }
    };

    await dispatcher.execute(dagName, st);

    // 3 items → 3 acks → 3 progress writes; mappedResults grows 1 at a time.
    assert.equal(foldsAfterEachItem.length, 3);
    assert.deepEqual(foldsAfterEachItem, [1, 2, 3],
      'mappedResults should grow by 1 after each incremental fold');
    assert.equal(lastMappedLen, 3);
    assert.deepEqual([...st.mappedResults].sort((a, b) => a - b), [2, 4, 6]);
  });

  void it('append strategy folds each record into parent state as it completes', async () => {
    const dispatcher = new Dagonizer<StreamState>();
    const foldsAfterEachAck: number[] = [];

    dispatcher.registerNode(TestNode.make<StreamState>('worker', ['success']));
    dispatcher.registerDAG(TestScatterDag.streaming('incr-append',
      { 'strategy': 'append', 'target': 'processed' },
      { 'concurrency': 1 }));

    const st = new StreamState();
    st.items = [5, 10, 15];
    const origSet = st.setMetadata.bind(st);
    st.setMetadata = (key: string, value: unknown): void => {
      origSet(key, value);
      if (key === SCATTER_PROGRESS_KEY) {
        foldsAfterEachAck.push(st.processed.length);
      }
    };

    await dispatcher.execute('incr-append', st);

    assert.deepEqual(foldsAfterEachAck, [1, 2, 3],
      'processed should grow by 1 after each incremental fold');
    assert.deepEqual([...st.processed].sort((a, b) => a - b), [5, 10, 15]);
  });

  void it('partition strategy folds each record into the correct partition as it completes', async () => {
    const dispatcher = new Dagonizer<StreamState>();
    const successFoldsAfterAck: number[] = [];
    const errorFoldsAfterAck: number[] = [];

    // Items 1,3,5 → 'success'; items 2,4 → 'error'.
    dispatcher.registerNode(TestNode.make<StreamState>('worker', ['success', 'error'], (state) => {
      const item = state.getMetadata<number>('item') ?? 0;
      return item % 2 === 1 ? 'success' : 'error';
    }));

    const dagName = 'incr-partition';
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${dagName}`,
      '@type':    'DAG',
      'name': dagName, 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        {
          '@id':    `urn:noocodex:dag:${dagName}/node/fan`,
          '@type':  'ScatterNode',
          'name':   'fan',
          'body':   { 'node': 'worker' },
          'source': 'items',
          'itemKey': 'item',
          'concurrency': 1,
          'gather': {
            'strategy': 'partition',
            'partitions': { 'success': 'partition_success', 'error': 'partition_error' },
          },
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        },
        { '@id': 'urn:noocodex:dag:x/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    const st = new StreamState();
    st.items = [1, 2, 3, 4, 5];
    const origSet = st.setMetadata.bind(st);
    st.setMetadata = (key: string, value: unknown): void => {
      origSet(key, value);
      if (key === SCATTER_PROGRESS_KEY) {
        successFoldsAfterAck.push(st.partition_success.length);
        errorFoldsAfterAck.push(st.partition_error.length);
      }
    };

    await dispatcher.execute(dagName, st);

    // 5 items → 5 acks. Items 1,3,5 → success; 2,4 → error.
    assert.equal(successFoldsAfterAck.length, 5);
    assert.equal(errorFoldsAfterAck.length, 5);
    assert.deepEqual([...st.partition_success].sort((a, b) => a - b), [1, 3, 5]);
    assert.deepEqual([...st.partition_error].sort((a, b) => a - b), [2, 4]);
  });

  void it('custom strategy accumulates in finalize', async () => {
    const dispatcher = new Dagonizer<StreamState>();
    let customNodeCalls = 0;

    dispatcher.registerNode(TestNode.make<StreamState>('worker', ['success']));
    // Custom gather node: reads gatherResults from metadata.
    dispatcher.registerNode(TestNode.make<StreamState>('customGather', ['success'], (state) => {
      customNodeCalls++;
      const records = state.getMetadata<Array<{ item: unknown }>>('gatherResults') ?? [];
      for (const r of records) {
        if (typeof r.item === 'number') state.processed.push(r.item);
      }
      return 'success';
    }));

    const dagName = 'custom-batch';
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${dagName}`,
      '@type':    'DAG',
      'name': dagName, 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        {
          '@id':    `urn:noocodex:dag:${dagName}/node/fan`,
          '@type':  'ScatterNode',
          'name':   'fan',
          'body':   { 'node': 'worker' },
          'source': 'items',
          'itemKey': 'item',
          'concurrency': 2,
          'gather': { 'strategy': 'custom', 'customNode': 'customGather' },
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        },
        { '@id': 'urn:noocodex:dag:x/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    const st = new StreamState();
    st.items = [7, 14, 21];
    await dispatcher.execute(dagName, st);

    // Custom gather node called exactly once (batch apply).
    assert.equal(customNodeCalls, 1);
    assert.equal(st.processed.length, 3);
    assert.deepEqual([...st.processed].sort((a, b) => a - b), [7, 14, 21]);
  });
});

void describe('Scatter: progress shape (inbox model)', () => {
  void it('persists inbox + ackedResults; clears on clean completion', async () => {
    const dispatcher = new Dagonizer<StreamState>();
    const progressSnapshots: ScatterProgressType[] = [];

    const st = new StreamState();
    st.items = [1, 2, 3];

    // Capture each progress write.
    const origSet = st.setMetadata.bind(st);
    st.setMetadata = (key: string, value: unknown): void => {
      origSet(key, value);
      if (key === SCATTER_PROGRESS_KEY) {
        const isStoredProgress = (v: unknown): v is Record<string, ScatterProgressType> =>
          typeof v === 'object' && v !== null;
        if (isStoredProgress(value) && value['fan'] !== undefined) {
          progressSnapshots.push({ ...value['fan'] });
        }
      }
    };

    dispatcher.registerNode(TestNode.make<StreamState>('worker', ['success']));
    dispatcher.registerDAG(TestScatterDag.streaming('progress-shape',
      { 'strategy': 'append', 'target': 'processed' },
      { 'concurrency': 1 }));

    await dispatcher.execute('progress-shape', st);

    // 3 items → 3 ack writes.
    assert.equal(progressSnapshots.length, 3);

    // After each ack: inbox shrinks (item acked → removed), acked count grows.
    // append is compactable (retainsRecordsForFinalize=false) → bounded checkpoint.
    for (let i = 0; i < progressSnapshots.length; i++) {
      const snap = progressSnapshots[i];
      assert.ok(snap !== undefined);
      // With concurrency=1, items complete in order so watermark advances
      // contiguously; aheadAcked stays empty.
      const totalAcked = snap.mode === 'bounded'
        ? snap.watermark + snap.aheadAcked.length
        : snap.ackedResults.length;
      assert.equal(totalAcked, i + 1,
        `after ack ${i + 1}, total acked should be ${i + 1}`);
      // inbox should be empty (concurrency=1, item acked immediately after body).
      assert.equal(snap.inbox.length, 0,
        `after ack ${i + 1} with concurrency=1, inbox should be empty`);
    }

    // Key is cleared after clean completion.
    assert.equal(st.getMetadata<unknown>(SCATTER_PROGRESS_KEY), undefined);
  });
});

void describe('Scatter: run-level abort + exactly-once resume', () => {
  /**
   * Core scenario: 50-item async generator, abort fires after the first few
   * items complete, many items remain unprocessed. After abort the checkpoint
   * must still record the acked items (fewer than total), so a resume can
   * reprocess the remainder.
   *
   * The pull-loop exits when signal.aborted is true, the throw fires before
   * ScatterCheckpoint.clear(), the run returns with cursor='fan', and the
   * checkpoint contains the partial ackedResults.
   */
  void it('aborted scatter over async-iterable source preserves checkpoint — resume sees remaining items', async () => {
    const TOTAL_ITEMS = 50;
    const ABORT_AFTER_COMPLETE = 3; // abort after this many items complete

    // Gate: abort fires once the configured number of items have completed.
    let completedCount = 0;
    const controller = new AbortController();

    const dispatcher = new Dagonizer<StreamState>();

    class WorkerNode extends ScalarNode<StreamState, 'success'> {
      override readonly name = 'worker';
      override readonly outputs = ['success'] as const;
      override get outputSchema(): Record<'success', SchemaObjectType> { return { 'success': { 'type': 'object' } }; }
      protected override async executeOne(state: StreamState, context: NodeContextType): Promise<NodeOutputType<'success'>> {
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
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    dispatcher.registerNode(new WorkerNode());
    dispatcher.registerDAG(TestScatterDag.streaming('abort-async-50',
      { 'strategy': 'append', 'target': 'processed' },
      { 'concurrency': 2 }));

    const state = new StreamState();

    // Place an async-iterable at state.items (50 items).
    async function* makeSource(): AsyncGenerator<number> {
      for (let i = 1; i <= TOTAL_ITEMS; i++) {
        yield i;
      }
    }
    state.items = makeSource();

    const result = await dispatcher.execute('abort-async-50', state, { 'signal': controller.signal });

    // 1. The run was interrupted — cursor stays on 'fan'.
    assert.equal(result.cursor, 'fan',
      `cursor should be 'fan' after abort; got '${result.cursor}'`);

    // 2. The checkpoint survives — progress entry is still present.
    const stored = result.state.getMetadata<Record<string, ScatterProgressType>>(SCATTER_PROGRESS_KEY);
    assert.ok(stored !== undefined,
      'checkpoint must be present after abort (ScatterCheckpoint.clear must NOT have run)');

    const entry = stored['fan'];
    assert.ok(entry !== undefined, 'expected a progress entry for placement "fan"');

    // 3. Not all items were acked — fewer than total. If the pull-loop ignored
    //    signal.aborted, the acked count would equal TOTAL_ITEMS (silent data-loss).
    // append is compactable → bounded checkpoint.
    const ackedCount = entry.mode === 'bounded'
      ? entry.watermark + entry.aheadAcked.length
      : entry.ackedResults.length;
    assert.ok(
      ackedCount < TOTAL_ITEMS,
      `only ${ackedCount} of ${TOTAL_ITEMS} items should be acked after abort; ` +
      `got all ${TOTAL_ITEMS} — checkpoint was cleared prematurely (data-loss bug)`,
    );

    // 4. A subsequent resume processes the remaining items. The resume
    //    dispatcher gets a fresh array source of the same total size; it skips
    //    already-acked indices via seenIndices and completes the rest.
    const resumeDispatcher = new Dagonizer<StreamState>();
    resumeDispatcher.registerNode(TestNode.make<StreamState>('worker', ['success'], (state) => {
      state.processed.push(state.getMetadata<number>('item') ?? -1);
      return 'success';
    }));
    resumeDispatcher.registerDAG(TestScatterDag.streaming('abort-async-resume',
      { 'strategy': 'append', 'target': 'processed' },
      { 'concurrency': 2 }));

    // Build resume state: carry over the checkpoint metadata, already-processed
    // items, and a full index-stable array source.
    const resumeState = new StreamState();
    const abortedCheckpoint = result.state.getMetadata<Record<string, ScatterProgressType>>(SCATTER_PROGRESS_KEY);
    if (abortedCheckpoint !== undefined) {
      resumeState.setMetadata(SCATTER_PROGRESS_KEY, abortedCheckpoint);
    }
    resumeState.processed = [...result.state.processed];
    resumeState.items = Array.from({ 'length': TOTAL_ITEMS }, (_, i) => i + 1);

    const resumeResult = await resumeDispatcher.resume('abort-async-resume', resumeState, 'fan');

    // 5. Resume completes (cursor null).
    assert.equal(resumeResult.cursor, null,
      `resume must complete; cursor should be null, got '${resumeResult.cursor}'`);

    // 6. All TOTAL_ITEMS appear in processed.
    assert.equal(
      resumeResult.state.processed.length,
      TOTAL_ITEMS,
      `expected ${TOTAL_ITEMS} processed items total; got ${resumeResult.state.processed.length}`,
    );
  });

  /**
   * Simpler scenario: signal already aborted when the pull-loop starts. The
   * pre-abort is caught in the runNodes main loop before executeScatter is
   * reached, so cursor stays on 'fan' and no item is processed.
   */
  void it('pre-aborted signal: pull-loop exits before processing any items', async () => {
    const dispatcher = new Dagonizer<StreamState>();

    dispatcher.registerNode(TestNode.make<StreamState>('worker', ['success'], (state) => {
      state.processed.push(state.getMetadata<number>('item') ?? -1);
      return 'success';
    }));
    dispatcher.registerDAG(TestScatterDag.streaming('pre-aborted',
      { 'strategy': 'append', 'target': 'processed' },
      { 'concurrency': 2 }));

    const state = new StreamState();

    async function* lazySource(): AsyncGenerator<number> {
      for (let i = 1; i <= 10; i++) yield i;
    }
    state.items = lazySource();

    // Abort before execution starts.
    const ctl = new AbortController();
    ctl.abort(new Error('pre-abort'));

    const result = await dispatcher.execute('pre-aborted', state, { 'signal': ctl.signal });

    assert.equal(result.cursor, 'fan', 'cursor should be fan after pre-abort');
    assert.equal(result.state.processed.length, 0, 'no items should have been processed');
  });

  /**
   * Abort-then-resume over an array source: acked items from the aborted run
   * are NOT re-executed on resume (exactly-once guarantee), and every item is
   * executed exactly once across the two runs.
   */
  void it('items acked before abort are not re-executed on resume', async () => {
    const TOTAL_ITEMS = 20;
    const ABORT_AFTER = 5;

    let completedCount = 0;
    const controller = new AbortController();
    const executedItems: number[] = [];

    const dispatcher = new Dagonizer<StreamState>();
    class ExactlyOnceWorkerNode extends ScalarNode<StreamState, 'success'> {
      override readonly name = 'worker';
      override readonly outputs = ['success'] as const;
      override get outputSchema(): Record<'success', SchemaObjectType> { return { 'success': { 'type': 'object' } }; }
      protected override async executeOne(state: StreamState, context: NodeContextType): Promise<NodeOutputType<'success'>> {
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
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    dispatcher.registerNode(new ExactlyOnceWorkerNode());
    // Array source, concurrency=1 for deterministic index-stable resume.
    dispatcher.registerDAG(TestScatterDag.streaming('exactly-once-abort',
      { 'strategy': 'append', 'target': 'processed' },
      { 'concurrency': 1 }));

    const state = new StreamState();
    state.items = Array.from({ 'length': TOTAL_ITEMS }, (_, i) => i + 1);

    const partial = await dispatcher.execute('exactly-once-abort', state, { 'signal': controller.signal });

    assert.equal(partial.cursor, 'fan', 'run must be interrupted');

    // Resume with a fresh dispatcher.
    const resumeItems: number[] = [];
    const resumeDispatcher = new Dagonizer<StreamState>();
    resumeDispatcher.registerNode(TestNode.make<StreamState>('worker', ['success'], (state) => {
      const item = state.getMetadata<number>('item') ?? -1;
      resumeItems.push(item);
      state.processed.push(item);
      return 'success';
    }));
    resumeDispatcher.registerDAG(TestScatterDag.streaming('exactly-once-abort',
      { 'strategy': 'append', 'target': 'processed' },
      { 'concurrency': 1 }));

    // Restore state for resume.
    const resumeState = new StreamState();
    const checkpoint = partial.state.getMetadata<Record<string, ScatterProgressType>>(SCATTER_PROGRESS_KEY);
    if (checkpoint !== undefined) {
      resumeState.setMetadata(SCATTER_PROGRESS_KEY, checkpoint);
    }
    resumeState.processed = [...partial.state.processed];
    resumeState.items = Array.from({ 'length': TOTAL_ITEMS }, (_, i) => i + 1);

    const resumeResult = await resumeDispatcher.resume('exactly-once-abort', resumeState, 'fan');

    assert.equal(resumeResult.cursor, null, 'resume must complete');

    // No item appears in both the first run and the resume run.
    const firstRunSet = new Set(executedItems);
    const overlap = resumeItems.filter((v) => firstRunSet.has(v));
    assert.equal(
      overlap.length,
      0,
      `items re-executed on resume that were already completed in first run: [${overlap.join(', ')}]`,
    );

    // All TOTAL_ITEMS appear across the two runs.
    const allExecuted = new Set([...executedItems, ...resumeItems]);
    assert.equal(allExecuted.size, TOTAL_ITEMS,
      `expected ${TOTAL_ITEMS} unique items across both runs; got ${allExecuted.size}`);
  });
});
