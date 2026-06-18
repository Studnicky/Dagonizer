---
title: 'State accessors'
description: 'StateAccessor contract; DottedPathAccessor walks dotted paths and auto-vivifies on write.'
seeAlso:
  - text: 'Subclassing State'
    link: './subclassing'
    description: 'the state object the accessor reads from and writes to'
  - text: 'DAGBuilder'
    link: './builder'
    description: 'placements that use `source` and `target` paths run through the accessor'
---

# State accessors

Scatter source reads, scatter state-mapping input copies, and gather writes all walk paths into the live state object. The `StateAccessor` contract defines that walk; `DottedPathAccessor` is the default implementation.

## API surface

| Symbol | Source | Role |
|--------|--------|------|
| `StateAccessor` | `@studnicky/dagonizer/contracts` | The contract, `get(state, path)` and `set(state, path, value)` |
| `DottedPathAccessor` | `@studnicky/dagonizer/runtime` | Default impl: `path.split('.')` walks, writes auto-vivify intermediate objects |
| `DagonizerOptionsInterface.accessor` | `@studnicky/dagonizer` | Constructor slot for a custom accessor |

## The contract

<<< @/../examples/dags/state-accessor.ts#contract-declaration

Implementations are stateless. The same instance is shared across every scatter source read, state-mapping input copy, and gather write.

## Default behavior

`DottedPathAccessor` ships in `@studnicky/dagonizer/runtime`:

<<< @/../examples/dags/state-accessor.ts#dotted-get

<<< @/../examples/dags/state-accessor.ts#dotted-set

Nested writes auto-vivify intermediate objects. Reads through a missing or non-object segment return `undefined`.

## Swapping in a custom accessor

Pass it via the dispatcher constructor:

<<< @/../examples/dags/state-accessor.ts#custom-accessor

<<< @/../examples/dags/state-accessor.ts#wire-accessor

The same accessor flows through every code path that resolves a state path:

- `scatter.source`: reading the array to scatter over.
- `scatter.stateMapping.input` (builder option `inputs`): copying parent fields into each clone before the body runs.
- `embeddedDAG.stateMapping.input` / `stateMapping.output`: seeding the child-state clone and copying fields back after the sub-DAG completes.
- `gather.mapping` (map strategy): writing produced clone fields back to parent paths.
- `gather.target` (append strategy): writing the gathered results.
- `gather.partitions` (partition strategy): writing each output bucket.

## Accessor inside gather strategies

Custom `GatherStrategy` subclasses receive the dispatcher's accessor on the execution context:

<<< @/../examples/state-accessor.ts#gather-strategy

Every state-path read and write goes through one resolution strategy.

## Related reference

- [Reference: Contracts](../reference/contracts)
- [Reference: Runtime](../reference/runtime)
- [Reference: Core](../reference/core)
