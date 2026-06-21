---
title: 'Example: State accessor'
description: 'DottedPathAccessor and a custom PrefixAccessor wired into a Dagonizer instance. The StateAccessorInterface contract replaces the built-in dotted-path resolver used by scatter source reads and gather writes.'
seeAlso:
  - text: 'State accessors guide'
    link: '../guide/state-accessor'
    description: 'DottedPathAccessor, StateAccessorInterface contract, and wiring'
  - text: 'Phase 04: Scatter scout'
    link: './04-scatter'
    description: 'scatter source reads via DottedPathAccessor'
  - text: 'Reference: Contracts'
    link: '../reference/contracts'
    description: 'StateAccessorInterface contract'
---

# Example: State accessor

`DottedPathAccessor` is the built-in path resolver used by scatter source reads and gather writes. Consumers implement the `StateAccessorInterface` contract to replace it. `PrefixAccessor` (defined in `examples/dags/state-accessor.ts`) prepends a fixed namespace segment to every key before delegating to `DottedPathAccessor`.

This example shows:

1. Direct `get`/`set` via `DottedPathAccessor` on a concrete `NodeStateBase`.
2. The same operations through `PrefixAccessor`.
3. A `Dagonizer` constructed with the custom accessor (`accessor` option).

## Code

<<< @/../examples/state-accessor.ts

## What it demonstrates

- **`DottedPathAccessor`.** The built-in implementation. `get(target, 'a.b.c')` reads `target.a.b.c` using dot-segment traversal. `set(target, 'a.b.c', value)` writes at the same path, creating intermediate objects as needed.
- **`StateAccessorInterface` contract.** Two methods: `get<T>(target, path): T | null` and `set(target, path, value): void`. Implement both to replace the built-in resolver.
- **`PrefixAccessor`.** Prepends a fixed namespace to every path before delegating. Useful when a dispatcher instance manages a namespaced sub-tree of a larger state object — all scatter reads and gather writes land in the namespace automatically.
- **`accessor` option.** Pass a `StateAccessorInterface` implementation as `accessor:` in the `Dagonizer` constructor. The dispatcher uses it for all scatter source reads and gather writes in that instance.

## Run

```bash
npx tsx examples/state-accessor.ts
```
