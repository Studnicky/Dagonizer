/**
 * custom-checkpoint-store: runnable exercise of two real contract
 * implementations — MapCheckpointStore (CheckpointStoreInterface) and FactLog
 * (SnapshottableInterface).
 *
 * Both use in-process backings (a Map and a string list) so the example runs
 * with no external service. The contract shape is identical to a Postgres,
 * Redis, or S3 store; production swaps the backing, not the three methods.
 *
 * Demonstrates:
 *   1. MapCheckpointStore.save / load / delete round-trip — the three-method
 *      CheckpointStoreInterface.
 *   2. FactLog.snapshot / restore round-trip — a non-KV Snapshottable that
 *      rides along in a checkpoint payload via Checkpoint.capture({ stores }).
 *
 * Definitions (the two contract implementations): examples/dags/custom-checkpoint-store.ts
 *
 * Run: npx tsx examples/custom-checkpoint-store.ts
 */

import { FactLog, MapCheckpointStore } from './dags/custom-checkpoint-store.js';

process.stdout.write('\n=== custom-checkpoint-store: real CheckpointStore + Snapshottable ===\n\n');

// ── 1. MapCheckpointStore: save / load / delete ──────────────────────────────

const store = new MapCheckpointStore();

await store.save('run-42', '{"cursor":null}');
const loaded: string | null = await store.load('run-42');
process.stdout.write(`[store] load('run-42')  = ${JSON.stringify(loaded)}\n`);
process.stdout.write(`[store] size after save = ${String(store.size)}\n`);

const missing: string | null = await store.load('absent');
process.stdout.write(`[store] load('absent')  = ${JSON.stringify(missing)} (null when no entry)\n`);

await store.delete('run-42');
process.stdout.write(`[store] size after delete = ${String(store.size)}\n\n`);

if (loaded !== '{"cursor":null}') {
  throw new Error(`Expected the saved JSON back, got ${JSON.stringify(loaded)}`);
}
if (missing !== null) {
  throw new Error(`Expected null for an absent key, got ${JSON.stringify(missing)}`);
}
if (store.size !== 0) {
  throw new Error(`Expected an empty store after delete, got size=${String(store.size)}`);
}

// ── 2. FactLog: snapshot / restore round-trip ────────────────────────────────

const log = new FactLog();
log.add('alice signed in');
log.add('bob exported report');

const snap = await log.snapshot();
process.stdout.write(`[factlog] snapshot type="${snap.type}" version=${String(snap.version)} entries=${String(snap.entries.length)}\n`);

const fresh = new FactLog();
await fresh.restore(snap);
process.stdout.write(`[factlog] restored facts: ${JSON.stringify(fresh.facts)}\n\n`);

if (fresh.facts.join('|') !== 'alice signed in|bob exported report') {
  throw new Error(`FactLog restore mismatch, got ${JSON.stringify(fresh.facts)}`);
}

process.stdout.write('All assertions passed.\n');
process.stdout.write('Lesson: a CheckpointStore is three methods (save/load/delete); a\n');
process.stdout.write('        Snapshottable is two (snapshot/restore). Both run on any backing —\n');
process.stdout.write('        here a Map and a list; in production Postgres/Redis/S3.\n');
