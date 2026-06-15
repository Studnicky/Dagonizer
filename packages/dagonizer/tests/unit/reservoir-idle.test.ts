/**
 * Reservoir idle-release tests (RFC 0002 §3 / RFC 0003 sub-wave 3b).
 *
 * When `reservoir.idleMs` is set, a key whose buffer is non-empty and has
 * received no new item for `idleMs` releases its partial batch even if capacity
 * has not been reached (idle release). These tests verify that behaviour using
 * `VirtualScheduler` for deterministic time control.
 *
 * UNIT-TEST STRATEGY:
 * Tests construct `ReservoirBuffer` directly with a hand-crafted async
 * iterator and a fake `ReservoirDriverInterface`. This avoids the full
 * Dagonizer engine and gives precise control over when the source yields
 * `done: true` — which is critical for parking the pull loop at a known
 * `await freshIter.next()` while the VirtualScheduler advances virtual time.
 *
 * DETERMINISM PATTERN:
 *   1. Source emits N items then blocks on a `deferred` Promise.
 *   2. After `await tick()` yields enough times for the pull loop to park on
 *      the deferred, `sched.advance(idleMs + 1)` fires the idle timer.
 *   3. `await tick()` flushes the `.then(() => #onIdle(…))` microtask.
 *   4. Resolve the deferred → source returns `done: true`.
 *   5. `await tick()` lets the pull loop exit, triggering idleAbort and
 *      complete-flush (which finds an empty buffer).
 *   6. `await drainPromise` confirms successful completion.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { ReservoirDriverInterface, ScatterItemBatchResult } from '../../src/execution/ReservoirBuffer.js';
import { ReservoirBuffer } from '../../src/execution/ReservoirBuffer.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Scheduler } from '../../src/runtime/Scheduler.js';
import { VirtualScheduler } from '../../testing/VirtualScheduler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Yield to the microtask / setImmediate queue — same pattern as node-timeout.test.ts. */
const tick = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

/** Item shape used across all idle tests. */
type IdleItem = { key: string; value: number };

