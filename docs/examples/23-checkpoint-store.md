---
title: 'Example 23: Checkpoint Store'
description: 'Persist a mid-run checkpoint to MemoryCheckpointStore and resume from it in a fresh dispatcher: abort after first stage, capture, persist, recall, restore, resume.'
seeAlso:
  - text: 'Example 08: Checkpoint and Resume'
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

<script setup lang="ts">
import { archivistDAG } from '../exampleDags.ts';
</script>

# Example 23: Checkpoint Store

## Checkpoint Surface

Checkpoint Store is the persistence interface for resumable runs. The Archivist captures a parked execution, writes the checkpoint outside process memory, recalls it later, restores state and stores, and resumes from the recorded cursor.

The sample capture flow uses local storage and `MemoryCheckpointStore`, but the same `CheckpointStore` contract fits Postgres, Redis, S3, IndexedDB, or any host-owned persistence layer.

## Checkpoint Lifecycle

### DAG registration and diagram

The diagram uses the Archivist DAG because it already exposes save/resume against a parked execution. In the Archivist host, **Save Checkpoint** serializes the current `Checkpoint` together with the session `MemoryStore`; **Resume** deserializes it, restores state, and continues from the stored cursor.

<DagJsonMermaid :dag="archivistDAG" title="Archivist checkpoint-store DAG" aria-label="Archivist JSON-LD DAG beside Mermaid generated from it." />

Checkpoint lifecycle in the Archivist workflow:

1. Execute the Archivist DAG until a run completes or parks for HITL.
2. Visitor clicks **Save Checkpoint**: capture the result as a `Checkpoint`, including the memory store.
3. Serialise it with `ckpt.toJson()` and store the JSON blob under a local key.
4. Visitor clicks **Resume from Checkpoint**: load the JSON blob and rebuild a `Checkpoint` with `Checkpoint.load()`.
5. Restore `ArchivistState` and stores.
6. Resume from the captured cursor.

The CLI persists through the `CheckpointStore` contract (`ckpt.persist(store, key)` / `Checkpoint.recall(store, key)`) against `MemoryCheckpointStore`; the Archivist workflow serialises the same `Checkpoint` object directly to and from local storage with `ckpt.toJson()` / `Checkpoint.load()`, skipping the store indirection since the browser tab is its own storage boundary.

### Run

```bash
pnpm run site:dev
```

Visit [The Archivist](./the-archivist) to compare the browser-runtime checkpoint save/resume flow with the store-backed contract described here.

## Capture and Restore Contract

`Checkpoint.capture` creates a JSON-serializable checkpoint from an interrupted result. `ckpt.persist(store, key)` writes it through the `CheckpointStore` interface. `Checkpoint.recall(store, key)` loads and validates it. The caller restores state and stores, then resumes the same DAG from the captured cursor.

The checkpoint store does not execute the DAG and does not know host state classes. It persists the checkpoint payload; the dispatcher registry and restore adapter reconstruct executable state when the host resumes.

## Code Samples

The Archivist snippets show capture and restore around a saved checkpoint. The CLI snippet shows the same lifecycle against `MemoryCheckpointStore`.

<<< @/../examples/the-archivist/app/ArchivistRunner.vue#checkpoint-store-capture

<<< @/../examples/the-archivist/app/ArchivistRunner.vue#checkpoint-store-restore

<<< @/../examples/the-archivist/runArchivist.ts#resume-run

## Operational Uses

Checkpoint stores let hosts persist parked or interrupted runs beyond the lifetime of the current tab or process. That covers browser refreshes, worker replacement, queue retries, and any host that needs to resume later from a correlation key.

The same call pattern scales from in-memory tests to production stores because only the storage implementation changes; capture, recall, restore, and resume stay the same.

## Runtime Notes

- **`Checkpoint.capture(dagName, result)`.** Produces a `Checkpoint` instance for an in-progress parked flow.
- **`ckpt.toJson()` / `Checkpoint.load(parsed)`.** The Archivist workflow's direct serialise/deserialise pair; used in place of `persist`/`recall` when the caller is already holding the storage boundary (a browser tab's local storage).
- **`ckpt.persist(store, key)`.** Serialises the checkpoint and passes it to `store.save(key, json)`.
- **`Checkpoint.recall(store, key)`.** Reads from the store, deserialises, and returns a `Checkpoint` or `null`.
- **`ckpt.restoreState(adapter)`.** Calls `adapter(snapshot)` to reconstruct the domain state from the serialised snapshot. The adapter is the `restoreState` function registered on the dispatcher.
- **`dispatcher.resume(dagName, state, cursor)`.** Starts from the recalled cursor instead of the DAG's entrypoint. Only the remaining nodes execute; completed stages before the cursor are not re-run.
- **`MemoryCheckpointStore`.** In-process reference implementation. Swap with any `CheckpointStore` (Postgres, Redis, S3) without changing the calling code.

## Related Concepts

- [Example 08: Checkpoint and Resume](./08-checkpoint) - checkpoint mechanics in The Archivist
- [Checkpoint guide](../guide/checkpoint) - Checkpoint.capture, restore, cursor semantics
- [Persistence guide](../guide/persistence) - Postgres, Redis, and S3 CheckpointStore examples
- [Example 16: Scatter resume](./16-scatter-resume) - durable inbox: resumability across a scatter abort
- [Reference: Checkpoint](../reference/checkpoint)
