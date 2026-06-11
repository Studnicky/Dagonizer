import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { StoreSnapshotEntry } from '../../src/contracts/Snapshottable.js';
import type { JsonValue } from '../../src/entities/json.js';
import { BaseStore, type BaseStoreOptions } from '../../src/store/BaseStore.js';
import { MemoryStore } from '../../src/store/MemoryStore.js';
import { StoreError } from '../../src/store/StoreError.js';

// ── Minimum-viable test plugin ──────────────────────────────────────────────
//
// PassThroughStore extends BaseStore against a plain Record<string, unknown>.
// Exercises every protected abstract method to lock the plugin surface.

class PassThroughStore extends BaseStore {
  readonly #backing: Record<string, JsonValue>;

  constructor(backing: Record<string, JsonValue>, options: BaseStoreOptions = { 'namespace': '' }) {
    super(options);
    this.#backing = backing;
  }

  protected get snapshotType(): string    { return 'pass-through-store'; }
  protected get snapshotVersion(): number { return 1; }

  protected async performGet<T extends JsonValue>(key: string): Promise<T | null> {
    const value = this.#backing[key];
    return value === undefined ? null : (value as T);
  }

  protected async performSet<T extends JsonValue>(key: string, value: T): Promise<void> {
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

  protected async performSnapshotEntries(): Promise<readonly StoreSnapshotEntry[]> {
    return Object.entries(this.#backing).map(([key, value]) => ({
      'key':   key,
      'value': value,
    }));
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntry[]): Promise<void> {
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
  override async update<T extends JsonValue>(key: string, fn: (current: T | undefined) => T): Promise<T> {
    return this.performUpdateRmw(key, fn);
  }
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
    const backing: Record<string, JsonValue> = {};
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
    const backing: Record<string, JsonValue> = { 'existing': true };
    const store = new PassThroughStore(backing);
    assert.equal(await store.delete('existing'), true);
    assert.equal(await store.delete('missing'), false);
  });

  void it('update works through the default RMW path', async () => {
    const backing: Record<string, JsonValue> = {};
    const store = new PassThroughStore(backing);
    await store.update<number>('n', (v) => (v ?? 0) + 5);
    await store.update<number>('n', (v) => (v ?? 0) + 5);
    assert.equal(await store.get('n'), 10);
  });
});
