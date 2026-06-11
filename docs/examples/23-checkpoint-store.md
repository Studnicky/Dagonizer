---
title: 'Example 23: Checkpoint store (persist + recall)'
description: 'Persist a mid-run checkpoint to MemoryCheckpointStore and resume from it in a fresh dispatcher. Demonstrates the full checkpoint-store lifecycle: abort after first stage, capture, persist, recall, restore, resume.'
seeAlso:
  - text: 'Phase 08: Checkpoint + resume'
    link: './08-checkpoint'
    description: 'checkpoint mechanics in The Archivist'
  - text: 'Checkpoint guide'
    link: '../guide/checkpoint'
    description: 'Checkpoint.capture, restore, cursor semantics'
  - text: 'Persistence guide'
    link: '../guide/persistence'
    description: 'Postgres, Redis, and S3 CheckpointStore examples'
  - text: 'Example 16: Scatter resume'
    link: './16-scatter-resume'
    description: 'durable inbox: resumability across a scatter abort'
  - text: 'Reference: Checkpoint'
    link: '../reference/checkpoint'
---

# Example 23: Checkpoint store (persist + recall)

Full checkpoint-store lifecycle across a simulated process restart:

1. Register a three-stage pipeline DAG (`ingest → process → export`).
2. Execute with an `AbortController`; abort after the first stage completes.
3. Capture the partial result as a `Checkpoint` and persist it to a `MemoryCheckpointStore` under a stable key.
4. Construct a fresh `Dagonizer` + `MemoryCheckpointStore` (simulating a process restart, using the same in-memory store to skip I/O).
5. Recall the checkpoint from the store, restore state, and resume.
6. Print the persisted snapshot and the resumed state to confirm the full pipeline ran with only the remaining stages executing after resume.

`MemoryCheckpointStore` is in-process only — the map is discarded when the process exits. In production, swap for a file-, Redis-, or DB-backed `CheckpointStore` that implements `save` / `load` / `delete`.

## Code

<<< @/../examples/23-checkpoint-store.ts

## What it demonstrates

- **`Checkpoint.capture(dagName, result)`.** Produces a `Checkpoint` instance only when `result.cursor !== null` (an in-progress flow). A completed flow produces no cursor.
- **`ckpt.persist(store, key)`.** Codec plus store in one call. Serialises the checkpoint to JSON and passes it to `store.save(key, json)`.
- **`Checkpoint.recall(store, key)`.** Reads from the store, deserialises, and returns a `Checkpoint` or `null` when nothing is stored under the key.
- **`ckpt.restoreState(adapter)`.** Calls `adapter(snapshot)` to reconstruct the domain state from the serialised snapshot. The adapter is the `restoreState` function registered on the dispatcher.
- **`dispatcher.resume(dagName, state, cursor)`.** Starts from the recalled cursor instead of the DAG's entrypoint. Only the remaining nodes execute; completed stages before the cursor are not re-run.
- **`MemoryCheckpointStore`.** In-process reference implementation. Swap with any `CheckpointStore` (Postgres, Redis, S3) without changing the calling code.

## Run

```bash
npx tsx examples/23-checkpoint-store.ts
```
