---
title: 'Phase 08: Checkpoint + resume'
description: 'The Archivist mid-conversation: snapshot the state via ArchivistState.snapshotData and restoreData, persist to a CheckpointStore, restore in a later process, and resume from the cursor.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Checkpoint guide'
    link: '../guide/checkpoint'
  - text: 'Persistence guide'
    link: '../guide/persistence'
    description: 'Postgres example for `CheckpointStore`'
  - text: 'Phase 06: Cancellation'
    link: './06-cancellation'
    description: 'produces the cursor that this phase checkpoints'
  - text: 'Reference: Checkpoint'
    link: '../reference/checkpoint'
  - text: 'Reference: Contracts, `CheckpointStore`'
    link: '../reference/contracts'
---

<script setup lang="ts">
import { CytoscapeRenderer } from '@noocodex/dagonizer/viz';
import type { ElementDefinition } from 'cytoscape';
import { ComposeRetryLoopDAG } from '@archivist/embedded-dags/ComposeRetryLoopDAG.ts';

const elements = CytoscapeRenderer.render(ComposeRetryLoopDAG) as ElementDefinition[];
</script>

# Phase 08: Checkpoint + resume

The compose / validate loop in [The Archivist](./the-archivist) is the most expensive segment: multiple LLM calls per attempt. If the visitor's session times out mid-loop, the dispatcher records the cursor (`compose-response` or `validate-response`), the partial draft, and the attempt counter. A later process recalls the checkpoint and finishes the response without paying for the upstream scouts again.

The `ArchivistState` makes this possible by overriding `snapshotData()` and `restoreData()`, the two methods `NodeStateBase` calls during `Checkpoint.capture` and the resume path.

<DagGraph :elements="elements" aria-label="ComposeRetryLoopDAG: checkpoint captures the cursor between compose and validate." />

## Code

### State snapshot round-trip

The `#snapshot-restore` region covers `snapshotData()` and `restoreData()`, the two methods that serialize and rehydrate the domain fields (`query`, `intent`, `terms`, `candidates`, `shortlist`, `draft`, `approved`, `attempts`, `recalledContext`, `memoryDigest`):

<<< @/../examples/the-archivist/ArchivistState.ts#snapshot-restore

### Cancellation, checkpoint, resume

The `#cancellation-run` region in the runner shows the execute call with `signal` and `deadlineMs`, the cursor check after cancellation, and how to read the lifecycle kind:

<<< @/../examples/the-archivist/runArchivist.ts#cancellation-run

## Persist and resume

The `#resume-run` region in the runner performs the actual persist and resume path against a `MemoryCheckpointStore`. Swap to any `CheckpointStore` implementation (Postgres, Redis, S3) without changing the calling code:

<<< @/../examples/the-archivist/runArchivist.ts#resume-run

## What it demonstrates

- **`ArchivistState.snapshotData()` and `restoreData()`.** Domain-specific serialization. `NodeStateBase` calls `snapshotData` during `Checkpoint.capture` and `restoreData` during `ckpt.restoreState(fn)`. The lifecycle resets to `pending` on restore; the resumed execution is a fresh lifecycle run on the recovered state data.
- **`Checkpoint.capture(dagName, result)`.** Produces a `Checkpoint` instance only when `result.cursor !== null` (an in-progress flow). A completed flow produces no cursor.
- **`CheckpointStore` adapter contract.** `MemoryCheckpointStore` is the test-time implementation. Swap to Postgres, Redis, or S3 without touching the dispatcher or state.
- **`ckpt.persist(store, key)` and `Checkpoint.recall(store, key)`.** Codec plus store in one call per side. `Checkpoint.recall` returns `null` when nothing is stored under the key.
- **`dispatcher.resume(dagName, state, cursor)`.** Starts from the recalled cursor instead of the DAG's entrypoint. The compose/validate retry counter (`state.attempts.compose`) survives the round-trip so the loop is still bounded.

See this in action in the [Archivist live demo](./the-archivist).
