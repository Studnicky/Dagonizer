/**
 * Reservoir scatter tests.
 *
 * The `append` gather strategy (used throughout) appends `record.item` — the
 * source element — into the parent state's target field. Nodes in these tests
 * do NOT manually write to `gathered`; the gather fold owns that.
 *
 * `gathered` is typed as `ReservoirItem[]` because the scatter source is
 * `items: ReservoirItem[]` and the append strategy appends each item as-is.
 *
 * Idle-release tests (the final group) verify the `idleMs` trigger using
 * `VirtualScheduler` for deterministic time control.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import type { ReservoirDriverInterface, ScatterItemBatchResultType } from '../../src/contracts/ReservoirDriver.js';
import type { StateAccessorInterface } from '../../src/contracts/StateAccessorInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import type { RoutedBatchType } from '../../src/entities/batch/RoutedBatchType.js';
import { SCATTER_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import { JsonValue } from '../../src/entities/JsonValue.js';
import { ReservoirBuffer } from '../../src/execution/ReservoirBuffer.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { DottedPathAccessor } from '../../src/runtime/DottedPathAccessor.js';
import { Scheduler } from '../../src/runtime/Scheduler.js';
import { VirtualScheduler } from '../../testing/VirtualScheduler.js';

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

  protected override snapshotData(): JsonObjectType {
    return {
      'items':    JsonValue.from(this.items),
      'gathered': JsonValue.from(this.gathered),
    };
  }

  protected override restoreData(snap: JsonObjectType): void {
    const items = snap['items'];
    if (Array.isArray(items)) {
      this.items = items.filter(
        (x): x is ReservoirItem =>
          typeof x === 'object' && x !== null && !Array.isArray(x) &&
          typeof x['key'] === 'string' && typeof x['value'] === 'number',
      );
    }
    const gathered = snap['gathered'];
    if (Array.isArray(gathered)) {
      this.gathered = gathered.filter(
        (x): x is ReservoirItem =>
          typeof x === 'object' && x !== null && !Array.isArray(x) &&
          typeof x['key'] === 'string' && typeof x['value'] === 'number',
      );
    }
  }
}

/** Builds reservoir DAGs for tests. */
class ReservoirDag {
  private constructor() {}

