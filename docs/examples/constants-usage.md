---
title: 'Constants Usage'
description: 'Every typed constant from @studnicky/dagonizer/constants used as runtime guards: GatherStrategyName, MetadataKey, NodeType, Output, and ScatterOutput.'
seeAlso:
  - text: 'Example 14: Gather strategies'
    link: './14-gather-strategies'
    description: 'GatherStrategyName values in a live scatter DAG'
  - text: 'Reference: Core'
    link: '../reference/core'
    description: 'constants module reference'
---

# Constants Usage

## What It Is

Constants Usage shows how to use Dagonizer’s exported runtime constants instead of hardcoded strings. The example exercises `GatherStrategyName`, `MetadataKey`, `NodeType`, `Output`, and `ScatterOutput` as guards and lookup values.

This is a small CLI example rather than a DAG demo. It exists for application code that needs to validate engine tokens, build selectors, or write tests that stay aligned with the schema-derived constants.

## How It Works

Every exported constant has two surfaces: a frozen runtime lookup object and a TypeScript type derived from the schema. Application code can enumerate the runtime object for validation while preserving compile-time narrowing in TypeScript.

## Diagrams, Examples, and Outputs

This page has no DAG diagram because it does not register or execute a graph. The runnable output is the CLI script proving that the constants can be used as runtime guards.

### Run

```bash
npx tsx examples/constants-usage.ts
```

## What It Lets You Do

Typed constants let applications validate and compare engine string values without hardcoding routing tokens, metadata keys, node kinds, or gather names. Use them in custom validators, UI selectors, test fixtures, and guard code that must stay aligned with Dagonizer's schema-derived values.

Every typed constant from `@studnicky/dagonizer/constants` ships a frozen runtime lookup object (plural name, e.g. `NodeTypes`) and a `FromSchema`-derived TypeScript type (singular name, e.g. `NodeType`). This example exercises each constant as a runtime guard and prints the results — no dispatcher, no DAG execution required.

Constants demonstrated:

| Constant | Purpose |
|----------|---------|
| `Output` | `'success'` and `'error'` — standard routing token names |
| `NodeType` | `'SingleNode'`, `'ScatterNode'`, `'EmbeddedDAGNode'`, `'TerminalNode'`, `'PhaseNode'` |
| `GatherStrategyName` | `'map'`, `'append'`, `'collect'`, `'partition'`, `'discard'`, `'custom'` |
| `MetadataKey` | `'currentItem'`, `'itemIndex'`, and `'gatherResults'` — keys the engine writes into `state.metadata` |
| `ScatterOutput` | `'all-success'`, `'all-error'`, `'partial'`, `'empty'` — outcome-reducer routing tokens |

## Code Samples

<<< @/../examples/constants-usage.ts

## Details for Nerds

- **Frozen runtime objects.** `Object.values(GatherStrategyNames)` enumerates all valid gather strategy names. Use this for validation or for building a selector that accepts only known strategies.
- **`MetadataKeys.CURRENT_ITEM`.** The key the engine writes per scatter clone so nodes can read `state.getMetadata(MetadataKeys.CURRENT_ITEM)` (or a typed `state.getter.*` accessor) without hardcoding strings.
- **`NodeType` as a type guard.** `type === NodeTypes.SCATTER` narrows the node shape to `ScatterNode` in TypeScript.
- **`ScatterOutput` routing tokens.** `all-success`, `all-error`, `partial`, and `empty` are the outcome-reducer routing tokens. The constant ensures consuming code references the same string the reducer emits.

## Related Concepts

- [Example 14: Gather strategies](./14-gather-strategies) - GatherStrategyName values in a live scatter DAG
- [Reference: Core](../reference/core) - constants module reference
