/**
 * custom-store: runnable exercise of MapStore — the custom BaseStore example.
 *
 * Demonstrates:
 *   1. set / get round-trip
 *   2. has / delete
 *   3. Atomic update (read-modify-write via override — no await between read and write)
 *   4. snapshot / restore round-trip (persists to a second instance)
 *
 * The MapStore in examples/dags/custom-store.ts extends BaseStore with a
 * real Map<string, JsonValue> backing. This entry point exercises every public
 * method so the implementation is verifiably runnable.
 *
 * Run: npx tsx examples/custom-store.ts
 */

import { MapStore } from './dags/custom-store.js';

process.stdout.write('\n=== custom-store: MapStore round-trip exercise ===\n\n');

// ── 1. set / get ─────────────────────────────────────────────────────────────

const store = new MapStore({ namespace: 'demo' });

await store.set('user:1', { name: 'Alice', score: 0 });
await store.set('user:2', { name: 'Bob',   score: 0 });

const alice = await store.get<{ name: string; score: number }>('user:1');
const bob   = await store.get<{ name: string; score: number }>('user:2');

process.stdout.write(`[get] user:1 = ${JSON.stringify(alice)}\n`);
process.stdout.write(`[get] user:2 = ${JSON.stringify(bob)}\n`);

// ── 2. has / delete ──────────────────────────────────────────────────────────

const hasBefore = await store.has('user:2');
const deleted   = await store.delete('user:2');
const hasAfter  = await store.has('user:2');

process.stdout.write(`[has]    user:2 before delete: ${String(hasBefore)}\n`);
process.stdout.write(`[delete] user:2: ${String(deleted)}\n`);
process.stdout.write(`[has]    user:2 after delete:  ${String(hasAfter)}\n`);

// ── 3. Atomic update ─────────────────────────────────────────────────────────
//
// update(key, fn) reads the current value, applies fn, and writes the result
// in a single synchronous step (no await between read and write on Map).
// Concurrent microtasks cannot interleave — the lock-free atomicity guarantee.

const score1 = await store.update<number>('counter', (c) => (c ?? 0) + 10);
const score2 = await store.update<number>('counter', (c) => (c ?? 0) + 10);
const score3 = await store.update<number>('counter', (c) => (c ?? 0) + 10);

process.stdout.write(`[update] counter after +10: ${String(score1)}\n`);
process.stdout.write(`[update] counter after +10: ${String(score2)}\n`);
process.stdout.write(`[update] counter after +10: ${String(score3)}\n`);

// ── 4. snapshot / restore round-trip ─────────────────────────────────────────
//
// snapshot() returns a StoreSnapshot envelope ({ version, type, entries }).
// restore(snapshot) validates type + version before calling performRestoreEntries.
// A fresh MapStore instance restores to the identical state.

const snap  = await store.snapshot();
process.stdout.write(`\n[snapshot] type="${snap.type}" version=${String(snap.version)} entries=${String(snap.entries.length)}\n`);
process.stdout.write(`[snapshot] keys: ${snap.entries.map((e) => e.key).join(', ')}\n`);

const fresh = new MapStore({ namespace: 'demo' });
await fresh.restore(snap);

const counterRestored = await fresh.get<number>('counter');
const aliceRestored   = await fresh.get<{ name: string; score: number }>('user:1');

process.stdout.write(`[restore] counter  = ${String(counterRestored)}\n`);
process.stdout.write(`[restore] user:1   = ${JSON.stringify(aliceRestored)}\n`);

// ── Verify ────────────────────────────────────────────────────────────────────

if (counterRestored !== 30) {
  throw new Error(`Expected counter=30 after restore, got ${String(counterRestored)}`);
}
if (aliceRestored?.name !== 'Alice') {
  throw new Error(`Expected user:1.name='Alice' after restore, got ${String(aliceRestored?.name)}`);
}

process.stdout.write('\nAll assertions passed.\n');
process.stdout.write('Lesson: extend BaseStore + implement six perform* hooks + override update\n');
process.stdout.write('        for atomic RMW. Swap Map operations for Redis/Postgres in production.\n');
