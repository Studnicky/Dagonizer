---
title: 'State Accessors'
description: 'StateAccessor contract; DottedPathAccessor walks dotted paths and auto-vivifies on write.'
seeAlso:
  - text: 'Subclassing State'
    link: './subclassing'
    description: 'the state object the accessor reads from and writes to'
  - text: 'DAGBuilder'
    link: './builder'
    description: 'placements that use `source` and `target` paths run through the accessor'
---

# State Accessors

## Accessor Contract

State Accessors explains the tiny but important contract that decides how Dagonizer reads and writes state paths. `DottedPathAccessor` is the default: it walks dotted paths like `customer.address.city`, returns `undefined` for missing reads, and auto-vivifies intermediate objects on writes.

Custom accessors fit hosts where plain JavaScript dotted paths are not enough. They let the DAG contract stay stable while the state substrate changes underneath it: namespaced objects, proxy-backed stores, domain-specific path syntax, guarded writes, or any other state model that still needs scatter, embedded DAGs, and gather to agree on one path semantics.

## Path Resolution Contract

State-path resolution shows up at the contract and snippet level rather than as a standalone topology diagram. The same accessor governs every placement field that names a state path.

- [Subclassing State](./subclassing) - the state object the accessor reads from and writes to
- [DAGBuilder](./builder) - placements that use `source` and `target` paths run through the accessor
- [State Accessor](../examples/state-accessor) - custom accessor and gather-strategy flow

## Read/Write Contract

The dispatcher delegates path reads and writes to the configured accessor. Scatter `source`, embedded-DAG `stateMapping`, and gather `target` paths all flow through the same two methods: `get(state, path)` and `set(state, path, value)`.

Scatter source reads, scatter state-mapping input copies, and gather writes all walk paths into the live state object. The `StateAccessor` contract defines that walk; `DottedPathAccessor` is the default implementation.

## Code Samples

### API

| Symbol | Source | Role |
|--------|--------|------|
| `StateAccessor` | `@studnicky/dagonizer/contracts` | The contract, `get(state, path)` and `set(state, path, value)` |
| `DottedPathAccessor` | `@studnicky/dagonizer/runtime` | Default impl: `path.split('.')` walks, writes auto-vivify intermediate objects |
| `DagonizerOptionsType.accessor` | `@studnicky/dagonizer` | Constructor slot for a custom accessor |

### The contract

<<< @/../examples/dags/state-accessor.ts#contract-declaration

Implementations are stateless. The same instance is shared across every scatter source read, state-mapping input copy, and gather write.

## Operational Uses

A custom state accessor replaces dotted JavaScript paths when that is not the right read/write model for scatter sources, state mappings, or gather targets. This applies to namespaced state, proxy-backed state, alternate path syntaxes, or controlled write policies.

## Runtime Notes

### Default behavior

`DottedPathAccessor` ships in `@studnicky/dagonizer/runtime`:

<<< @/../examples/dags/state-accessor.ts#dotted-get

<<< @/../examples/dags/state-accessor.ts#dotted-set

Nested writes auto-vivify intermediate objects. Reads through a missing or non-object segment return `undefined`.

### Swapping in a custom accessor

Pass it via the dispatcher constructor:

<<< @/../examples/dags/state-accessor.ts#custom-accessor

<<< @/../examples/dags/state-accessor.ts#wire-accessor

The same accessor flows through every code path that resolves a state path:

- `scatter.source`: reading the array to scatter over.
- `scatter.stateMapping.input` (builder option `inputs`): copying parent fields into each clone before the body runs.
- `EmbeddedDAGNode.stateMapping.input` / `stateMapping.output`: seeding the child-state clone and copying fields back after the sub-DAG completes.
- `gather.mapping` (map strategy): writing produced clone fields back to parent paths.
- `gather.target` (append strategy): writing the gathered results.
- `gather.partitions` (partition strategy): writing each output bucket.

### Accessor inside gather strategies

Custom `GatherStrategy` subclasses receive the dispatcher's accessor on the execution context:

<<< @/../examples/state-accessor.ts#gather-strategy

Every state-path read and write goes through one resolution strategy.

## Related Concepts

- [Subclassing State](./subclassing) - the state object the accessor reads from and writes to
- [DAGBuilder](./builder) - placements that use `source` and `target` paths run through the accessor
- [State Accessor](../examples/state-accessor) - custom accessor example
- [Reference: Contracts](../reference/contracts)
- [Reference: Runtime](../reference/runtime)
- [Reference: Core](../reference/core)
