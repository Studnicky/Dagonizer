/**
 * Reservoir scatter tests.
 *
 * The `append` gather strategy (used throughout) appends `record.item` — the
 * source element — into the parent state's target field. Nodes in these tests
 * do NOT manually write to `gathered`; the gather fold owns that.
 *
 * `gathered` is typed as `ReservoirItem[]` because the scatter source is
 * `items: ReservoirItem[]` and the append strategy appends each item as-is.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { EMPTY_CONTRACT_FRAGMENT } from '../../src/contracts/OperationContractFragment.js';
import type { Batch } from '../../src/core/batch/Batch.js';
import type { RoutedBatch } from '../../src/core/batch/RoutedBatch.js';
import { Dagonizer, SCATTER_PROGRESS_KEY } from '../../src/Dagonizer.js';
import type { ScatterProgress } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import type { JsonObject } from '../../src/entities/json.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Timeout } from '../../src/runtime/Timeout.js';

/** Item shape used by all reservoir tests. Must be JSON-serialisable. */
type ReservoirItem = { key: string; value: number };

/**
 * State for reservoir tests.
 *
 * `gathered` stores the raw items appended by the gather strategy.
 * The `append` strategy with no `field` appends `record.item` (the whole
 * source element), so `gathered` will contain `ReservoirItem` objects after
 * a scatter run.
 */
class ReservoirState extends NodeStateBase {
  items: ReservoirItem[] = [];
  gathered: ReservoirItem[] = [];

  protected override snapshotData(): JsonObject {
    return {
      'items':    this.items as unknown as JsonObject,
      'gathered': this.gathered as unknown as JsonObject,
    };
  }

  protected override restoreData(snap: JsonObject): void {
    const items = snap['items'];
    if (Array.isArray(items)) {
      this.items = items.filter(
        (x): x is ReservoirItem =>
          typeof x === 'object' && x !== null && 'key' in x && 'value' in x &&
          typeof (x as ReservoirItem).key === 'string' &&
          typeof (x as ReservoirItem).value === 'number',
      );
    }
    const gathered = snap['gathered'];
    if (Array.isArray(gathered)) {
      this.gathered = gathered.filter(
        (x): x is ReservoirItem =>
          typeof x === 'object' && x !== null && 'key' in x && 'value' in x,
      );
    }
  }
}

/** Build a reservoir DAG whose scatter node uses the given keyField + capacity. */
function makeReservoirDag(dagName: string, keyField: string, capacity: number): DAG {
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
        'itemKey': 'currentItem',
        'reservoir': { keyField, 'capacity': capacity },
        // No `field`: append strategy appends record.item (the ReservoirItem) to target.
        'gather': { 'strategy': 'append', 'target': 'gathered' },
        'outputs': {
          'all-success': 'end',
          'partial':     'end',
          'all-error':   'end',
          'empty':       'end',
        },
      },
      {
        '@id':    `urn:noocodex:dag:${dagName}/node/end`,
        '@type':  'TerminalNode',
        'name':   'end',
        'outcome': 'completed',
      },
    ],
  };
}

/**
 * Build a batch-tracking node that records per-execute batch sizes.
 *
 * The node does NOT write to `gathered` — the gather strategy handles that.
 */
function makeBatchTrackingNode(batchSizes: number[]): NodeInterface<ReservoirState> {
  return {
    'name':     'worker',
    'outputs':  ['success'] as const,
    'contract': EMPTY_CONTRACT_FRAGMENT,
    'timeout':  Timeout.none(),
    async execute(
      batch: Batch<ReservoirState>,
      _context: NodeContextInterface,
    ): Promise<RoutedBatch<string, ReservoirState>> {
      batchSizes.push(batch.size);
      return new Map([['success', batch]]);
    },
  };
}

