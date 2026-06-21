import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RemoteStoreEndpointType } from '../../src/contracts/RemoteStoreEndpoint.js';
import type { RemoteStoreInterface } from '../../src/contracts/RemoteStoreInterface.js';
import type { RemoteStoreLeaseType } from '../../src/contracts/RemoteStoreLease.js';
import type { StoreSnapshotEntryType } from '../../src/contracts/SnapshottableInterface.js';
import type { JsonValueType } from '../../src/entities/json.js';
import { BaseStore, type BaseStoreOptionsType } from '../../src/store/BaseStore.js';
import { MemoryStore } from '../../src/store/MemoryStore.js';
import { StoreError, type StoreErrorClassificationType } from '../../src/store/StoreError.js';
import { TypedStore } from '../../src/store/TypedStore.js';

// ── Minimum-viable test plugin ──────────────────────────────────────────────
//
// PassThroughStore extends BaseStore against a plain Record<string, unknown>.
// Exercises every protected abstract method to lock the plugin surface.

class PassThroughStore extends BaseStore {
  readonly #backing: Record<string, JsonValueType>;

  constructor(backing: Record<string, JsonValueType>, options: BaseStoreOptionsType = { 'namespace': '' }) {
    super(options);
    this.#backing = backing;
  }

  protected get snapshotType(): string    { return 'pass-through-store'; }
  protected get snapshotVersion(): number { return 1; }

  protected async performGet(key: string): Promise<JsonValueType | null> {
    const value = this.#backing[key];
    return value === undefined ? null : value;
  }

  protected async performSet(key: string, value: JsonValueType): Promise<void> {
    this.#backing[key] = value;
  }

