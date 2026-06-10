---
title: 'Example 16: Scatter resume (durable inbox)'
description: 'Scatter durable-inbox checkpoint and resume. The scatter engine persists in-flight items to a SCATTER_PROGRESS_KEY inbox. On abort, the checkpoint captures both inbox and ackedResults. On resume, inbox items are reprocessed first; acked items are never re-executed.'
seeAlso:
  - text: 'Phase 08: Checkpoint + resume'
    link: './08-checkpoint'
    description: 'checkpoint lifecycle: capture, persist, recall, resume'
  - text: 'Example 23: Checkpoint store'
    link: './23-checkpoint-store'
    description: 'MemoryCheckpointStore persist / recall round-trip'
  - text: 'Phase 04: Scatter scout'
    link: './04-scatter'
    description: 'scatter mechanics: source, body, gather, reduce'
  - text: 'Reference: Checkpoint'
    link: '../reference/checkpoint'
---

# Example 16: Scatter resume (durable inbox)

The scatter engine uses a durable-inbox model to survive crashes:

1. When an item is pulled from the source it enters the `inbox` (persisted in state metadata under `SCATTER_PROGRESS_KEY`).
2. When the body completes successfully the item leaves the inbox and moves to `ackedResults`.
3. On abort, `Checkpoint.capture` includes both inbox and `ackedResults`.
4. On resume, inbox items are reprocessed first (they may not have finished), then remaining source items continue. Acked items are never re-executed.

The worker node fires the `AbortController` after a fixed number of body invocations so the abort happens inside the running scatter — between item ack and the next pull. This is deterministic and credential-free.

```
Items 0–(ABORT_AFTER-1): run, ack, accumulate in ackedResults.
Item ABORT_AFTER: node body fires abort → scatter exits before next pull.
Items after abort: never pulled. Resume runs them fresh.
```

Watch: `execLog` shows different labels for Run 1 vs Run 2 items. The union of both logs covers all items with no duplicates.

## Code

<<< @/../examples/16-scatter-resume.ts

## What it demonstrates

- **Durable inbox.** The scatter pull loop persists each pulled item to the `inbox` before dispatching the body. The inbox survives process interruption via `Checkpoint.capture`.
- **`ackedResults` deduplication.** After a body completes, the engine moves the item from inbox to `ackedResults`. On resume, the engine skips any item whose key is already in `ackedResults` — no re-execution.
- **Inbox reprocessing.** Items that were in the inbox at checkpoint time (pulled but not yet acked) are re-run first on resume. The body is idempotent by design.
- **`SCATTER_PROGRESS_KEY`.** The constant under which the scatter engine stores the inbox and acked-results index in `state.metadata`. Inspect it after a checkpoint capture to see the progress snapshot.
- **`concurrency=1`.** Serial concurrency ensures the abort fires cleanly between items, making the example deterministic without wall-clock timers.

## Run

```bash
npx tsx examples/16-scatter-resume.ts
```
