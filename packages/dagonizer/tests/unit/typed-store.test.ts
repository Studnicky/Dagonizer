import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MemoryStore } from '../../src/store/MemoryStore.js';
import { TypedStore } from '../../src/store/TypedStore.js';

// ── Test schema ─────────────────────────────────────────────────────────────

interface AppSchema {
  count:   number;
  label:   string;
  tags:    string[];
  config:  { readonly retries: number; readonly timeout: number };
}

// ── TypedStore tests ─────────────────────────────────────────────────────────

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
    // n is inferred as number | undefined — no explicit <T> at the call site.
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

  void it('update(key, fn) — fn receives Schema[K] | undefined as current', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    // First update — current is undefined; default to 0.
    const first = await typed.update('count', (current) => (current ?? 0) + 10);
    assert.equal(first, 10);

    // Second update — current is 10.
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

  void it('snapshot() / restore() pass-through preserves typed values', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    await typed.set('count', 99);
    await typed.set('label', 'snap-test');

    const snap = await typed.snapshot();
    assert.equal(snap.type, 'memory-store');
    assert.equal(snap.version, 1);

    // Restore into a fresh TypedStore wrapping a new MemoryStore.
    const fresh = new TypedStore<AppSchema>(new MemoryStore());
    await fresh.restore(snap);

    assert.equal(await fresh.get('count'), 99);
    assert.equal(await fresh.get('label'), 'snap-test');
  });

  void it('.inner provides access to the underlying Store for un-narrowed ops', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    await typed.set('count', 7);

    // .inner exposes the wide Store interface — caller specifies <T> directly.
    const raw = await typed.inner.get<number>('count');
    assert.equal(raw, 7);

    // .inner === the original MemoryStore instance.
    assert.equal(typed.inner, inner);
  });

  void it('connect() and disconnect() pass through to the inner store', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    // MemoryStore no-ops both; verifying no throw and no type error.
    await assert.doesNotReject(() => typed.connect());
    await assert.doesNotReject(() => typed.disconnect());
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

    // Snapshot round-trip preserves those values.
    const snap = await typed.snapshot();
    const restored = new TypedStore<AppSchema>(new MemoryStore());
    await restored.restore(snap);
    assert.equal(await restored.get('count'), 100);
    assert.deepEqual(await restored.get('tags'), ['a', 'b']);
  });

  // ── Compile-time rejection tests ─────────────────────────────────────────
  //
  // The next two tests use @ts-expect-error to verify that TypeScript rejects
  // invalid call sites. If TypedStore's key/value constraints are removed, tsc
  // will report "Unused '@ts-expect-error' directive" — which our lint config
  // treats as an error — so these tests serve as compile-time regression guards.

  void it('@ts-expect-error — set with a key absent from Schema is rejected', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    // @ts-expect-error — 'missing-key' is not a key of AppSchema.
    await typed.set('missing-key', 'x');
  });

  void it('@ts-expect-error — set with wrong value type for a Schema key is rejected', async () => {
    const inner = new MemoryStore();
    const typed = new TypedStore<AppSchema>(inner);

    // @ts-expect-error — AppSchema['count'] is number; 'wrong-type' is a string.
    await typed.set('count', 'wrong-type');
  });
});