  protected async performHas(key: string): Promise<boolean> {
    return Object.prototype.hasOwnProperty.call(this.#backing, key);
  }

  protected async performDelete(key: string): Promise<boolean> {
    if (!Object.prototype.hasOwnProperty.call(this.#backing, key)) return false;
    Reflect.deleteProperty(this.#backing, key);
    return true;
  }

  protected async performSnapshotEntries(): Promise<readonly StoreSnapshotEntryType[]> {
    return Object.entries(this.#backing).map(([key, value]) => ({
      'key':   key,
      'value': value,
    }));
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntryType[]): Promise<void> {
    for (const key of Object.keys(this.#backing)) {
      Reflect.deleteProperty(this.#backing, key);
    }
    for (const { key, value } of entries) {
      this.#backing[key] = value;
    }
  }

  /**
   * Non-atomic RMW via the `performUpdateRmw` helper. Acceptable for this
   * test-only store: the backing is an in-memory record with no concurrency
   * guarantees, so the default sequential RMW is sufficient.
   */
  override async update<T extends JsonValueType>(key: string, fn: (current: T | undefined) => T): Promise<T> {
    return this.performUpdateRmw(key, fn);
  }
}

// ── MockRemoteStore ─────────────────────────────────────────────────────────
//
// Minimal no-op implementation. Purpose: prove the RemoteStoreInterface contract is
// fully implementable; no production behavior required.

class MockRemoteStore extends BaseStore implements RemoteStoreInterface {
  readonly endpoint: RemoteStoreEndpointType;

  readonly #backing: Map<string, JsonValueType>;

  constructor(endpoint: RemoteStoreEndpointType, options: BaseStoreOptionsType = { 'namespace': '' }) {
    super(options);
    this.endpoint = endpoint;
    this.#backing = new Map();
  }

  // ── BaseStore abstract hooks ────────────────────────────────────────────

  protected get snapshotType(): string    { return 'mock-remote-store-v1'; }
  protected get snapshotVersion(): number { return 1; }

  protected async performGet(key: string): Promise<JsonValueType | null> {
    const value = this.#backing.get(key);
    return value === undefined ? null : value;
  }

  protected async performSet(key: string, value: JsonValueType): Promise<void> {
    this.#backing.set(key, value);
  }

  protected async performHas(key: string): Promise<boolean> {
    return this.#backing.has(key);
  }

  protected async performDelete(key: string): Promise<boolean> {
    return this.#backing.delete(key);
  }

  protected async performSnapshotEntries(): Promise<readonly StoreSnapshotEntryType[]> {
    return [...this.#backing.entries()].map(([key, value]) => ({ key, value }));
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntryType[]): Promise<void> {
    this.#backing.clear();
    for (const { key, value } of entries) {
      this.#backing.set(key, value);
    }
  }

  // Atomic override: Map access is synchronous, no interleaving possible.
  override async update<T extends JsonValueType>(
    key: string,
    fn: (current: T | undefined) => T,
  ): Promise<T> {
    const qualified = this.qualifyKey(key);
    const raw       = this.narrowStored<T>(this.#backing.get(qualified) ?? null);
    const next      = fn(raw === null ? undefined : raw);
    this.#backing.set(qualified, next);
    return next;
  }

  // ── RemoteStoreInterface-specific methods ────────────────────────────────────────

  async acquireLease(subject: string, ttlMs: number, _maxWaitMs: number): Promise<RemoteStoreLeaseType> {
    return {
      'token':     `mock-token-${subject}`,
      'expiresAt': Date.now() + ttlMs,
      'subject':   subject,
    };
  }

  async releaseLease(_lease: RemoteStoreLeaseType): Promise<void> {
    // no-op; mock never holds state for leases
  }

  async health(_timeoutMs: number): Promise<boolean> {
    return true;
  }
}

// ── Test schema for TypedStore ────────────────────────────────────────────────

type AppSchema = {
  count:   number;
  label:   string;
  tags:    string[];
  config:  { readonly retries: number; readonly timeout: number };
}

// ── MemoryStore tests ───────────────────────────────────────────────────────

void describe('MemoryStore', () => {
  void it('basic get/set/has/delete round-trip', async () => {
    const store = new MemoryStore();
    await store.set('greeting', 'hello');
    assert.equal(await store.get('greeting'), 'hello');
    assert.equal(await store.has('greeting'), true);
    assert.equal(await store.has('missing'), false);
    const deleted = await store.delete('greeting');
    assert.equal(deleted, true);
    assert.equal(await store.has('greeting'), false);
    assert.equal(await store.get('greeting'), null);
  });

  void it('delete returns false for a key that does not exist', async () => {
    const store = new MemoryStore();
    const result = await store.delete('ghost');
    assert.equal(result, false);
  });

  void it('update(key, fn) returns the new value; get() reads the same', async () => {
    const store = new MemoryStore();
    const result = await store.update<number>('counter', (n) => (n ?? 0) + 1);
    assert.equal(result, 1);
    assert.equal(await store.get('counter'), 1);
  });

  void it('concurrent update ops produce no lost writes (JS single-thread guarantee)', async () => {
    const store = new MemoryStore();
    // Both updates start before either resolves. Under single-threaded JS the
    // Map operations inside each update run uninterrupted, so the final value
    // must be 2 (no lost update).
    await Promise.all([
      store.update<number>('k', (n) => (n ?? 0) + 1),
      store.update<number>('k', (n) => (n ?? 0) + 1),
    ]);
    assert.equal(await store.get('k'), 2);
  });

  void it('snapshot() returns typed envelope with correct shape', async () => {
    const store = new MemoryStore();
    await store.set('a', 1);
    await store.set('b', 'two');
    const snap = await store.snapshot();
    assert.equal(snap.version, 1);
    assert.equal(snap.type, 'memory-store');
    // Order is insertion order; sort for deterministic comparison.
    const sorted = [...snap.entries].sort((x, y) => x.key.localeCompare(y.key));
    assert.deepEqual(sorted, [
      { 'key': 'a', 'value': 1 },
      { 'key': 'b', 'value': 'two' },
    ]);
  });

  void it('restore() repopulates a fresh MemoryStore from a captured snapshot', async () => {
    const source = new MemoryStore();
    await source.set('x', 42);
    await source.set('y', [1, 2, 3]);
    const snap = await source.snapshot();

    const target = new MemoryStore();
    await target.restore(snap);
    assert.equal(await target.get('x'), 42);
    assert.deepEqual(await target.get('y'), [1, 2, 3]);
  });

  void it('restore() with wrong type throws StoreError INCOMPATIBLE_SNAPSHOT', async () => {
    const store = new MemoryStore();
    const badSnap = { 'version': 1, 'type': 'not-memory-store', 'entries': [] };
    await assert.rejects(
      () => store.restore(badSnap),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
        assert.equal(err.classification.reason === 'INCOMPATIBLE_SNAPSHOT' ? err.classification.actualType : '', 'not-memory-store');
        return true;
      },
    );
  });

  void it('restore() with wrong version throws StoreError INCOMPATIBLE_SNAPSHOT', async () => {
    const store = new MemoryStore();
    const badSnap = { 'version': 99, 'type': 'memory-store', 'entries': [] };
    await assert.rejects(
      () => store.restore(badSnap),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
        assert.equal(err.classification.reason === 'INCOMPATIBLE_SNAPSHOT' ? err.classification.actualVersion : 0, 99);
        return true;
      },
    );
  });

  void it('namespace option writes under prefixed key visible in snapshot', async () => {
    const store = new MemoryStore({ 'namespace': 'foo' });
    await store.set('key', 'value');
    // Snapshot entries carry the qualified key (with namespace prefix).
    const snap = await store.snapshot();
    assert.equal(snap.entries.length, 1);
    assert.equal(snap.entries[0]?.key, 'foo:key');
    // Public get uses the same prefix, so it reads the same entry back.
    assert.equal(await store.get('key'), 'value');
  });

  void it('namespace isolates two stores over the same snapshot', async () => {
    const snapA = { 'version': 1, 'type': 'memory-store', 'entries': [{ 'key': 'ns-a:counter', 'value': 10 }] };
    const snapB = { 'version': 1, 'type': 'memory-store', 'entries': [{ 'key': 'ns-b:counter', 'value': 20 }] };

    const storeA = new MemoryStore({ 'namespace': 'ns-a' });
    const storeB = new MemoryStore({ 'namespace': 'ns-b' });
    await storeA.restore(snapA);
    await storeB.restore(snapB);

    assert.equal(await storeA.get('counter'), 10);
    assert.equal(await storeB.get('counter'), 20);
  });
});

// ── PassThroughStore smoke test ─────────────────────────────────────────────
//
// Verifies the abstract method surface is complete by exercising every
// override in a plugin that doesn't use a Map.

void describe('PassThroughStore (BaseStore plugin smoke test)', () => {
  void it('round-trips snapshot/restore using only documented overrides', async () => {
    const backing: Record<string, JsonValueType> = {};
    const store = new PassThroughStore(backing);

    await store.set<string>('p', 'plugin-value');
    await store.set<number>('q', 99);
    assert.equal(await store.has('p'), true);
    assert.equal(await store.get('q'), 99);

    const snap = await store.snapshot();
    assert.equal(snap.type, 'pass-through-store');
    assert.equal(snap.version, 1);

    const fresh = new PassThroughStore({});
    await fresh.restore(snap);
    assert.equal(await fresh.get('p'), 'plugin-value');
    assert.equal(await fresh.get('q'), 99);
  });

  void it('delete returns correct boolean from backing', async () => {
    const backing: Record<string, JsonValueType> = { 'existing': true };
    const store = new PassThroughStore(backing);
    assert.equal(await store.delete('existing'), true);
    assert.equal(await store.delete('missing'), false);
  });

  void it('update works through the default RMW path', async () => {
    const backing: Record<string, JsonValueType> = {};
    const store = new PassThroughStore(backing);
    await store.update<number>('n', (v) => (v ?? 0) + 5);
    await store.update<number>('n', (v) => (v ?? 0) + 5);
    assert.equal(await store.get('n'), 10);
  });
});

// ── TypedStore tests ──────────────────────────────────────────────────────────

void describe('TypedStore', () => {
  void it('construction wraps a MemoryStore without error', () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);
    assert.ok(typed instanceof TypedStore);
  });

  void it('set + get round-trip infers value type from Schema[K]', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    await typed.set('count', 42);
    const n = await typed.get('count');
    // n is inferred as number | null; no explicit <T> at the call site.
    assert.equal(n, 42);

    await typed.set('label', 'hello');
    const s = await typed.get('label');
    assert.equal(s, 'hello');
  });

  void it('has() returns true after set, false before', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    assert.equal(await typed.has('count'), false);
    await typed.set('count', 1);
    assert.equal(await typed.has('count'), true);
  });

  void it('delete() removes the key and returns correct boolean', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    await typed.set('label', 'to-delete');
    const deleted = await typed.delete('label');
    assert.equal(deleted, true);
    assert.equal(await typed.has('label'), false);
    const alreadyGone = await typed.delete('label');
    assert.equal(alreadyGone, false);
  });

