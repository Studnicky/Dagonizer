---
title: 'Scatter Extensions'
description: 'TopNGatherStrategy and ThresholdReducer installed via GatherStrategies.register and OutcomeReducers.register. A scatter DAG references both registry keys without dispatcher changes.'
seeAlso:
  - text: 'Example 14: Gather strategies'
    link: './14-gather-strategies'
    description: 'collect vs discard: built-in strategy comparison'
  - text: 'Example 15: Incremental gather'
    link: './15-incremental-gather'
    description: 'reduce and finalize hook timing'
  - text: 'Example 04: Scatter Scout'
    link: './04-scatter'
    description: 'scatter mechanics: source, body DAG, gather placement, reduce'
  - text: 'Reference: Core, GatherStrategies'
    link: '../reference/core'
---

<script setup lang="ts">
import { scatterExtensionsDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Scatter Extensions

## What It Is

Scatter Extensions shows how an application adds domain-specific scatter behavior without changing dispatcher code. The CLI example installs `TopNGatherStrategy` and `ThresholdReducer`, then references both by registry key from a normal scatter DAG.

This is the extension seam behind custom gather and reducer policy: register the implementation once, then keep DAG assembly declarative.

## How It Works

`GatherStrategies.register(...)` and `OutcomeReducers.register(...)` install custom implementations into global registries. A scatter placement references them through `gather.strategy` and `reducer`. The dispatcher resolves those names at execution time.

## Diagrams, Examples, and Outputs

The DAG below is the same `reservoirDag` exported by the CLI example. It shows the custom gather strategy and reducer as graph configuration, not code branches inside the dispatcher.

<DagJsonMermaid :dag="scatterExtensionsDAG" title="scatter-extensions reservoir DAG" aria-label="Scatter extensions JSON-LD DAG beside Mermaid generated from it." />

### Run

```bash
npx tsx examples/scatter-extensions.ts
```

## What It Lets You Do

Scatter extensions let applications add domain-specific gather and reducer behavior without changing dispatcher code. Use them when built-in strategies do not match the merge policy or success threshold your DAG needs.

`GatherStrategies.register` and `OutcomeReducers.register` install custom plugins into the global registries. A scatter placement then references them by strategy/reducer key. No dispatcher or DAG document changes are needed beyond the `gather.strategy` and `reducer` keys.

This example registers two plugins:

- **`TopNGatherStrategy`** — collects the top-3 candidates by score from each clone's state into `state.topCandidates`.
- **`ThresholdReducer`** — gates `'success'` on ≥ 75% of clones returning `'success'`; routes `'partial'` below that threshold.

## Code Samples

<<< @/../examples/scatter-extensions.ts

## Details for Nerds

- **`GatherStrategies.register(strategy)`.** Installs a custom `GatherStrategy` implementation into the global registry under `strategy.name`. Any gather configuration whose `strategy` field matches the key uses this implementation.
- **Custom `GatherStrategy`.** Implement `reduce(config, batch, state, accessor)` (called per clone as it completes) and override `finalize(config, execution)` for all-at-once processing after every clone is done. The `TopNGatherStrategy` accumulates nothing in `reduce` and sorts by score in `finalize`, keeping only the top 3 and merging into `state.topCandidates`.
- **`OutcomeReducers.register(reducer)`.** Installs a custom `OutcomeReducer` into the global registry under `reducer.name`. A scatter placement's `reducer` field references that key.
- **Custom `OutcomeReducer`.** Receives the array of clone outcomes (`'success'` / `'error'` / `'empty'`) and returns the routing token for the parent's output port. `ThresholdReducer` computes the success ratio and routes `'success'` at ≥ 75%, `'partial'` below.
- **Side-effect registration.** Importing `examples/dags/scatter-extensions.ts` triggers the `register` calls. The convention is to register in the module that defines the plugin, so any application that imports the module gets the plugin installed automatically.

## Related Concepts

- [Example 14: Gather strategies](./14-gather-strategies) - collect vs discard: built-in strategy comparison
- [Example 15: Incremental gather](./15-incremental-gather) - reduce and finalize hook timing
- [Example 04: Scatter Scout](./04-scatter) - scatter mechanics: source, body DAG, gather placement, reduce
- [Reference: Core, GatherStrategies](../reference/core)
