---
title: 'Example 16: Scatter Resume'
description: 'Scatter durable-inbox checkpoint and resume. The scatter engine persists in-flight items to a SCATTER_PROGRESS_KEY inbox. On abort, the checkpoint captures both inbox and ackedResults. On resume, inbox items are reprocessed first; acked items are never re-executed.'
seeAlso:
  - text: 'Example 08: Checkpoint and Resume'
    link: './08-checkpoint'
    description: 'checkpoint lifecycle: capture, persist, recall, resume'
  - text: 'Example 23: Checkpoint store'
    link: './23-checkpoint-store'
    description: 'MemoryCheckpointStore persist / recall round-trip'
  - text: 'Example 04: Scatter Scout'
    link: './04-scatter'
    description: 'scatter mechanics: source, body, gather, reduce'
  - text: 'Reference: Checkpoint'
    link: '../reference/checkpoint'
---

<script setup lang="ts">
import { cartographerResumeDAG } from '../../examples/the-cartographer/dag.ts';
</script>

# Example 16: Scatter Resume

## What It Is

Scatter Resume is for long fan-out work that can stop halfway through. The Cartographer streams source events through a scatter, aborts in the middle of the run, checkpoints progress, and resumes without replaying items that already completed.

The runtime does this with a durable inbox. Pulled items are recorded before execution, acknowledged items are recorded after execution, and checkpoint/resume uses those two sets to decide what is safe to skip and what must be retried.

## How It Works

The engine records scatter progress under `SCATTER_PROGRESS_KEY` in state metadata. Pulled items enter the inbox before body execution. Completed items move to `ackedResults`. A checkpoint preserves both structures. Resume drains inbox items first because their completion is uncertain, skips acked items because they already finished, and then continues pulling the remaining source.

Application code still defines an ordinary scatter. The resume behavior belongs to the dispatcher and checkpoint state, so the DAG stays readable: source, body, gather, and routes remain the pieces you author.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The JSON-LD graph is a normal scatter; the resume behavior comes from checkpoint metadata captured while that scatter is running. [The Cartographer](./the-cartographer) owns this runnable path through `cartographerResumeDAG` and `CartographerResumableScenario`.

<DagJsonMermaid :dag="cartographerResumeDAG" title="Cartographer scatter resume DAG" aria-label="Cartographer resume JSON-LD DAG beside Mermaid generated from it." />

The scatter engine uses a durable-inbox model to survive crashes:

1. When an item is pulled from the source it enters the `inbox` (persisted in state metadata under `SCATTER_PROGRESS_KEY`).
2. When the body completes successfully the item leaves the inbox and moves to `ackedResults`.
3. On abort, `Checkpoint.capture` includes both inbox and `ackedResults`.
4. On resume, inbox items are reprocessed first (they may not have finished), then remaining source items continue. Acked items are never re-executed.

The resumable scenario fires an abort after a fixed number of stream completions so the abort happens inside the running scatter. This is deterministic and credential-free.

```
Items 0–(ABORT_AFTER-1): run, ack, accumulate in ackedResults.
Item ABORT_AFTER: node body fires abort → scatter exits before next pull.
Items after abort: never pulled. Resume runs them fresh.
```

Watch: `execLog` shows different labels for Run 1 vs Run 2 items. The union of both logs covers all items with no duplicates.

### Run

```bash
npx tsx examples/the-cartographer/runCartographer.ts --stream
```

## What It Lets You Do

Scatter resume lets applications restart long fan-out work without re-running completed items. Use it when clone bodies call external APIs, model providers, or expensive transforms and a crash, abort, or timeout should replay only uncertain work.

This is the scatter version of exactly-once-at-the-DAG-boundary thinking: node bodies still need to be idempotent, but the engine gives the application a durable record of which source items are already done.

## Code Samples

The DAG snippet shows the scatter shape. The scenario snippet shows the deterministic abort, checkpoint capture, resume call, and execution log used by the runnable Cartographer demo.

<<< @/../examples/the-cartographer/dag.ts#cartographer-resume-dag

<<< @/../examples/the-cartographer/runCartographer.ts#cartographer-resumable-scenario

## Details for Nerds

- **Durable inbox.** The scatter pull loop persists each pulled item to the `inbox` before dispatching the body. The inbox survives process interruption via `Checkpoint.capture`.
- **`ackedResults` deduplication.** After a body completes, the engine moves the item from inbox to `ackedResults`. On resume, the engine skips any item whose key is already in `ackedResults` — no re-execution.
- **Inbox reprocessing.** Items that were in the inbox at checkpoint time (pulled but not yet acked) are re-run first on resume. The body is idempotent by design.
- **`SCATTER_PROGRESS_KEY`.** The constant under which the scatter engine stores the inbox and acked-results index in `state.metadata`. Inspect it after a checkpoint capture to see the progress snapshot.
- **No reservoir in the resume DAG.** The runnable resume variant uses per-item dispatch so abort can leave a meaningful stream cursor.

## Related Concepts

- [Example 08: Checkpoint and Resume](./08-checkpoint) - checkpoint lifecycle: capture, persist, recall, resume
- [Example 23: Checkpoint store](./23-checkpoint-store) - MemoryCheckpointStore persist / recall round-trip
- [Example 04: Scatter Scout](./04-scatter) - scatter mechanics: source, body, gather, reduce
- [Reference: Checkpoint](../reference/checkpoint)