  static withCapacity(dagName: string, keyField: string, capacity: number): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${dagName}`,
      '@type':    'DAG',
      'name': dagName, 'version': '1', 'entrypoints': { 'main': 'fan' },
      'nodes': [
        {
          '@id':    `urn:noocodex:dag:${dagName}/node/fan`,
          '@type':  'ScatterNode',
          'name':   'fan',
          'body':   { 'node': 'worker' },
          'source': 'items',
          'itemKey': 'currentItem',
          'execution': { 'mode': 'reservoir', 'reservoir': { keyField, 'capacity': capacity } },
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
}

/**
 * Build a batch-tracking node that records per-execute batch sizes.
 *
 * The node does NOT write to `gathered` — the gather strategy handles that.
 */
class BatchTrackingNode extends MonadicNode<ReservoirState, string> {
  override readonly name = 'worker';
  override readonly outputs: readonly string[] = ['success'];

  override get outputSchema(): Record<string, SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  constructor(private readonly batchSizes: number[]) {
    super();
  }

  override async execute(batch: Batch<ReservoirState>): Promise<RoutedBatchType<string, ReservoirState>> {
    this.batchSizes.push(batch.size);
    return new Map([['success', batch]]);
  }
}

/** Type guard for ReservoirItem shape read from metadata. */
class ReservoirItemGuard {
  private constructor() {}

  static is(v: unknown): v is ReservoirItem {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    const key = Reflect.get(v, 'key');
    const value = Reflect.get(v, 'value');
    return typeof key === 'string' && typeof value === 'number';
  }
}

/** Passthrough node — routes everything to 'success'. No state mutation. */
class PassthroughNode extends MonadicNode<ReservoirState, string> {
  override readonly name = 'worker';
  override readonly outputs: readonly string[] = ['success'];

  override get outputSchema(): Record<string, SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ReservoirState>): Promise<RoutedBatchType<string, ReservoirState>> {
    return new Map([['success', batch]]);
  }
}

const PASSTHROUGH_NODE = new PassthroughNode();

// ---------------------------------------------------------------------------
// Test 1 — capacity release
// ---------------------------------------------------------------------------

void describe('Reservoir scatter — capacity release', () => {
  void it('dispatches exactly capacity-sized batches', async () => {
    const dispatcher = new Dagonizer<ReservoirState>();
    const batchSizes: number[] = [];

    dispatcher.registerNode(new BatchTrackingNode(batchSizes));
    dispatcher.registerDAG(ReservoirDag.withCapacity('reservoir-capacity', 'key', 100));

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

class KeyedPartitionNode extends MonadicNode<ReservoirState, string> {
  override readonly name = 'worker';
  override readonly outputs: readonly string[] = ['success'];

  override get outputSchema(): Record<string, SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  constructor(private readonly batchesByKey: Map<string, ReservoirItem[][]>) {
    super();
  }

  override async execute(batch: Batch<ReservoirState>): Promise<RoutedBatchType<string, ReservoirState>> {
    // Collect the items from this batch to verify no cross-key mixing.
    const keys = new Set<string>();
    const batchItems: ReservoirItem[] = [];
    for (const batchItem of batch) {
      const raw = batchItem.state.getMetadata('currentItem');
      if (ReservoirItemGuard.is(raw)) {
        keys.add(raw.key);
        batchItems.push(raw);
      }
    }
    // All items in one reservoir batch must share the same key.
    assert.equal(keys.size, 1, `batch contained mixed keys: ${[...keys].join(', ')}`);
    const batchKey = [...keys][0];
    assert.ok(batchKey !== undefined, 'batch must contain at least one key');
    const existing = this.batchesByKey.get(batchKey);
    if (existing !== undefined) {
      existing.push(batchItems);
    } else {
      this.batchesByKey.set(batchKey, [batchItems]);
    }
    return new Map([['success', batch]]);
  }
}

void describe('Reservoir scatter — keyed partitioning', () => {
  void it('releases one batch per key with no cross-key items', async () => {
    const dispatcher = new Dagonizer<ReservoirState>();
    const batchesByKey = new Map<string, ReservoirItem[][]>();

    const node = new KeyedPartitionNode(batchesByKey);

    dispatcher.registerNode(node);
    dispatcher.registerDAG(ReservoirDag.withCapacity('reservoir-keyed', 'key', 100));

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
      assert.equal(batches[0]?.length, 100);
    }
    assert.equal(result.state.gathered.length, 300);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — complete-flush (partial batches flushed when source drains)
// ---------------------------------------------------------------------------

class ExecuteCounterNode extends MonadicNode<ReservoirState, string> {
  override readonly name = 'worker';
  override readonly outputs: readonly string[] = ['success'];

  override get outputSchema(): Record<string, SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  constructor(private readonly calls: { n: number }) {
    super();
  }

  override async execute(batch: Batch<ReservoirState>): Promise<RoutedBatchType<string, ReservoirState>> {
    this.calls.n++;
    return new Map([['success', batch]]);
  }
}

void describe('Reservoir scatter — complete-flush', () => {
  void it('flushes partial key buffers when source is exhausted', async () => {
    const dispatcher = new Dagonizer<ReservoirState>();
    const calls = { 'n': 0 };

    const node = new ExecuteCounterNode(calls);

    dispatcher.registerNode(node);
    // capacity 100, but only 50 items per key → complete-flush fires at drain.
    dispatcher.registerDAG(ReservoirDag.withCapacity('reservoir-flush', 'key', 100));

    const state = new ReservoirState();
    // 3 keys × 50 items = 150 total (all below capacity of 100).
    for (let i = 0; i < 50; i++) state.items.push({ 'key': 'x', 'value': i });
    for (let i = 0; i < 50; i++) state.items.push({ 'key': 'y', 'value': i + 50 });
    for (let i = 0; i < 50; i++) state.items.push({ 'key': 'z', 'value': i + 100 });

    const result = await dispatcher.execute('reservoir-flush', state);
    assert.equal(result.cursor, null);
    // One execute call per key (3 partial batches at complete-flush).
    assert.equal(calls.n, 3, `expected 3 execute calls, got ${calls.n}`);
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

    dispatcher.registerNode(new BatchTrackingNode(batchSizes));
    // capacity 5, 2 keys × 10 items → 4 capacity releases (2 per key).
    dispatcher.registerDAG(ReservoirDag.withCapacity('reservoir-exactonce', 'key', 5));

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

class CrashingNode extends MonadicNode<ReservoirState, string> {
  override readonly name = 'worker';
  override readonly outputs: readonly string[] = ['success'];

  override get outputSchema(): Record<string, SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  constructor(private readonly crash: { n: number }) {
    super();
  }

  override async execute(batch: Batch<ReservoirState>): Promise<RoutedBatchType<string, ReservoirState>> {
    this.crash.n++;
    if (this.crash.n === 3) throw new Error('simulated crash on third batch');
    return new Map([['success', batch]]);
  }
}

void describe('Reservoir scatter — crash-safe resume', () => {
  void it('resumes after mid-run crash without item loss or double-fold', async () => {
    // ── Phase 1: run with crash after 2 batches ─────────────────────────────
    const dispatcher1 = new Dagonizer<ReservoirState>();
    const crash = { 'n': 0 };

    const crashingNode = new CrashingNode(crash);

    dispatcher1.registerNode(crashingNode);
    // 3 keys × 5 items, capacity 5 → 3 capacity releases (one crashes).
    dispatcher1.registerDAG(ReservoirDag.withCapacity('reservoir-crash', 'key', 5));

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
    const stored = partial.state.getMetadata(SCATTER_PROGRESS_KEY);
    assert.ok(stored !== undefined, 'expected checkpoint metadata after crash');

    // ── Phase 2: resume ──────────────────────────────────────────────────────
    const dispatcher2 = new Dagonizer<ReservoirState>();

    dispatcher2.registerNode(PASSTHROUGH_NODE);
    dispatcher2.registerDAG(ReservoirDag.withCapacity('reservoir-crash', 'key', 5));

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

    dispatcher.registerNode(new BatchTrackingNode(batchSizes));

    // No `reservoir` field → non-reservoir path (ScatterWorkerPool).
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:no-reservoir',
      '@type':    'DAG',
      'name': 'no-reservoir', 'version': '1', 'entrypoints': { 'main': 'fan' },
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

// ---------------------------------------------------------------------------
// Idle-release helpers
// ---------------------------------------------------------------------------

/** Yield to the microtask / setImmediate queue. */
class Tick {
  private constructor() {}

  static next(): Promise<void> {
    return new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Item shape used by the idle tests. */
type IdleItem = { key: string; value: number };

type DeferredHandle<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject:  (reason: unknown) => void;
};

class Deferred {
  private constructor() {}

  static of<T>(): DeferredHandle<T> {
    let resolveRef: ((value: T) => void) | undefined;
    let rejectRef:  ((reason: unknown) => void) | undefined;
    const promise = new Promise<T>((res, rej) => { resolveRef = res; rejectRef = rej; });
    if (resolveRef === undefined || rejectRef === undefined) {
      throw new Error('Promise executor did not run synchronously');
    }
    return { promise, "resolve": resolveRef, "reject": rejectRef };
  }
}

/** Async iterator that yields items then parks on a gate deferred. */
class ControlledSource {
  private constructor() {}

  static of(items: IdleItem[], gate: DeferredHandle<void>): AsyncIterator<unknown> {
    let index = 0;
    return {
      async next(): Promise<IteratorResult<unknown>> {
        if (index < items.length) {
          return { 'value': items[index++], 'done': false };
        }
        await gate.promise;
        return { 'value': undefined, 'done': true };
      },
    };
  }
}

/** Fake reservoir driver that records released batches as `{ size, key }`. */
class FakeDriver {
  private constructor() {}

  static recording(releases: { size: number; key: string }[]): ReservoirDriverInterface {
    return {
      async executeBatch(items): Promise<ScatterItemBatchResultType> {
        const first = items[0];
        const bufferKey = (first !== undefined && typeof Reflect.get(first, 'bufferKey') === 'string')
          ? String(Reflect.get(first, 'bufferKey'))
          : '';
        releases.push({ 'size': items.length, 'key': bufferKey });
        return {
          'results': items.map((it) => ({
            'index':           it.index,
            'item':            it.item,
            'output':          'success',
            'terminalOutcome': null,
            'cloneState':      new NodeStateBase(),
            'selectedDagIri':  null,
          })),
        };
      },
      async ackBatch(_batchResult): Promise<void> {
        // No-op for unit tests — no real checkpoint needed.
      },
    };
  }
}

/** Simple `StateAccessorInterface` that reads/writes a top-level property on a plain object. */
const accessor: StateAccessorInterface = new DottedPathAccessor();

// ---------------------------------------------------------------------------
// Test 7 — idle releases a partial buffer
// ---------------------------------------------------------------------------

void describe('Reservoir scatter — idle release (partial buffer)', () => {
  afterEach(() => { Scheduler.reset(); });

  void it('releases a partial key buffer after idleMs with no new items', async () => {
    const sched = new VirtualScheduler();
    Scheduler.configure(sched);

    const IDLE_MS  = 100;
    const CAPACITY = 5;
    const ITEM_COUNT = 3; // below capacity; must be released by idle, not capacity or complete-flush

    const items: IdleItem[] = [];
    for (let i = 0; i < ITEM_COUNT; i++) items.push({ 'key': 'k', 'value': i });

    const gate = Deferred.of<void>();
    const releases: { size: number; key: string }[] = [];

    const buf = new ReservoirBuffer(
      FakeDriver.recording(releases),
      {
        'concurrencyLimit': 10,
        'inbox':            [],
        'freshIter':        ControlledSource.of(items, gate),
        'nextIndex':        0,
        'signal':           null,
        'reservoir':        { 'keyField': 'key', 'capacity': CAPACITY, 'idleMs': IDLE_MS },
        accessor,
      },
    );

    const drainPromise = buf.drain();

    // Each `await freshIter.next()` costs at least one microtask turn.
    // ITEM_COUNT=3 items → 3 awaits + 1 final await that blocks.
    // 8 ticks lets those pulls complete and the idle timer register.
    for (let i = 0; i < 8; i++) await Tick.next();

    assert.ok(sched.pendingCount >= 1, `expected idle timer to be registered; pending=${sched.pendingCount}`);

    // Advance past idleMs — fires the idle timer, resolving the .after() promise.
    sched.advance(IDLE_MS + 1);

    // Flush the .then(() => #onIdle(…)) microtask.
    await Tick.next();
    await Tick.next();

    // Open the gate so the source returns done: true.
    gate.resolve();

    // Let the pull loop exit, abort idleAbort, run complete-flush (empty buffer).
    for (let i = 0; i < 6; i++) await Tick.next();

    await drainPromise;

    // Exactly one release: the idle batch of ITEM_COUNT items.
    assert.equal(releases.length, 1, `expected 1 release (idle), got ${releases.length}`);
    assert.equal(releases[0]?.size, ITEM_COUNT, `expected batch size ${ITEM_COUNT}, got ${releases[0]?.size}`);
    assert.equal(releases[0]?.key, 'k');
  });
});

// ---------------------------------------------------------------------------
// Test 8 — idle timer invalidated by capacity release
// ---------------------------------------------------------------------------

void describe('Reservoir scatter — idle timer invalidated by capacity release', () => {
  afterEach(() => { Scheduler.reset(); });

  void it('does not double-release when capacity fires before idleMs elapses', async () => {
    const sched = new VirtualScheduler();
    Scheduler.configure(sched);

    const IDLE_MS  = 200;
    const CAPACITY = 3;

    // Push exactly CAPACITY items for the same key. The third item triggers a
    // capacity release which bumps the generation, invalidating the idle timer.
    const items: IdleItem[] = [];
    for (let i = 0; i < CAPACITY; i++) items.push({ 'key': 'k', 'value': i });

    const gate = Deferred.of<void>();
    const releases: { size: number; key: string }[] = [];

    const buf = new ReservoirBuffer(
      FakeDriver.recording(releases),
      {
        'concurrencyLimit': 10,
        'inbox':            [],
        'freshIter':        ControlledSource.of(items, gate),
        'nextIndex':        0,
        'signal':           null,
        'reservoir':        { 'keyField': 'key', 'capacity': CAPACITY, 'idleMs': IDLE_MS },
        accessor,
      },
    );

    const drainPromise = buf.drain();

    // Wait for pull loop to drain all CAPACITY items and block on gate.
    for (let i = 0; i < 8; i++) await Tick.next();

    // The capacity release bumps the key's generation, so a later idle timer is
    // stale: advancing past idleMs fires it but #onIdle no-ops (no double-release).
    sched.advance(IDLE_MS + 1);
    await Tick.next();
    sched.runAll();
    await Tick.next();

    // Open the gate.
    gate.resolve();
    for (let i = 0; i < 6; i++) await Tick.next();
    await drainPromise;

    // Exactly one release: the capacity release. No second (empty) release.
    assert.equal(releases.length, 1, `expected 1 release (capacity), got ${releases.length}`);
    assert.equal(releases[0]?.size, CAPACITY, `expected batch size ${CAPACITY}, got ${releases[0]?.size}`);
  });
});

// ---------------------------------------------------------------------------
// Test 9 — no idleMs means no idle timers registered
// ---------------------------------------------------------------------------

void describe('Reservoir scatter — no idleMs, no idle timers', () => {
  afterEach(() => { Scheduler.reset(); });

  void it('registers no idle timers in the VirtualScheduler when idleMs is absent', async () => {
    const sched = new VirtualScheduler();
    Scheduler.configure(sched);

    const CAPACITY = 5;
    const items: IdleItem[] = [
      { 'key': 'k', 'value': 0 },
      { 'key': 'k', 'value': 1 },
      { 'key': 'k', 'value': 2 },
    ];

    const gate = Deferred.of<void>();
    const releases: { size: number; key: string }[] = [];

    // No idleMs — complete-flush only.
    const buf = new ReservoirBuffer(
      FakeDriver.recording(releases),
      {
        'concurrencyLimit': 10,
        'inbox':            [],
        'freshIter':        ControlledSource.of(items, gate),
        'nextIndex':        0,
        'signal':           null,
        'reservoir':        { 'keyField': 'key', 'capacity': CAPACITY, 'idleMs': null },
        accessor,
      },
    );

    const drainPromise = buf.drain();

    // Wait for pull loop to drain all items and block on gate.
    for (let i = 0; i < 8; i++) await Tick.next();

    // No idle timers should be registered.
    assert.equal(sched.pendingCount, 0, `expected 0 idle timers; got ${sched.pendingCount}`);

    // Advance a lot — nothing should fire.
    sched.advance(999_999);
    await Tick.next();

    // Open gate → complete-flush fires.
    gate.resolve();
    for (let i = 0; i < 6; i++) await Tick.next();
    await drainPromise;

    // Complete-flush fires exactly one batch of 3 items.
    assert.equal(releases.length, 1, `expected 1 release (complete-flush), got ${releases.length}`);
    assert.equal(releases[0]?.size, 3, `expected batch size 3, got ${releases[0]?.size}`);
  });
});
