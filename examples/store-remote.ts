/**
 * store-remote: exercises the GrpcStore stub from dags/store-remote.ts.
 *
 * GrpcStore extends BaseStore and implements RemoteStore. Its network methods
 * (connect, disconnect, health, acquireLease, releaseLease) print to stdout
 * instead of making real gRPC calls — this is a stub standing in for a real
 * gRPC backend. The in-memory data map is identical in behaviour to a real
 * remote store: put/get/delete round-trips work exactly as a production
 * implementation would.
 *
 * Note: GrpcStore is a stub. In production, replace performGet/performSet/
 * performDelete with real gRPC client calls and implement connect/disconnect
 * against your actual service endpoint.
 *
 * DAG definition (GrpcStore class): examples/dags/store-remote.ts
 *
 * Run: npx tsx examples/store-remote.ts
 */

import { GrpcStore } from './dags/store-remote.js';

process.stdout.write('\n=== RemoteStore stub (GrpcStore) round-trip ===\n\n');

const store = new GrpcStore('grpc://archivist.internal:50051', 'eu-west-1');

// ── connect/health ───────────────────────────────────────────────────────────
await store.connect();
const healthy = await store.health(1000);
process.stdout.write(`health ok=${String(healthy)}\n\n`);

// ── put/get round-trip ───────────────────────────────────────────────────────
await store.set('catalogue:entry:001', { title: 'The Archivist Compendium', volume: 1 });
const entry = await store.get<{ title: string; volume: number }>('catalogue:entry:001');
process.stdout.write(`get after set: ${JSON.stringify(entry)}\n`);

// ── has ──────────────────────────────────────────────────────────────────────
const exists    = await store.has('catalogue:entry:001');
const notExists = await store.has('catalogue:entry:999');
process.stdout.write(`has '001'=${String(exists)}  has '999'=${String(notExists)}\n`);

// ── update (atomic read-modify-write) ────────────────────────────────────────
const updated = await store.update<number>('catalogue:count', (n) => (n ?? 0) + 1);
process.stdout.write(`update counter: ${String(updated)}\n`);

// ── delete ───────────────────────────────────────────────────────────────────
await store.delete('catalogue:entry:001');
const afterDelete = await store.get('catalogue:entry:001');
process.stdout.write(`after delete: ${JSON.stringify(afterDelete)}\n\n`);

// ── lease acquire/release ────────────────────────────────────────────────────
const lease = await store.acquireLease('catalogue:entry:001', 5000, 1000);
process.stdout.write(`lease.token=${lease.token}\n`);
await store.releaseLease(lease);

// ── snapshot/restore round-trip ──────────────────────────────────────────────
await store.set('persist:a', 'alpha');
await store.set('persist:b', 'beta');
const snap = await store.snapshot();
process.stdout.write(`\nsnapshot entries=${String(snap.entries.length)}\n`);

const fresh = new GrpcStore('grpc://archivist.internal:50051', 'eu-west-1');
await fresh.restore(snap);
const restored = await fresh.get<string>('persist:a');
process.stdout.write(`restored persist:a=${String(restored)}\n`);

await store.disconnect();
process.stdout.write('\nLesson: BaseStore handles key qualification, snapshot, and restore;\n');
process.stdout.write('        subclasses implement the performGet/Set/Delete/... hooks.\n');