  void it('update(key, fn): fn receives Schema[K] | undefined as current', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    // First update: current is undefined; default to 0.
    const first = await typed.update('count', (current) => (current ?? 0) + 10);
    assert.equal(first, 10);

    // Second update: current is 10.
    const second = await typed.update('count', (current) => (current ?? 0) + 5);
    assert.equal(second, 15);

    assert.equal(await typed.get('count'), 15);
  });

  void it('update works with object values', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    const result = await typed.update(
      'config',
      (current) => current ?? { 'retries': 3, 'timeout': 5000 },
    );
    assert.deepEqual(result, { 'retries': 3, 'timeout': 5000 });
  });

  void it('inner.snapshot() / inner.restore() pass-through preserves typed values', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    await typed.set('count', 99);
    await typed.set('label', 'snap-test');

    const snap = await typed.inner.snapshot();
    assert.equal(snap.type, 'memory-store');
    assert.equal(snap.version, 1);

    // Restore into a fresh TypedStore wrapping a new MemoryStore.
    const fresh = new TypedStore<AppSchema>(new MemoryStore());
    await fresh.inner.restore(snap);

    assert.equal(await fresh.get('count'), 99);
    assert.equal(await fresh.get('label'), 'snap-test');
  });

  void it('.inner provides access to the underlying StoreInterface for un-narrowed ops', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    await typed.set('count', 7);

    // .inner exposes the wide StoreInterface interface; caller specifies <T> directly.
    const raw = await typed.inner.get<number>('count');
    assert.equal(raw, 7);

    // .inner === the original MemoryStore instance.
    assert.equal(typed.inner, inner);
  });

  void it('inner.connect() and inner.disconnect() pass through to the inner store', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    // MemoryStore no-ops both; callers use .inner for lifecycle operations.
    await assert.doesNotReject(() => typed.inner.connect());
    await assert.doesNotReject(() => typed.inner.disconnect());
  });

  void it('TypedStore composes with a MemoryStore that already has prior data', async () => {
    const inner = new MemoryStore();
    // Write directly into the inner store before wrapping.
    await inner.set<number>('count', 100);
    await inner.set<string[]>('tags', ['a', 'b']);

    const typed = new TypedStore<AppSchema>(inner);

    // TypedStore reads the pre-existing values with correct inferred types.
    assert.equal(await typed.get('count'), 100);
    assert.deepEqual(await typed.get('tags'), ['a', 'b']);

    // Snapshot round-trip preserves those values via .inner lifecycle ops.
    const snap = await typed.inner.snapshot();
    const restored = new TypedStore<AppSchema>(new MemoryStore());
    await restored.inner.restore(snap);
    assert.equal(await restored.get('count'), 100);
    assert.deepEqual(await restored.get('tags'), ['a', 'b']);
  });

  // ── Compile-time rejection tests ─────────────────────────────────────────
  //
  // The next two tests use @ts-expect-error to verify that TypeScript rejects
  // invalid call sites. If TypedStore's key/value constraints are removed, tsc
  // will report "Unused '@ts-expect-error' directive", which our lint config
  // treats as an error, so these tests serve as compile-time regression guards.

  void it('@ts-expect-error: set with a key absent from Schema is rejected', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    // @ts-expect-error: 'missing-key' is not a key of AppSchema.
    await typed.set('missing-key', 'x');
  });

  void it('@ts-expect-error: set with wrong value type for a Schema key is rejected', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    // @ts-expect-error: AppSchema['count'] is number; 'wrong-type' is a string.
    await typed.set('count', 'wrong-type');
  });
});