/**
 * A deferred: a Promise whose resolve/reject are exposed for external control.
 * Used to park the async source iterator at a known point.
 */
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject:  (reason: unknown) => void;
};

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!:  (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * Build an async iterator that yields `items` synchronously then parks on a
 * deferred before returning `done: true`. This lets tests advance virtual time
 * while the pull loop is blocked waiting for the "next" item.
 */
function makeControlledSource(items: IdleItem[], gate: Deferred<void>): AsyncIterator<unknown> {
  let index = 0;
  return {
    async next(): Promise<IteratorResult<unknown>> {
      if (index < items.length) {
        return { 'value': items[index++], 'done': false };
      }
      // Block on the gate until the test resolves it.
      await gate.promise;
      return { 'value': undefined, 'done': true };
    },
  };
}

/**
 * Build a simple fake driver that records released batches and their sizes.
 * Items carry `bufferKey` — we record the batch as `{ size, key }`.
 */
function makeFakeDriver(releases: { size: number; key: string }[]): ReservoirDriverInterface<NodeStateBase> {
  return {
    async executeBatch(items): Promise<ScatterItemBatchResult<NodeStateBase>> {
      const key = String((items[0] as { bufferKey: string } | undefined)?.bufferKey ?? '');
      releases.push({ 'size': items.length, key });
      // Return a minimal result for each item using the correct ScatterItemResult shape.
      return {
        'results': items.map((it) => ({
          'index':          it.index,
          'item':           it.item,
          'output':         'success',
          'terminalOutcome': null,
          'cloneState':     new NodeStateBase(),
        })),
      };
    },
    async ackBatch(_batchResult): Promise<void> {
      // No-op for unit tests — no real checkpoint needed.
    },
  };
}

/** Simple accessor that reads a top-level property from a plain object. */
const accessor = {
  get(obj: unknown, path: string): unknown {
    if (obj !== null && typeof obj === 'object' && path in (obj as Record<string, unknown>)) {
      return (obj as Record<string, unknown>)[path];
    }
    return undefined;
  },
};

// ---------------------------------------------------------------------------
// Test 1 — idle releases a partial buffer
// ---------------------------------------------------------------------------

void describe('Reservoir idle — idle releases a partial buffer', () => {
  afterEach(() => { Scheduler.reset(); });

  void it('releases a partial key buffer after idleMs with no new items', async () => {
    const sched = new VirtualScheduler();
    Scheduler.configure(sched);

    const IDLE_MS  = 100;
    const CAPACITY = 5;
    const ITEM_COUNT = 3; // below capacity; must be released by idle, not capacity or complete-flush

    const items: IdleItem[] = [];
    for (let i = 0; i < ITEM_COUNT; i++) items.push({ 'key': 'k', 'value': i });

    // Gate: controls when the source returns done: true.
    const gate = makeDeferred<void>();
    const releases: { size: number; key: string }[] = [];

    const buf = new ReservoirBuffer<NodeStateBase>(
      makeFakeDriver(releases),
      {
        'concurrencyLimit': 10,
        'inbox':            [],
        'freshIter':        makeControlledSource(items, gate),
        'nextIndex':        0,
        'signal':           null,
        'reservoir':        { 'keyField': 'key', 'capacity': CAPACITY, 'idleMs': IDLE_MS },
        accessor,
      },
    );

    const drainPromise = buf.drain();

    // The pull loop pulls ITEM_COUNT items (each is an async next() that
    // resolves immediately via Promise.resolve), then blocks on the gate.
    // We need enough ticks to let those pulls complete and the idle timer register.
    //
    // Each `await freshIter.next()` costs at least one microtask turn.
    // ITEM_COUNT=3 items → 3 awaits + 1 final await that blocks. We use 8
    // ticks to be safe (setImmediate drains the full microtask queue each time).
    for (let i = 0; i < 8; i++) await tick();

    // The idle timer for key 'k' must now be registered in the VirtualScheduler.
    assert.ok(sched.pendingCount >= 1, `expected idle timer to be registered; pending=${sched.pendingCount}`);

    // Advance past idleMs — fires the idle timer, resolving the .after() promise.
    sched.advance(IDLE_MS + 1);

    // Flush the .then(() => #onIdle(…)) microtask so #spawnBatchWorker is called.
    await tick();
    await tick();

    // The idle release fired. Now open the gate so the source returns done: true.
    gate.resolve();

    // Let the pull loop exit (sees done: true), abort idleAbort, run complete-flush
    // (empty buffer), wait for workers, and resolve drain().
    for (let i = 0; i < 6; i++) await tick();

    // drain() must have settled by now.
    await drainPromise;

    // Exactly one release: the idle batch of ITEM_COUNT items.
    assert.equal(releases.length, 1, `expected 1 release (idle), got ${releases.length}`);
    assert.equal(releases[0]?.size, ITEM_COUNT, `expected batch size ${ITEM_COUNT}, got ${releases[0]?.size}`);
    assert.equal(releases[0]?.key, 'k');
  });
});

// ---------------------------------------------------------------------------
// Test 2 — idle timer invalidated by a later item / capacity release
// ---------------------------------------------------------------------------

void describe('Reservoir idle — idle timer invalidated by capacity release', () => {
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

    const gate = makeDeferred<void>();
    const releases: { size: number; key: string }[] = [];

    const buf = new ReservoirBuffer<NodeStateBase>(
      makeFakeDriver(releases),
      {
        'concurrencyLimit': 10,
        'inbox':            [],
        'freshIter':        makeControlledSource(items, gate),
        'nextIndex':        0,
        'signal':           null,
        'reservoir':        { 'keyField': 'key', 'capacity': CAPACITY, 'idleMs': IDLE_MS },
        accessor,
      },
    );

    const drainPromise = buf.drain();

    // Wait for pull loop to drain all CAPACITY items and block on gate.
    for (let i = 0; i < 8; i++) await tick();

    // Advance PAST idleMs. The idle timer's generation was bumped on capacity
    // release, so #onIdle is a no-op even if the timer fires.
    sched.advance(IDLE_MS + 1);
    await tick();
    sched.runAll();
    await tick();

    // Open the gate.
    gate.resolve();
    for (let i = 0; i < 6; i++) await tick();
    await drainPromise;

    // Exactly one release: the capacity release. No second (empty) release.
    assert.equal(releases.length, 1, `expected 1 release (capacity), got ${releases.length}`);
    assert.equal(releases[0]?.size, CAPACITY, `expected batch size ${CAPACITY}, got ${releases[0]?.size}`);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — no idleMs = no idle timers registered
// ---------------------------------------------------------------------------

void describe('Reservoir idle — no idleMs means no idle timers', () => {
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

    const gate = makeDeferred<void>();
    const releases: { size: number; key: string }[] = [];

    // No idleMs — complete-flush only.
    const buf = new ReservoirBuffer<NodeStateBase>(
      makeFakeDriver(releases),
      {
        'concurrencyLimit': 10,
        'inbox':            [],
        'freshIter':        makeControlledSource(items, gate),
        'nextIndex':        0,
        'signal':           null,
        'reservoir':        { 'keyField': 'key', 'capacity': CAPACITY },
        accessor,
      },
    );

    const drainPromise = buf.drain();

    // Wait for pull loop to drain all items and block on gate.
    for (let i = 0; i < 8; i++) await tick();

    // No idle timers should be registered.
    assert.equal(sched.pendingCount, 0, `expected 0 idle timers; got ${sched.pendingCount}`);

    // Advance a lot — nothing should fire (no timers registered).
    sched.advance(999_999);
    await tick();

    // Open gate → complete-flush fires.
    gate.resolve();
    for (let i = 0; i < 6; i++) await tick();
    await drainPromise;

    // Complete-flush fires exactly one batch of 3 items.
    assert.equal(releases.length, 1, `expected 1 release (complete-flush), got ${releases.length}`);
    assert.equal(releases[0]?.size, 3, `expected batch size 3, got ${releases[0]?.size}`);
  });
});
