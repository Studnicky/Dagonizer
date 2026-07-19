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

## Runtime Constant Surface

Constants Usage shows how to use Dagonizer’s exported runtime constants instead of hardcoded strings. The example exercises `GatherStrategyName`, `MetadataKey`, `NodeType`, `Output`, and `ScatterOutput` as guards and lookup values.

It targets consumer code that validates engine tokens, builds selectors, or writes tests that stay aligned with the schema-derived constants.

## CLI Output and Guard Coverage

The CLI exercises the constants directly at the package boundary instead of through a DAG. The output shows the guards and lookup values that consumer code can use at runtime.

### Run

```bash
npx tsx examples/constants-usage.ts
```

## Value-and-Type Contract

Every exported constant has two forms: a frozen runtime lookup object and a TypeScript type derived from the schema. Application code can enumerate the runtime object for validation while preserving compile-time narrowing in TypeScript.

## Code Samples

<<< @/../examples/constants-usage.ts

## Operational Uses

Typed constants let host and test code validate and compare engine string values without hardcoding routing tokens, metadata keys, node kinds, or gather names. Use them in custom validators, UI selectors, test fixtures, and guard code that must stay aligned with Dagonizer's schema-derived values.

Every typed constant from `@studnicky/dagonizer/constants` ships a frozen runtime lookup object (plural name, e.g. `NodeTypes`) and a `FromSchema`-derived TypeScript type (singular name, e.g. `NodeType`). The CLI exercises each constant as a runtime guard and prints the results — no dispatcher, no DAG execution required.

Constants in scope:

| Constant | Purpose |
|----------|---------|
| `Output` | `'success'` and `'error'` — standard routing token names |
| `NodeType` | `'SingleNode'`, `'ScatterNode'`, `'EmbeddedDAGNode'`, `'TerminalNode'`, `'PhaseNode'` |
| `GatherStrategyName` | `'map'`, `'append'`, `'collect'`, `'partition'`, `'discard'`, `'custom'` |
| `MetadataKey` | `'currentItem'`, `'itemIndex'`, and `'gatherResults'` — keys the engine writes into `state.metadata` |
| `ScatterOutput` | `'all-success'`, `'all-error'`, `'partial'`, `'empty'` — outcome-reducer routing tokens |

## Runtime Notes

- **Frozen runtime objects.** `Object.values(GatherStrategyNames)` enumerates all valid gather strategy names. Use this for validation or for building a selector that accepts only known strategies.
- **`MetadataKeys.CURRENT_ITEM`.** The key the engine writes per scatter clone so nodes can read `state.getMetadata(MetadataKeys.CURRENT_ITEM)` (or a typed `state.getter.*` accessor) without hardcoding strings.
- **`NodeType` as a type guard.** `type === NodeTypes.SCATTER` narrows the node shape to `ScatterNode` in TypeScript.
- **`ScatterOutput` routing tokens.** `all-success`, `all-error`, `partial`, and `empty` are the outcome-reducer routing tokens. The constant ensures consuming code references the same string the reducer emits.

## Related Concepts

- [Example 14: Gather strategies](./14-gather-strategies) - GatherStrategyName values in a live scatter DAG
- [Reference: Core](../reference/core) - constants module reference
