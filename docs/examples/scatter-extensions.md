---
title: 'Example: Scatter extensions (custom gather + reducer)'
description: 'TopNGatherStrategy and ThresholdReducer installed via GatherStrategies.register and OutcomeReducers.register. A scatter DAG references both plugins by name — no dispatcher changes required.'
seeAlso:
  - text: 'Example 14: Gather strategies'
    link: './14-gather-strategies'
    description: 'collect vs discard: built-in strategy comparison'
  - text: 'Example 15: Incremental gather'
    link: './15-incremental-gather'
    description: 'applyIncremental hook timing'
  - text: 'Phase 04: Scatter scout'
    link: './04-scatter'
    description: 'scatter mechanics: source, body, gather, reduce'
  - text: 'Reference: Core, GatherStrategies'
    link: '../reference/core'
---

# Example: Scatter extensions (custom gather + reducer)

`GatherStrategies.register` and `OutcomeReducers.register` install custom plugins into the global registries. A scatter placement then references them by name. No dispatcher or DAG document changes are needed beyond the `gather.strategy` and `reduce` keys.

This example registers two plugins:

- **`TopNGatherStrategy`** — collects the top-3 candidates by score from each clone's state into `state.topCandidates`.
- **`ThresholdReducer`** — gates `'success'` on ≥ 75% of clones returning `'success'`; routes `'partial'` below that threshold.

## Code

<<< @/../examples/scatter-extensions.ts

## What it demonstrates

- **`GatherStrategies.register(name, strategy)`.** Installs a custom `GatherStrategy` implementation into the global registry. Any scatter placement whose `gather.strategy` field matches the name uses this implementation.
- **Custom `GatherStrategy`.** Implement `apply(state, records)` (batch gather, called once after all clones) and optionally `applyIncremental(state, record)` (called per clone as it completes). The `TopNGatherStrategy` sorts by score and keeps only the top 3, merging into `state.topCandidates`.
- **`OutcomeReducers.register(name, reducer)`.** Installs a custom `OutcomeReducer` into the global registry. A scatter placement's `reduce` field references it by name.
- **Custom `OutcomeReducer`.** Receives the array of clone outcomes (`'success'` / `'error'` / `'empty'`) and returns the routing token for the parent's output port. `ThresholdReducer` computes the success ratio and routes `'success'` at ≥ 75%, `'partial'` below.
- **Side-effect registration.** Importing `examples/dags/scatter-extensions.ts` triggers the `register` calls. The convention is to register in the module that defines the plugin, so any consumer that imports the module gets the plugin installed automatically.

## Run

```bash
npx tsx examples/scatter-extensions.ts
```