/** Passthrough node — routes everything to 'success'. No state mutation. */
const PASSTHROUGH_NODE: NodeInterface<ReservoirState> = {
  'name':     'worker',
  'outputs':  ['success'] as const,
  'contract': EMPTY_CONTRACT_FRAGMENT,
  'timeout':  Timeout.none(),
  async execute(
    batch: Batch<ReservoirState>,
    _context: NodeContextInterface,
  ): Promise<RoutedBatch<string, ReservoirState>> {
    return new Map([['success', batch]]);
  },
};

// ---------------------------------------------------------------------------
// Test 1 — capacity release
// ---------------------------------------------------------------------------

void describe('Reservoir scatter — capacity release', () => {
  void it('dispatches exactly capacity-sized batches', async () => {
    const dispatcher = new Dagonizer<ReservoirState>();
    const batchSizes: number[] = [];

    dispatcher.registerNode(makeBatchTrackingNode(batchSizes));
    dispatcher.registerDAG(makeReservoirDag('reservoir-capacity', 'key', 100));

    const state = new ReservoirState();
    // 1000 items with a single key 'k', capacity 100 → 10 capacity releases.
    for (let i = 0; i < 1000; i++) {
      state.items.push({ 'key': 'k', 'value': i });
    }

    const result = await dispatcher.execute('reservoir-capacity', state);
    assert.equal(result.cursor, null);
    assert.equal(batchSizes.length, 10, `expected 10 batches, got ${batchSizes.length}`);
    for (const size of batchSizes) {
      assert.equal(size, 100, `expected batch size 100, got ${size}`);
    }
    // gather: 1000 items appended by the strategy.
    assert.equal(result.state.gathered.length, 1000);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — keyed partitioning (no cross-key mixing)
// ---------------------------------------------------------------------------

void describe('Reservoir scatter — keyed partitioning', () => {
  void it('releases one batch per key with no cross-key items', async () => {
    const dispatcher = new Dagonizer<ReservoirState>();
    const batchesByKey = new Map<string, ReservoirItem[][]>();

    const node: NodeInterface<ReservoirState> = {
      'name':     'worker',
      'outputs':  ['success'] as const,
      'contract': EMPTY_CONTRACT_FRAGMENT,
      'timeout':  Timeout.none(),
      async execute(
        batch: Batch<ReservoirState>,
        _ctx: NodeContextInterface,
      ): Promise<RoutedBatch<string, ReservoirState>> {
        // Collect the items from this batch to verify no cross-key mixing.
        const keys = new Set<string>();
        const batchItems: ReservoirItem[] = [];
        for (const batchItem of batch) {
          const val = batchItem.state.getMetadata<ReservoirItem>('currentItem');
          if (val !== undefined) {
            keys.add(val.key);
            batchItems.push(val);
          }
        }
        // All items in one reservoir batch must share the same key.
        assert.equal(keys.size, 1, `batch contained mixed keys: ${[...keys].join(', ')}`);
        const batchKey = [...keys][0] as string;
        const existing = batchesByKey.get(batchKey);
        if (existing !== undefined) {
          existing.push(batchItems);
        } else {
          batchesByKey.set(batchKey, [batchItems]);
        }
        return new Map([['success', batch]]);
      },
    };

    dispatcher.registerNode(node);
    dispatcher.registerDAG(makeReservoirDag('reservoir-keyed', 'key', 100));

    const state = new ReservoirState();
    // 300 items across 3 keys, 100 per key.
    for (let i = 0; i < 100; i++) state.items.push({ 'key': 'a', 'value': i });
    for (let i = 0; i < 100; i++) state.items.push({ 'key': 'b', 'value': i + 100 });
    for (let i = 0; i < 100; i++) state.items.push({ 'key': 'c', 'value': i + 200 });

    const result = await dispatcher.execute('reservoir-keyed', state);
    assert.equal(result.cursor, null);
    // Exactly 3 releases — one per key.
    assert.equal(batchesByKey.size, 3);
    for (const [, batches] of batchesByKey) {
      assert.equal(batches.length, 1, 'expected exactly 1 capacity release per key');
      assert.equal((batches[0] as ReservoirItem[]).length, 100);
    }
    assert.equal(result.state.gathered.length, 300);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — complete-flush (partial batches flushed when source drains)
// ---------------------------------------------------------------------------

void describe('Reservoir scatter — complete-flush', () => {
  void it('flushes partial key buffers when source is exhausted', async () => {
    const dispatcher = new Dagonizer<ReservoirState>();
    let executeCalls = 0;

    const node: NodeInterface<ReservoirState> = {
      'name':     'worker',
      'outputs':  ['success'] as const,
      'contract': EMPTY_CONTRACT_FRAGMENT,
      'timeout':  Timeout.none(),
      async execute(
        batch: Batch<ReservoirState>,
        _ctx: NodeContextInterface,
      ): Promise<RoutedBatch<string, ReservoirState>> {
        executeCalls++;
        return new Map([['success', batch]]);
      },
    };

    dispatcher.registerNode(node);
    // capacity 100, but only 50 items per key → complete-flush fires at drain.
    dispatcher.registerDAG(makeReservoirDag('reservoir-flush', 'key', 100));

    const state = new ReservoirState();
    // 3 keys × 50 items = 150 total (all below capacity of 100).
    for (let i = 0; i < 50; i++) state.items.push({ 'key': 'x', 'value': i });
    for (let i = 0; i < 50; i++) state.items.push({ 'key': 'y', 'value': i + 50 });
    for (let i = 0; i < 50; i++) state.items.push({ 'key': 'z', 'value': i + 100 });

    const result = await dispatcher.execute('reservoir-flush', state);
    assert.equal(result.cursor, null);
    // One execute call per key (3 partial batches at complete-flush).
    assert.equal(executeCalls, 3, `expected 3 execute calls, got ${executeCalls}`);
    assert.equal(result.state.gathered.length, 150, `expected 150 gathered, got ${result.state.gathered.length}`);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — gather exactly-once (no double-fold)
// ---------------------------------------------------------------------------

void describe('Reservoir scatter — gather exactly-once', () => {
  void it('each item appears exactly once in the gathered output', async () => {
    const dispatcher = new Dagonizer<ReservoirState>();
    const batchSizes: number[] = [];

    dispatcher.registerNode(makeBatchTrackingNode(batchSizes));
    // capacity 5, 2 keys × 10 items → 4 capacity releases (2 per key).
    dispatcher.registerDAG(makeReservoirDag('reservoir-exactonce', 'key', 5));

    const state = new ReservoirState();
    for (let i = 0; i < 10; i++) state.items.push({ 'key': 'p', 'value': i });
    for (let i = 0; i < 10; i++) state.items.push({ 'key': 'q', 'value': i + 10 });

    const result = await dispatcher.execute('reservoir-exactonce', state);
    assert.equal(result.cursor, null);
    assert.equal(result.state.gathered.length, 20, `expected 20 gathered, got ${result.state.gathered.length}`);

    // No duplicates: every value 0–19 appears exactly once.
    const values = result.state.gathered.map((g) => g.value).sort((a, b) => a - b);
    for (let i = 0; i < 20; i++) {
      assert.equal(values[i], i, `value ${i} missing or duplicate in gathered output`);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 5 — crash-safe resume
// ---------------------------------------------------------------------------

void describe('Reservoir scatter — crash-safe resume', () => {
  void it('resumes after mid-run crash without item loss or double-fold', async () => {
    // ── Phase 1: run with crash after 2 batches ─────────────────────────────
    const dispatcher1 = new Dagonizer<ReservoirState>();
    let batchCount1 = 0;

    const crashingNode: NodeInterface<ReservoirState> = {
      'name':     'worker',
      'outputs':  ['success'] as const,
      'contract': EMPTY_CONTRACT_FRAGMENT,
      'timeout':  Timeout.none(),
      async execute(
        batch: Batch<ReservoirState>,
        _ctx: NodeContextInterface,
      ): Promise<RoutedBatch<string, ReservoirState>> {
        batchCount1++;
        if (batchCount1 === 3) throw new Error('simulated crash on third batch');
        return new Map([['success', batch]]);
      },
    };

    dispatcher1.registerNode(crashingNode);
    // 3 keys × 5 items, capacity 5 → 3 capacity releases (one crashes).
    dispatcher1.registerDAG(makeReservoirDag('reservoir-crash', 'key', 5));

    const state1 = new ReservoirState();
    for (let i = 0; i < 5; i++) state1.items.push({ 'key': 'a', 'value': i });
    for (let i = 0; i < 5; i++) state1.items.push({ 'key': 'b', 'value': i + 5 });
    for (let i = 0; i < 5; i++) state1.items.push({ 'key': 'c', 'value': i + 10 });

    const partial = await dispatcher1.execute('reservoir-crash', state1);
    // Crashed → cursor preserved on 'fan'.
    assert.equal(partial.cursor, 'fan');
    // 2 batches acked before crash → 10 items gathered.
    assert.equal(partial.state.gathered.length, 10,
      `expected 10 gathered after crash, got ${partial.state.gathered.length}`);

    // Checkpoint must have survived.
    const stored = partial.state.getMetadata<Record<string, ScatterProgress>>(SCATTER_PROGRESS_KEY);
    assert.ok(stored !== undefined, 'expected checkpoint metadata after crash');

    // ── Phase 2: resume ──────────────────────────────────────────────────────
    const dispatcher2 = new Dagonizer<ReservoirState>();

    dispatcher2.registerNode(PASSTHROUGH_NODE);
    dispatcher2.registerDAG(makeReservoirDag('reservoir-crash', 'key', 5));

    const result = await dispatcher2.resume('reservoir-crash', partial.state, 'fan');
    assert.equal(result.cursor, null);

    // All 15 items gathered exactly once.
    assert.equal(result.state.gathered.length, 15,
      `expected 15 total gathered, got ${result.state.gathered.length}`);

    // No duplicates: values 0–14 each appear exactly once.
    const values = result.state.gathered.map((g) => g.value).sort((a, b) => a - b);
    for (let i = 0; i < 15; i++) {
      assert.equal(values[i], i, `wrong value at position ${i}: ${values[i]}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 6 — no-reservoir parity (ScatterWorkerPool still fires batch-size-1)
// ---------------------------------------------------------------------------

void describe('Reservoir scatter — no-reservoir parity', () => {
  void it('scatter without reservoir fires per-item (batch-size-1)', async () => {
    const dispatcher = new Dagonizer<ReservoirState>();
    const batchSizes: number[] = [];

    dispatcher.registerNode(makeBatchTrackingNode(batchSizes));

    // No `reservoir` field → non-reservoir path (ScatterWorkerPool).
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:no-reservoir',
      '@type':    'DAG',
      'name': 'no-reservoir', 'version': '1', 'entrypoint': 'fan',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:no-reservoir/node/fan',
          '@type':  'ScatterNode',
          'name':   'fan',
          'body':   { 'node': 'worker' },
          'source': 'items',
          'itemKey': 'currentItem',
          'gather': { 'strategy': 'append', 'target': 'gathered' },
          'outputs': {
            'all-success': 'end',
            'partial':     'end',
            'all-error':   'end',
            'empty':       'end',
          },
        },
        {
          '@id':    'urn:noocodex:dag:no-reservoir/node/end',
          '@type':  'TerminalNode',
          'name':   'end',
          'outcome': 'completed',
        },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new ReservoirState();
    for (let i = 0; i < 10; i++) state.items.push({ 'key': 'k', 'value': i });

    const result = await dispatcher.execute('no-reservoir', state);
    assert.equal(result.cursor, null);
    // Non-reservoir: 10 items → 10 execute calls each with batch.size === 1.
    assert.equal(batchSizes.length, 10, `expected 10 execute calls, got ${batchSizes.length}`);
    for (const size of batchSizes) {
      assert.equal(size, 1, `expected batch size 1, got ${size}`);
    }
    assert.equal(result.state.gathered.length, 10);
  });
});
