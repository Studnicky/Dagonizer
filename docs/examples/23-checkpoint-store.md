---
title: 'Example 23: Checkpoint Store'
description: 'Persist a mid-run checkpoint to MemoryCheckpointStore and resume from it in a fresh dispatcher. Demonstrates the full checkpoint-store lifecycle: abort after first stage, capture, persist, recall, restore, resume.'
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
import { archivistDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 23: Checkpoint Store

## What It Is

Checkpoint Store is the persistence boundary for resumable DAGs. The Archivist captures a parked run, writes the checkpoint outside process memory, recalls it later, restores state and stores, and resumes from the recorded cursor.

The demo uses browser and memory-backed stores, but the contract is the same for Postgres, Redis, S3, IndexedDB, or any application store that implements `CheckpointStore`.

## How It Works

`Checkpoint.capture` creates a JSON-serializable checkpoint from an interrupted result. `ckpt.persist(store, key)` writes it through the `CheckpointStore` interface. `Checkpoint.recall(store, key)` loads and validates it. The caller restores state and stores, then resumes the same DAG from the captured cursor.

The checkpoint store does not execute the DAG and does not know application state classes. It persists the checkpoint payload; the dispatcher registry and restore adapter reconstruct executable state when the application resumes.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The graph is the live [Archivist](./the-archivist) DAG; persistence is the checkpoint round-trip between park and resume. The browser runner captures a checkpoint on demand and restores state plus memory before resuming.

<DagJsonMermaid :dag="archivistDAG" title="Archivist checkpoint-store DAG" aria-label="Archivist JSON-LD DAG beside Mermaid generated from it." />

Full checkpoint lifecycle in the browser runner:

1. Execute the Archivist DAG until a run completes or parks for HITL.
2. Visitor clicks **Save Checkpoint**: capture the result as a `Checkpoint`, including the memory store.
3. Serialise it with `ckpt.toJson()` and store the JSON blob under a local key.
4. Visitor clicks **Resume from Checkpoint**: load the JSON blob and rebuild a `Checkpoint` with `Checkpoint.load()`.
5. Restore `ArchivistState` and stores.
6. Resume from the captured cursor.

The CLI persists through the `CheckpointStore` contract (`ckpt.persist(store, key)` / `Checkpoint.recall(store, key)`) against `MemoryCheckpointStore`; the browser runner serialises the same `Checkpoint` object directly to and from local storage with `ckpt.toJson()` / `Checkpoint.load()`, skipping the store indirection since the browser tab is its own storage boundary.

### Run

```bash
npm run docs:dev
```

## What It Lets You Do

Checkpoint stores let applications persist resumable DAG state outside process memory. Use this when a browser tab, serverless invocation, worker process, or queue worker may stop before the DAG finishes and another host must resume later.

This is the piece that turns checkpoint/resume from an in-memory trick into an application lifecycle feature: park now, persist under a correlation key, resume wherever the user or infrastructure shows up next.

## Code Samples

The browser snippets show capture and restore around a saved Archivist checkpoint. The CLI snippet shows the same lifecycle against `MemoryCheckpointStore`.

<<< @/../examples/the-archivist/app/ArchivistRunner.vue#checkpoint-store-capture

<<< @/../examples/the-archivist/app/ArchivistRunner.vue#checkpoint-store-restore

<<< @/../examples/the-archivist/runArchivist.ts#resume-run

## Details for Nerds

- **`Checkpoint.capture(dagName, result)`.** Produces a `Checkpoint` instance for an in-progress parked flow.
- **`ckpt.toJson()` / `Checkpoint.load(parsed)`.** The browser runner's direct serialise/deserialise pair; used in place of `persist`/`recall` when the caller is already holding the storage boundary (a browser tab's local storage).
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
