---
title: 'Example 08: Checkpoint and Resume'
description: 'The Archivist mid-conversation: snapshot the state via ArchivistState.snapshotData and restoreData, persist to a CheckpointStore, restore in a later process, and resume from the cursor.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Checkpoint guide'
    link: '../guide/checkpoint'
  - text: 'Persistence guide'
    link: '../guide/persistence'
    description: 'Postgres example for `CheckpointStore`'
  - text: 'Example 06: Cancellation'
    link: './06-cancellation'
    description: 'produces the cursor that this phase checkpoints'
  - text: 'Reference: Checkpoint'
    link: '../reference/checkpoint'
  - text: 'Reference: Contracts, `CheckpointStore`'
    link: '../reference/contracts'
---

<script setup lang="ts">
import { ComposeRetryLoopDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 08: Checkpoint and Resume

## What It Is

Checkpoint and Resume is the other half of cancellation: when The Archivist stops mid-conversation, the host can persist the cursor and state, then continue later without replaying the expensive upstream work.

The Archivist state participates explicitly through `snapshotData()` and `restoreData()`. The dispatcher records where execution stops; the state adapter records what the domain knows at that moment.

## How It Works

`Checkpoint.capture` snapshots the interrupted execution result, including the cursor and serializable state. `ArchivistState` participates by overriding `snapshotData()` and `restoreData()`, the two methods `NodeStateBase` calls during capture and restore. A later process recalls the checkpoint, restores state, and calls `dispatcher.resume(...)` at the cursor without paying for upstream scouts again.

The resume path is intentionally boring in the best way: recall a checkpoint from a store, restore state with the adapter, and resume at the cursor. Postgres, Redis, S3, or memory storage all satisfy the same `CheckpointStore` boundary.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The compose / validate loop in [The Archivist](./the-archivist) is the expensive segment: multiple LLM calls per attempt. If the visitor's session times out mid-loop, the checkpoint records the cursor (`compose-response` or `validate-response`), the partial draft, and the attempt counter.

<DagJsonMermaid :dag="ComposeRetryLoopDAG" title="compose-retry-loop" aria-label="compose-retry-loop JSON-LD DAG beside Mermaid generated from it." />

### Run

```bash
npx tsx examples/the-archivist/runArchivist.ts
```

## What It Lets You Do

Checkpoint and resume lets applications recover interrupted work without starting the whole DAG over. Use it when a flow can be cancelled, timed out, parked, or moved to another host, and the remaining work should continue from a recorded cursor.

For an interactive app, this is what makes long-running orchestration feel civilized. A session can pause, migrate, or fail over; users do not lose the parts of the run that already produced useful state.

## Code Samples

#### State snapshot round-trip

The `#snapshot-restore` region covers `snapshotData()` and `restoreData()`, the two methods that serialize and rehydrate the domain fields (`query`, `intent`, `terms`, `candidates`, `shortlist`, `draft`, `approved`, `attempts`, `recalledContext`, `memoryDigest`):

<<< @/../examples/the-archivist/ArchivistState.ts#snapshot-restore

#### Cancellation, checkpoint, resume

The `#cancellation-run` region in the runner shows the execute call with `signal` and `deadlineMs`, the cursor check after cancellation, and how to read the lifecycle kind:

<<< @/../examples/the-archivist/runArchivist.ts#cancellation-run

## Details for Nerds

### Persist and resume

The `#resume-run` region in the runner performs the actual persist and resume path against a `MemoryCheckpointStore`. Swap to any `CheckpointStore` implementation (Postgres, Redis, S3) without changing the calling code:

<<< @/../examples/the-archivist/runArchivist.ts#resume-run

### What it demonstrates
- **`ArchivistState.snapshotData()` and `restoreData()`.** Domain-specific serialization. `NodeStateBase` calls `snapshotData` during `Checkpoint.capture` and `restoreData` during `ckpt.restoreState(adapter)`. The lifecycle resets to `pending` on restore; the resumed execution is a fresh lifecycle run on the recovered state data.
- **`Checkpoint.capture(dagName, result)`.** Produces a `Checkpoint` instance only when `result.cursor !== null` (an in-progress flow). A completed flow produces no cursor.
- **`CheckpointStore` adapter contract.** `MemoryCheckpointStore` is the test-time implementation. Swap to Postgres, Redis, or S3 without touching the dispatcher or state.
- **`ckpt.persist(store, key)` and `Checkpoint.recall(store, key)`.** Codec plus store in one call per side. `Checkpoint.recall` returns `null` when nothing is stored under the key.
- **`dispatcher.resume(dagName, state, cursor)`.** Starts from the recalled cursor instead of the DAG's entrypoint. The compose/validate retry budget (`state.retriesFor('compose')`, part of the snapshot) survives the round-trip so the loop is still bounded.

See this in action in the [Archivist live demo](./the-archivist).

## Related Concepts

- [Running domain: The Archivist](./the-archivist)
- [Checkpoint guide](../guide/checkpoint)
- [Persistence guide](../guide/persistence) - Postgres example for `CheckpointStore`
- [Example 06: Cancellation](./06-cancellation) - produces the cursor that this phase checkpoints
- [Reference: Checkpoint](../reference/checkpoint)
- [Reference: Contracts, `CheckpointStore`](../reference/contracts)
