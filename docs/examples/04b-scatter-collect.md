---
title: 'Example 04b: Scatter collect (generate-and-select)'
description: 'ScatterNode generate-and-select pattern: map gather collects each clone''s produced candidate into a parent-state array in source-index order.'
seeAlso:
  - text: 'Phase 04: Scatter scout'
    link: './04-scatter'
    description: 'scatter mechanics: source, body, gather, reduce'
  - text: 'Example 04c: Scatter with container binding'
    link: './04c-scatter-workers'
    description: 'bind a container role to a scatter placement'
  - text: 'Example 14: Gather strategies'
    link: './14-gather-strategies'
    description: 'collect vs discard side-by-side'
  - text: 'Reference: Core, GatherStrategies'
    link: '../reference/core'
---

# Example 04b: Scatter collect (generate-and-select)

A `ScatterNode` runs a body over every item in a source array; each clone produces a candidate via the `map` gather strategy. The parent sees an ordered array of candidates when the scatter completes — one entry per source item in source-index order.

The generate-and-select pattern is common in LLM pipelines: scatter over a set of prompts or queries, each clone generates one candidate, and the parent picks from the collected array.

## Code

<<< @/../examples/04b-scatter-collect.ts

## What it demonstrates

- **`map` gather strategy.** Each clone writes one value to a named target field on parent state. The engine writes `state[target][cloneIndex]` after each clone body completes, in source-index order. The parent sees a fully-populated array when the scatter resolves.
- **Scatter body node.** The `body` references a registered node by name. The node reads `state.metadata.currentItem` for the item assigned to its clone and writes the output value before routing to `success`.
- **`any-success` outcome reducer.** Routes `success` when at least one clone succeeded. A single working candidate is enough for the parent to continue.
- **Source-index ordering.** Map gather writes results at the index matching the source position, not the completion order. The output array is stable regardless of which clones finish first when running with `concurrency > 1`.

## Run

```bash
npx tsx examples/04b-scatter-collect.ts
```
