---
title: 'State Accessor'
description: 'DottedPathAccessor and a custom PrefixAccessor wired into a Dagonizer instance. The StateAccessorInterface contract replaces the built-in dotted-path resolver used by scatter source reads and gather writes.'
seeAlso:
  - text: 'State Accessors'
    link: '../guide/state-accessor'
    description: 'DottedPathAccessor, StateAccessorInterface contract, and wiring'
  - text: 'Example 04: Scatter Scout'
    link: './04-scatter'
    description: 'scatter source reads via DottedPathAccessor'
  - text: 'Reference: Contracts'
    link: '../reference/contracts'
    description: 'StateAccessorInterface contract'
---

# State Accessor

## What It Is

State Accessor shows how an application can replace the built-in dotted-path resolver used by scatter source reads and gather writes. The example wires `DottedPathAccessor` and a custom `PrefixAccessor` into a `Dagonizer` instance.

Use this when state is namespaced, wrapped, proxied, or backed by a structure that is not a plain JavaScript object path.

## How It Works

The dispatcher calls the configured `StateAccessorInterface` whenever it reads a scatter source path or writes gather output. `PrefixAccessor` prepends a namespace before delegating to `DottedPathAccessor`, so the DAG can keep short path names while the host stores data under a scoped subtree.

## Diagrams, Examples, and Outputs

This page has no DAG diagram because it demonstrates accessor replacement, not a routed graph. The CLI output shows direct reads/writes, prefixed reads/writes, and dispatcher construction with the custom accessor.

### Run

```bash
npx tsx examples/state-accessor.ts
```

## What It Lets You Do

Custom state accessors let applications change how scatter source reads and gather writes resolve paths in state. Use them when your state is namespaced, wrapped, proxied, or backed by a structure that is not a simple dotted JavaScript object path.

`DottedPathAccessor` is the built-in path resolver used by scatter source reads and gather writes. Applications implement the `StateAccessorInterface` contract to replace it. `PrefixAccessor` (defined in `examples/dags/state-accessor.ts`) prepends a fixed namespace segment to every key before delegating to `DottedPathAccessor`.

This example shows:

1. Direct `get`/`set` via `DottedPathAccessor` on a concrete `NodeStateBase`.
2. The same operations through `PrefixAccessor`.
3. A `Dagonizer` constructed with the custom accessor (`accessor` option).

## Code Samples

<<< @/../examples/state-accessor.ts

## Details for Nerds

- **`DottedPathAccessor`.** The built-in implementation. `get(target, 'a.b.c')` reads `target.a.b.c` using dot-segment traversal. `set(target, 'a.b.c', value)` writes at the same path, creating intermediate objects as needed.
- **`StateAccessorInterface` contract.** Two methods: `get<T>(target, path): T | null` and `set(target, path, value): void`. Implement both to replace the built-in resolver.
- **`PrefixAccessor`.** Prepends a fixed namespace to every path before delegating. Useful when a dispatcher instance manages a namespaced sub-tree of a larger state object — all scatter reads and gather writes land in the namespace automatically.
- **`accessor` option.** Pass a `StateAccessorInterface` implementation as `accessor:` in the `Dagonizer` constructor. The dispatcher uses it for all scatter source reads and gather writes in that instance.

## Related Concepts

- [State Accessors](../guide/state-accessor) - DottedPathAccessor, StateAccessorInterface contract, and wiring
- [Example 04: Scatter Scout](./04-scatter) - scatter source reads via DottedPathAccessor
- [Reference: Contracts](../reference/contracts) - StateAccessorInterface contract
