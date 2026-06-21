---
title: 'Example 15: Incremental gather'
description: 'Incremental vs batch scatter gather. GatherStrategy subclasses implement reduce (called per-clone as results arrive) and finalize (called once after all clones complete). Built-in strategies fold in reduce; the built-in custom strategy accumulates nothing in reduce and does all work in finalize.'
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

Every `GatherStrategy` subclass implements the fold contract:

- **`reduce(config, batch, state, accessor)`** — called once per clone (or per micro-batch) as results arrive. Override this to fold incrementally. Parent state grows after each clone completes.
- **`finalize(config, execution)`** — called once after all clones complete. Override this (and leave `reduce` as a no-op) for all-at-once processing.

The built-in `map`, `append`, `collect`, and `partition` strategies fold in `reduce` — parent state grows after each clone. The built-in `custom` strategy accumulates nothing in `reduce` and does its work in `finalize`.

This example registers two observable custom strategies that log their fold calls so the timing difference is visible in console output:

- `logging-map` — overrides `reduce`; logs one fold per clone as it completes.
- `batch-only` — no-op `reduce`, overrides `finalize`; logs one call at the end.

Both run at `concurrency=1` on the same 4-item source so the fold sequence is deterministic.

## Code

<<< @/../examples/15-incremental-gather.ts

## What it demonstrates

- **`reduce` hook.** When a gather strategy overrides `reduce(config, batch, state, accessor)`, the engine calls it immediately after each clone body finishes. No wait for the full scatter to drain. The parent's gather target grows item-by-item.
- **`finalize` hook.** Overriding `finalize(config, execution)` (with a no-op `reduce`) defers all gather work until after every clone completes. Memory usage scales with item count; parent state is unchanged until the scatter fully drains.
- **When to use per-clone `reduce`.** Reduces peak memory usage and enables early reads of partial results (e.g. streaming to a UI, writing to an append log as items complete). Sufficient for the common case where each clone's contribution is independent.
- **When to use `finalize`.** Use when the gather computation requires all clone records simultaneously (ranking, voting, cross-clone comparison). The `custom` built-in strategy uses this pattern.
- **`GatherStrategies.register`.** Custom strategies are installed into the global registry by name. Any scatter placement that references the name gets the custom strategy.

## Run

```bash
npx tsx examples/15-incremental-gather.ts
```
