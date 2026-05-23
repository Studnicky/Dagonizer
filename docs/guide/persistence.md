---
seeAlso:

  - text: 'Checkpoint'

    link: './checkpoint'
    description: 'the codec layer (`Checkpoint.capture` / `Checkpoint.load`)'

  - text: 'Subclassing State'

    link: './subclassing'
    description: 'domain fields survive the round-trip via `snapshotData` / `restoreData`'

  - text: 'Cancellation'

    link: './cancellation'
    description: 'produce a checkpointable result by aborting an in-flight flow'
---

# Checkpoint persistence

`Checkpoint` handles the codec — turning an `ExecutionResult` into a `CheckpointData` record and back. Persistence is the consumer's responsibility, behind the `CheckpointStore` adapter contract.

`Dagonizer` ships one reference implementation, `MemoryCheckpointStore`, suitable for tests and ephemeral demos. Production deployments implement `CheckpointStore` against their database/object store of choice.

## The contract

```ts
import type { CheckpointStore } from '@noocodex/dagonizer/contracts';

interface CheckpointStore {
  save(key: string, json: string): Promise<void>;
  load(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}
```

Three methods. `load` returns `null` when no entry exists. Implementations handle their own concurrency, retries, and serialization details.

## Persist + recall

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

`ckpt.persist(store, key)` and `Checkpoint.recall(store, key)` compose the codec with a store:

```ts
import { Checkpoint, MemoryCheckpointStore } from '@noocodex/dagonizer/checkpoint';

const store = new MemoryCheckpointStore();

// Save
const result = await dispatcher.execute('process', new MyState(), { signal });
if (result.cursor !== null) {
  const ckpt = await Checkpoint.capture('process', result);
  await ckpt.persist(store, 'ckpt:process');
}

// Recall
const recalled = await Checkpoint.recall(store, 'ckpt:process');
if (recalled !== null) {
  const { dagName, state, cursor } = recalled.restoreState((snap) => MyState.restore(snap));
  await dispatcher.resume(dagName, state, cursor);
}
```

`Checkpoint.recall` returns `null` when no entry exists under the key, or a `Checkpoint` instance whose `restoreState` yields the rehydrated state, the dag name, the resume cursor, and the executed/skipped node histories.

## Implementing a custom store

Implement the three methods against your backend.

```ts
import type { CheckpointStore } from '@noocodex/dagonizer/contracts';
import type { Pool } from 'pg';

export class PostgresCheckpointStore implements CheckpointStore {
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

The same pattern works for Redis, S3, file system, etcd, or any other key/value store.

## Snapshot round-trip

`Checkpoint.capture` calls `state.snapshot()` and packages the result with the cursor and execution history. State subclasses that carry domain-specific fields override `snapshotData()` and `restoreData()`:

```ts
class PipelineState extends NodeStateBase {
  processed: string[] = [];
  failed: string[] = [];

  protected override snapshotData(): JsonObject {
    return {
      processed: [...this.processed],
      failed: [...this.failed],
    };
  }

  protected override restoreData(snap: JsonObject): void {
    if (Array.isArray(snap['processed'])) this.processed = snap['processed'] as string[];
    if (Array.isArray(snap['failed']))    this.failed    = snap['failed']    as string[];
  }
}
```

Lifecycle resets to `pending` on restore. Resume starts a fresh lifecycle run on the recovered state data.

## Schema validation on recall

`Checkpoint.recall` runs the JSON through `Validator.checkpoint.validate(parsed)` before wrapping it. Tampered or version-mismatched payloads throw `ValidationError`. The same goes for `Checkpoint.load` (which `recall` composes with).

## Testing with `MemoryCheckpointStore`

```ts
import { MemoryCheckpointStore } from '@noocodex/dagonizer/checkpoint';

const store = new MemoryCheckpointStore();
// drive your test against `store` exactly as production code would
```

`MemoryCheckpointStore` exposes a read-only `size` getter for assertions about how many entries the store holds.
## Related reference

- [Reference: Contracts — `CheckpointStore`](../reference/contracts)
- [Reference: Checkpoint](../reference/checkpoint)
- [Example: Checkpoint Resume](../examples/08-checkpoint)
