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
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer, SCATTER_PROGRESS_KEY } from '../../src/Dagonizer.js';
import type { ScatterProgress } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { GatherConfig } from '../../src/entities/dag/GatherConfig.js';
import type { DAG } from '../../src/entities/index.js';
import type { JsonObject } from '../../src/entities/json.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

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

  protected override snapshotData(): JsonObject {
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

  protected override restoreData(snap: JsonObject): void {
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

const makeScatterDag = (
  dagName: string,
  gatherStrategy: GatherConfig,
  options: { concurrency?: number } = {},
): DAG => ({
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
});

// ─── tests ───────────────────────────────────────────────────────────────────

void describe('Scatter: array source backward compatibility', () => {
  void it('produces the same gathered result as before for a plain array', async () => {
    const dispatcher = new Dagonizer<StreamState>();
    let calls = 0;
    const worker: NodeInterface<StreamState, 'success'> = {
      'name': 'worker', 'outputs': ['success'],
      async execute() { calls++; return { 'errors': [], 'output': 'success' }; },
    };
    dispatcher.registerNode(worker);
    dispatcher.registerDAG(makeScatterDag('arr-compat',
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

    const worker: NodeInterface<StreamState, 'success'> = {
      'name': 'worker', 'outputs': ['success'],
      async execute() {
        current++;
        if (current > peakConcurrent) peakConcurrent = current;
        // Yield to allow other workers to start before decrementing.
        await new Promise<void>((r) => setImmediate(r));
        current--;
        return { 'errors': [], 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    // concurrency=2 on 6 items: peak should never exceed 2.
    dispatcher.registerDAG(makeScatterDag('arr-bounded',
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
    const worker: NodeInterface<StreamState, 'success'> = {
      'name': 'worker', 'outputs': ['success'],
      async execute() { return { 'errors': [], 'output': 'success' }; },
    };
    dispatcher.registerNode(worker);
    dispatcher.registerDAG(makeScatterDag('async-source',
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

    const worker: NodeInterface<StreamState, 'success'> = {
      'name': 'worker', 'outputs': ['success'],
      async execute(state) {
        const item = state.getMetadata<number>('item') ?? 0;
        log.push({ 'event': 'process', 'item': item });
        // Yield to the event loop so the pull loop can advance if backpressure
        // is broken; with correct backpressure the next pull happens only AFTER
        // this item completes.
        await new Promise<void>((r) => setImmediate(r));
        return { 'errors': [], 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    // concurrency=1: only one item in-flight at a time.
    dispatcher.registerDAG(makeScatterDag('bp-test',
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
    const worker: NodeInterface<StreamState, 'success'> = {
      'name': 'worker', 'outputs': ['success'],
      async execute(state) {
        calls++;
        seenItems.push(state.getMetadata<number>('item') ?? -1);
        return { 'errors': [], 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    dispatcher.registerDAG(makeScatterDag('resume-arr',
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
        'placementName': 'fan',
        'inbox': [],
        'ackedResults': [
          { 'kind': 'plain' as const, 'index': 0, 'item': 10, 'output': 'success' },
          { 'kind': 'plain' as const, 'index': 1, 'item': 20, 'output': 'success' },
        ],
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
    const worker: NodeInterface<StreamState, 'success'> = {
      'name': 'worker', 'outputs': ['success'],
      async execute(state) {
        processedItems.push(state.getMetadata<number>('item') ?? -1);
        return { 'errors': [], 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    dispatcher.registerDAG(makeScatterDag('resume-inbox',
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
        'placementName': 'fan',
        'inbox': [{ 'index': 1, 'item': 2 }],  // item 1 (value=2) was in-flight
        'ackedResults': [
          { 'kind': 'plain' as const, 'index': 0, 'item': 1, 'output': 'success' },
        ],
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
    const worker: NodeInterface<StreamState, 'success'> = {
      'name': 'worker', 'outputs': ['success'],
      async execute(state) {
        calls++;
        processedValues.push(state.getMetadata<number>('item') ?? -1);
        return { 'errors': [], 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    dispatcher.registerDAG(makeScatterDag('resume-async',
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
        'placementName': 'fan',
        'inbox': [{ 'index': 2, 'item': 30 }],
        'ackedResults': [
          { 'kind': 'plain' as const, 'index': 0, 'item': 10, 'output': 'success' },
          { 'kind': 'plain' as const, 'index': 1, 'item': 20, 'output': 'success' },
        ],
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

    const worker: NodeInterface<StreamState, 'success'> = {
      'name': 'worker', 'outputs': ['success'],
      async execute(state) {
        const item = state.getMetadata<number>('item') ?? 0;
        state.produced = item * 2;
        return { 'errors': [], 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);

    const dagName = 'incr-map';
    const dag: DAG = {
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
    // incremental fold (an ack triggers both a metadata write for progress and
    // an applyIncremental that appends to mappedResults).
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

    const worker: NodeInterface<StreamState, 'success'> = {
      'name': 'worker', 'outputs': ['success'],
      async execute() { return { 'errors': [], 'output': 'success' }; },
    };
    dispatcher.registerNode(worker);
    dispatcher.registerDAG(makeScatterDag('incr-append',
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
    const worker: NodeInterface<StreamState, 'success' | 'error'> = {
      'name': 'worker', 'outputs': ['success', 'error'],
      async execute(state) {
        const item = state.getMetadata<number>('item') ?? 0;
        return { 'errors': [], 'output': item % 2 === 1 ? 'success' : 'error' };
      },
    };
    dispatcher.registerNode(worker);

    const dagName = 'incr-partition';
    const dag: DAG = {
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

  void it('custom strategy (no applyIncremental) still works via batch apply', async () => {
    const dispatcher = new Dagonizer<StreamState>();
    let customNodeCalls = 0;

    const worker: NodeInterface<StreamState, 'success'> = {
      'name': 'worker', 'outputs': ['success'],
      async execute() { return { 'errors': [], 'output': 'success' }; },
    };
    // Custom gather node: reads gatherResults from metadata.
    const customGather: NodeInterface<StreamState, 'success'> = {
      'name': 'customGather', 'outputs': ['success'],
      async execute(state) {
        customNodeCalls++;
        const records = state.getMetadata<Array<{ item: unknown }>>('gatherResults') ?? [];
        for (const r of records) {
          if (typeof r.item === 'number') state.processed.push(r.item);
        }
        return { 'errors': [], 'output': 'success' };
      },
    };
    dispatcher.registerNode(worker);
    dispatcher.registerNode(customGather);

    const dagName = 'custom-batch';
    const dag: DAG = {
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
    const progressSnapshots: ScatterProgress[] = [];

    const st = new StreamState();
    st.items = [1, 2, 3];

    // Capture each progress write.
    const origSet = st.setMetadata.bind(st);
    st.setMetadata = (key: string, value: unknown): void => {
      origSet(key, value);
      if (key === SCATTER_PROGRESS_KEY) {
        const stored = value as Record<string, ScatterProgress>;
        if (stored['fan'] !== undefined) {
          progressSnapshots.push({ ...stored['fan'] });
        }
      }
    };

    const worker: NodeInterface<StreamState, 'success'> = {
      'name': 'worker', 'outputs': ['success'],
      async execute() { return { 'errors': [], 'output': 'success' }; },
    };
    dispatcher.registerNode(worker);
    dispatcher.registerDAG(makeScatterDag('progress-shape',
      { 'strategy': 'append', 'target': 'processed' },
      { 'concurrency': 1 }));

    await dispatcher.execute('progress-shape', st);

    // 3 items → 3 ack writes.
    assert.equal(progressSnapshots.length, 3);

    // After each ack: inbox shrinks (item acked → removed), ackedResults grows.
    for (let i = 0; i < progressSnapshots.length; i++) {
      const snap = progressSnapshots[i];
      assert.ok(snap !== undefined);
      assert.equal(snap.ackedResults.length, i + 1,
        `after ack ${i + 1}, ackedResults should have ${i + 1} entries`);
      // inbox should be empty (concurrency=1, item acked immediately after body).
      assert.equal(snap.inbox.length, 0,
        `after ack ${i + 1} with concurrency=1, inbox should be empty`);
    }

    // Key is cleared after clean completion.
    assert.equal(st.getMetadata<unknown>(SCATTER_PROGRESS_KEY), undefined);
  });
});
