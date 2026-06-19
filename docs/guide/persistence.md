---
title: 'Checkpoint persistence'
description: 'CheckpointStore is the three-method adapter for persisting checkpoint JSON; MemoryCheckpointStore is the reference impl; ckpt.persist and Checkpoint.recall compose codec + store.'
seeAlso:
  - text: 'Checkpoint'
    link: './checkpoint'
    description: 'the codec layer (`Checkpoint.capture` and `Checkpoint.load`)'
  - text: 'Subclassing State'
    link: './subclassing'
    description: 'domain fields survive the round-trip via `snapshotData` and `restoreData`'
  - text: 'Cancellation'
    link: './cancellation'
    description: 'produce a checkpointable result by aborting an in-flight flow'
---

# Checkpoint persistence

`CheckpointStore` is the three-method adapter contract for persistence backends. `Checkpoint` handles the codec (turning an `ExecutionResult` into a `CheckpointData` record and back); persistence is the consumer's responsibility behind this contract.

## API surface

| Symbol | Source | Role |
|--------|--------|------|
| `CheckpointStore` | `@studnicky/dagonizer/contracts` | Adapter contract: `save`, `load`, `delete` |
| `Snapshottable` | `@studnicky/dagonizer/contracts` | Capability contract: `snapshot()`, `restore()`. Required by `Checkpoint.capture` and `restoreStores`. |
| `StoreSnapshotType` | `@studnicky/dagonizer/contracts` | Serialized envelope written into `CheckpointData.stores` |
| `MemoryCheckpointStore` | `@studnicky/dagonizer/checkpoint` | In-memory reference implementation (tests, demos) |
| `ckpt.persist(store, key)` | instance method | Serializes and writes via the store |
| `Checkpoint.recall(store, key)` | `@studnicky/dagonizer/checkpoint` | Reads, parses, validates, wraps |

## The contract

```ts twoslash
import type { CheckpointStoreInterface } from '@studnicky/dagonizer/contracts';
// ---cut---
declare const store: CheckpointStoreInterface;
await store.save('run-42', '{"cursor":null}');
const json: string | null = await store.load('run-42');
await store.delete('run-42');
export {};
```

`load` returns `null` when no entry exists. Implementations handle their own concurrency, retries, and serialization details.

## Persist + recall lifecycle

```mermaid
flowchart TB
  exec([dispatcher.execute])
  result([ExecutionResult\ncursor != null])
  capture[Checkpoint.capture]
  persist[ckpt.persist]
  store[(CheckpointStore)]
  recall[Checkpoint.recall]
  restore[ckpt.restoreState]
  resume([dispatcher.resume])
  exec --> result
  result --> capture
  capture --> persist
  persist --> store
  store --> recall
  recall --> restore
  restore --> resume
```

The diagram traces method invocations across the save and resume halves. It is not a Dagonizer DAG; it is a sequence over the codec API.

## Persist with `ckpt.persist`

<<< @/../examples/08-checkpoint.ts#persist

`ckpt.persist(store, key)` calls `store.save(key, ckpt.toJson())`. One call covers serialization plus storage.

## Recall with `Checkpoint.recall`

<<< @/../examples/08-checkpoint.ts#recall

`Checkpoint.recall` returns `null` when the key is absent, or a `Checkpoint` instance whose `restoreState` yields the rehydrated state, the dag name, the resume cursor, and the executed/skipped node histories.

## Implementing a custom store

Implement the three methods against the backend. A Postgres implementation using the `pg` driver looks like:

```ts twoslash
// pg is not a workspace dependency — declare a minimal surface for type checking.
// Users: `npm install pg` before importing from 'pg'.
import type { CheckpointStoreInterface } from '@studnicky/dagonizer/contracts';
interface Pool {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  query<T>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}
// ---cut---
export class PostgresCheckpointStore implements CheckpointStoreInterface {
  readonly #pool: Pool;
  readonly #table: string;

  constructor(pool: Pool, table = 'checkpoints') {
    this.#pool = pool;
    this.#table = table;
  }

  async save(key: string, json: string): Promise<void> {
    await this.#pool.query(
      `INSERT INTO ${this.#table} (key, json, saved_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET json = $2, saved_at = NOW()`,
      [key, json],
    );
  }

  async load(key: string): Promise<string | null> {
    const result = await this.#pool.query<{ json: string }>(
      `SELECT json FROM ${this.#table} WHERE key = $1`,
      [key],
    );
    return result.rows[0]?.json ?? null;
  }

  async delete(key: string): Promise<void> {
    await this.#pool.query(`DELETE FROM ${this.#table} WHERE key = $1`, [key]);
  }
}
```

The same three-method pattern applies for Redis (`GET`/`SET`/`DEL`), S3 (`GetObject`/`PutObject`/`DeleteObject`), a file system, or any other key/value store. The contract is intentionally thin so it maps cleanly to any backing.

## Named stores and `Snapshottable`

`Checkpoint.capture` and `ckpt.restoreStores` both depend on the `Snapshottable` capability, not the full key-value `Store` surface. Any object that implements `snapshot(): Promise<StoreSnapshotType>` and `restore(snapshot: StoreSnapshotType): Promise<void>` participates in checkpointing. `Store extends Snapshottable`, so every store qualifies, but a non-KV backing (an RDF triple store, a vector index, an append-only log) can ride along in a checkpoint without implementing `get`/`set`/`has`/`delete`/`update`.

```ts twoslash
import type { SnapshottableInterface, StoreSnapshotType } from '@studnicky/dagonizer/contracts';
import { Checkpoint } from '@studnicky/dagonizer/checkpoint';