// ── RemoteStoreInterface contract tests ────────────────────────────────────────────────

void describe('RemoteStoreInterface contract', () => {
  void it('MockRemoteStore is assignable to RemoteStoreInterface (contract is fully implementable)', () => {
    const endpoint: RemoteStoreEndpointType = { 'url': 'http://localhost:6379', 'region': '' };
    const store: RemoteStoreInterface = new MockRemoteStore(endpoint);
    assert.ok(store instanceof MockRemoteStore);
    assert.equal(store.endpoint.url, 'http://localhost:6379');
    assert.equal(store.endpoint.region, '');
  });

  void it('endpoint with region hint round-trips correctly', () => {
    const endpoint: RemoteStoreEndpointType = { 'url': 'grpc://store.us-east-1.internal:50051', 'region': 'us-east-1' };
    const store = new MockRemoteStore(endpoint);
    assert.equal(store.endpoint.region, 'us-east-1');
  });

  void it('acquireLease returns a well-formed RemoteStoreLeaseType', async () => {
    const store = new MockRemoteStore({ 'url': 'http://localhost:6379', 'region': '' });
    const ttl   = 5_000;
    const before = Date.now();
    const lease: RemoteStoreLeaseType = await store.acquireLease('run-abc', ttl, 1_000);

    assert.equal(lease.subject, 'run-abc');
    assert.ok(typeof lease.token === 'string' && lease.token.length > 0);
    assert.ok(lease.expiresAt >= before + ttl);
  });

  void it('releaseLease resolves without throwing', async () => {
    const store = new MockRemoteStore({ 'url': 'http://localhost:6379', 'region': '' });
    const lease: RemoteStoreLeaseType = {
      'token':     'tok-xyz',
      'expiresAt': Date.now() + 1_000,
      'subject':   'run-xyz',
    };
    await assert.doesNotReject(() => store.releaseLease(lease));
  });

  void it('health() returns true when endpoint is up', async () => {
    const store = new MockRemoteStore({ 'url': 'http://localhost:6379', 'region': '' });
    const ok = await store.health(200);
    assert.equal(ok, true);
  });

  void it('StoreInterface surface (get/set/has/delete) works through RemoteStoreInterface', async () => {
    const store: RemoteStoreInterface = new MockRemoteStore({ 'url': 'http://localhost:6379', 'region': '' });
    await store.set<string>('greeting', 'hello');
    assert.equal(await store.get('greeting'), 'hello');
    assert.equal(await store.has('greeting'), true);
    const deleted = await store.delete('greeting');
    assert.equal(deleted, true);
    assert.equal(await store.has('greeting'), false);
  });
});

