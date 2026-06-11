---
title: 'Example 14: Gather strategies (collect + discard)'
description: 'Side-by-side comparison of collect and discard gather strategies. collect accumulates each clone''s output token into a target array in source-index order; discard is an explicit no-op for fire-and-forget scatter bodies.'
seeAlso:
  - text: 'Phase 04: Scatter scout'
    link: './04-scatter'
    description: 'scatter mechanics: source, body, gather, reduce'
  - text: 'Example 04b: Scatter collect'
    link: './04b-scatter-collect'
    description: 'map gather: generate-and-select pattern'
  - text: 'Example 15: Incremental gather'
    link: './15-incremental-gather'
    description: 'incremental vs batch gather timing'
  - text: 'Reference: Core, GatherStrategies'
    link: '../reference/core'
---

# Example 14: Gather strategies (collect + discard)

Two scatter runs share the same worker node (`tag`) and differ only in their `gather` config. The `collect` strategy accumulates each clone's output token into a parent-state array in source-index order. The `discard` strategy is an explicit no-op: clones run for side-effects only and nothing is merged back into parent state.

```
collect run → state.tokens = ['done', 'done', 'done', 'done']
discard run → state.tokens = []  (nothing merged)
```

## Code

<<< @/../examples/14-gather-strategies.ts

## What it demonstrates

- **`collect` gather strategy.** Gathers each clone's output token (or a named clone field via the `field` option) into a target array on the parent state, in source-index order. Every clone contributes exactly one entry. The result collection is ordered by source index, not completion order.
- **`field` option on `collect`.** When `field` is set, the strategy reads `clone.state[field]` instead of the routing token. Omit `field` to collect the output token itself.
- **`discard` gather strategy.** An explicit no-op. The parent state after the scatter is byte-identical to the parent state before it (modulo lifecycle fields). Use `discard` when scatter bodies write to an external system (queue, database, HTTP endpoint) and produce no parent-visible result.
- **Same body, different gather.** Both DAGs register the same `tag` node. Only the `gather` key on the scatter placement differs, demonstrating that gather is a declarative policy on the placement, not a property of the node.

## Run

```bash
npx tsx examples/14-gather-strategies.ts
```