class FactLog implements SnapshottableInterface {
  #facts: string[] = [];
  add(fact: string): void { this.#facts.push(fact); }

  async snapshot(): Promise<StoreSnapshotType> {
    return {
      version: 1,
      type: 'fact-log',
      entries: this.#facts.map((fact, i) => ({ key: String(i), value: fact })),
    };
  }

  async restore(snapshot: StoreSnapshotType): Promise<void> {
    if (snapshot.type !== 'fact-log') throw new Error('Incompatible snapshot type');
    this.#facts = snapshot.entries.map((e) => String(e.value));
  }
}

// Pass it to capture just like any MemoryStore:
const log = new FactLog();
// const ckpt = await Checkpoint.capture('my-dag', result, { stores: { log } });

// And restore it on resume:
const freshLog = new FactLog();
// await recalled.restoreStores({ log: freshLog });
void Checkpoint;
void log;
void freshLog;
export {};
```

`CheckpointData.stores` is a **required** field. `Checkpoint.capture` always writes it: as an empty object `{}` when no stores are passed, or as a keyed map of `StoreSnapshotType` envelopes when stores are supplied. Any checkpoint payload lacking a `stores` field is rejected by `Checkpoint.load`.

## Snapshot round-trip

`Checkpoint.capture` calls `state.snapshot()` and packages the result with the cursor and execution history. State subclasses that carry domain-specific fields override `snapshotData()` and `restoreData()`:

<<< @/../examples/dags/23-checkpoint-store.ts#pipeline-state

Lifecycle resets to `pending` on restore. Resume starts a fresh lifecycle run on the recovered state data.

## Schema validation on recall

`Checkpoint.recall` runs the JSON through `Validator.checkpoint.validate(parsed)` before wrapping it. Tampered or version-mismatched payloads throw `ValidationError`. The same goes for `Checkpoint.load` (which `recall` composes with).

## Testing with `MemoryCheckpointStore`

<<< @/../examples/23-checkpoint-store.ts#store-init

`MemoryCheckpointStore` exposes a read-only `size` getter for assertions about how many entries the store holds.

## Scatter resume artefacts

Scatter placements with a `source` persist per-item progress under a reserved metadata key (`SCATTER_PROGRESS_KEY === '__dagonizer_scatter_progress__'`). When a checkpoint captures a state mid-scatter, this key carries the indices of already-completed clones so the resumed run can skip them instead of re-issuing every external call from scratch.

Three persistence-side implications:

1. **The key counts toward checkpoint payload size.** A 200-item scatter interrupted at clone 150 stores 150 numeric indices plus their output tags. Plan capacity in the `CheckpointStore` with this in mind; the payload still serialises as a single JSON document.
2. **Per-batch write cadence.** The dispatcher writes the progress entry once per scatter batch (not once per item). The persisted metadata is consistent with the batch boundary that was last `await`-ed; a crash during a batch leaves the last completed batch persisted and the in-flight batch unreported.
3. **Indices are array positions in the source at resume time.** If the `CheckpointStore` is read across processes that may rebuild state with a different source array, the resumed scatter skips by position, not by item identity. Treat the source as immutable while a scatter checkpoint is live, or clear the progress entry before calling `dispatcher.resume()` when the source has changed.

The reserved key piggybacks on `NodeStateBase.metadata`, so any `CheckpointStore` that already round-trips the `JsonObjectType` snapshot supports scatter resume with no additional adapter changes. See [Checkpoint and Resume](./checkpoint#scatter-resume-per-item-progress) for the executable contract and index-semantics worked example.

## Related reference

- [Reference: Contracts](../reference/contracts)
- [Reference: Checkpoint](../reference/checkpoint)
- [Demo: Phase 08 Checkpoint resume](../examples/08-checkpoint)