// ── StoreError remote-specific discriminants ─────────────────────────────────

void describe('StoreError: remote-specific classification reasons', () => {
  void it('LEASE_DENIED classifies and discriminates correctly', () => {
    const classification: StoreErrorClassificationType = {
      'reason':  'LEASE_DENIED',
      'subject': 'run-abc',
      'holder':  'worker-7',
    };
    const err = new StoreError('lease denied: run-abc held by worker-7', classification);

    assert.ok(err instanceof StoreError);
    assert.equal(err.classification.reason, 'LEASE_DENIED');

    if (err.classification.reason === 'LEASE_DENIED') {
      assert.equal(err.classification.subject, 'run-abc');
      assert.equal(err.classification.holder, 'worker-7');
    } else {
      assert.fail('expected LEASE_DENIED reason');
    }
  });

  void it('LEASE_EXPIRED classifies and discriminates correctly', () => {
    const classification: StoreErrorClassificationType = {
      'reason':  'LEASE_EXPIRED',
      'subject': 'run-abc',
      'token':   'tok-stale-xyz',
    };
    const err = new StoreError('lease expired: tok-stale-xyz', classification);

    assert.ok(err instanceof StoreError);
    assert.equal(err.classification.reason, 'LEASE_EXPIRED');

    if (err.classification.reason === 'LEASE_EXPIRED') {
      assert.equal(err.classification.subject, 'run-abc');
      assert.equal(err.classification.token, 'tok-stale-xyz');
    } else {
      assert.fail('expected LEASE_EXPIRED reason');
    }
  });

  void it('UNREACHABLE classifies and discriminates correctly', () => {
    const cause = new Error('ECONNREFUSED');
    const classification: StoreErrorClassificationType = {
      'reason':   'UNREACHABLE',
      'endpoint': 'http://localhost:6379',
      'cause':    cause,
    };
    const err = new StoreError('store unreachable: http://localhost:6379', classification);

    assert.ok(err instanceof StoreError);
    assert.equal(err.classification.reason, 'UNREACHABLE');

    if (err.classification.reason === 'UNREACHABLE') {
      assert.equal(err.classification.endpoint, 'http://localhost:6379');
      assert.equal(err.classification.cause, cause);
    } else {
      assert.fail('expected UNREACHABLE reason');
    }
  });

  void it('existing BACKING_ERROR reason is unaffected by the new union members', () => {
    const cause = new Error('disk full');
    const classification: StoreErrorClassificationType = {
      'reason': 'BACKING_ERROR',
      'cause':  cause,
    };
    const err = new StoreError('backing error', classification);

    assert.equal(err.classification.reason, 'BACKING_ERROR');
    if (err.classification.reason === 'BACKING_ERROR') {
      assert.equal(err.classification.cause, cause);
    } else {
      assert.fail('expected BACKING_ERROR reason');
    }
  });
});
