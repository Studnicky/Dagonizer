---
title: 'Example 15: Incremental gather'
description: 'Incremental vs batch scatter gather. Built-in strategies with applyIncremental fold each clone''s result into parent state immediately after that clone completes. Strategies without applyIncremental accumulate all records in memory and apply once after every clone is done.'
seeAlso:
  - text: 'Example 14: Gather strategies'
    link: './14-gather-strategies'
    description: 'collect vs discard: two gather strategies side-by-side'
  - text: 'Example 16: Scatter resume'
    link: './16-scatter-resume'
    description: 'durable-inbox checkpoint and resume across a scatter abort'
  - text: 'Reference: Core, GatherStrategies'
    link: '../reference/core'
---

# Example 15: Incremental gather

Gather strategies that implement `applyIncremental` fold each clone's result into parent state immediately after that clone's body completes — before the next clone starts. The built-in strategies (`map`, `append`, `collect`, `partition`) all implement this hook.

Strategies without `applyIncremental` (`custom`, and any consumer strategy that omits the override) accumulate all records in memory and call `apply` once after every clone is done. The parent's gather target is empty until the entire scatter finishes.

This example registers two observable custom strategies that log their fold calls so the timing difference is visible in console output:

- `logging-map` — has `applyIncremental`; logs one fold per clone as it completes.
- `batch-only` — no `applyIncremental`; logs one `apply` call at the end.

Both run at `concurrency=1` on the same 4-item source so the fold sequence is deterministic.

## Code

<<< @/../examples/15-incremental-gather.ts

## What it demonstrates

- **`applyIncremental` hook.** When a gather strategy implements `applyIncremental(state, record)`, the engine calls it immediately after each clone body finishes. No wait for the full scatter to drain. The parent's gather target grows item-by-item.
- **Batch-only strategies.** Without `applyIncremental`, the engine buffers all clone records and calls `apply(state, records)` once at the end. Memory usage scales with the number of items; parent state is unchanged until the scatter fully drains.
- **When to use incremental.** Incremental folding reduces peak memory usage and enables early reads of partial results (e.g. streaming to a UI, writing to an append log as items complete). Batch-only is simpler to implement and sufficient when all records are needed before the parent can act.
- **`GatherStrategies.register`.** Custom strategies are installed into the global registry by name. Any scatter placement that references the name gets the custom strategy.

## Run

```bash
npx tsx examples/15-incremental-gather.ts
```
