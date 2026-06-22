---
title: 'Example: Constants usage'
description: 'Every typed constant from @studnicky/dagonizer/constants used as runtime guards: GatherStrategyName, MetadataKey, NodeType, Output, and ScatterOutput.'
seeAlso:
  - text: 'Example 14: Gather strategies'
    link: './14-gather-strategies'
    description: 'GatherStrategyName values in a live scatter DAG'
  - text: 'Reference: Core'
    link: '../reference/core'
    description: 'constants module reference'
---

# Example: Constants usage

Every typed constant from `@studnicky/dagonizer/constants` ships a frozen runtime lookup object (plural name, e.g. `NodeTypes`) and a `FromSchema`-derived TypeScript type (singular name, e.g. `NodeType`). This example exercises each constant as a runtime guard and prints the results — no dispatcher, no DAG execution required.

Constants demonstrated:

| Constant | Purpose |
|----------|---------|
| `Output` | `'success'` and `'error'` — standard routing token names |
| `NodeType` | `'SingleNode'`, `'ScatterNode'`, `'EmbeddedDAGNode'`, `'TerminalNode'`, `'PhaseNode'` |
| `GatherStrategyName` | `'map'`, `'append'`, `'collect'`, `'partition'`, `'discard'`, `'custom'` |
| `MetadataKey` | `'currentItem'`, `'itemIndex'`, and `'gatherResults'` — keys the engine writes into `state.metadata` |
| `ScatterOutput` | `'all-success'`, `'all-error'`, `'partial'`, `'empty'` — outcome-reducer routing tokens |

## Code

<<< @/../examples/constants-usage.ts

## What it demonstrates

- **Frozen runtime objects.** `Object.values(GatherStrategyNames)` enumerates all valid gather strategy names. Use this for validation or for building a selector that accepts only known strategies.
- **`MetadataKeys.CURRENT_ITEM`.** The key the engine writes per scatter clone so nodes can read `state.getMetadata(MetadataKeys.CURRENT_ITEM)` (or a typed `state.getter.*` accessor) without hardcoding strings.
- **`NodeType` as a type guard.** `type === NodeTypes.SCATTER` narrows the node shape to `ScatterNode` in TypeScript.
- **`ScatterOutput` routing tokens.** `all-success`, `all-error`, `partial`, and `empty` are the outcome-reducer routing tokens. The constant ensures consuming code references the same string the reducer emits.

## Run

```bash
npx tsx examples/constants-usage.ts
```
