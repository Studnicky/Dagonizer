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

Scatter source reads, scatter projection copies, and gather writes all walk paths into the live state object. The `StateAccessor` contract defines that walk; `DottedPathAccessor` is the default implementation.

## API surface

| Symbol | Source | Role |
|--------|--------|------|
| `StateAccessor` | `@noocodex/dagonizer/contracts` | The contract, `get(state, path)` and `set(state, path, value)` |
| `DottedPathAccessor` | `@noocodex/dagonizer/runtime` | Default impl: `path.split('.')` walks, writes auto-vivify intermediate objects |
| `DagonizerOptionsInterface.accessor` | `@noocodex/dagonizer` | Constructor slot for a custom accessor |

## The contract

```ts
import type { StateAccessor } from '@noocodex/dagonizer/contracts';

interface StateAccessor {
  get(state: object, path: string): unknown;
  set(state: object, path: string, value: unknown): void;
}
```

Implementations are stateless. The same instance is shared across every scatter source read, projection copy, and gather write.

## Default behavior

`DottedPathAccessor` ships in `@noocodex/dagonizer/runtime`:

```ts
import { DottedPathAccessor } from '@noocodex/dagonizer/runtime';

const accessor = new DottedPathAccessor();
accessor.get({ a: { b: 1 } }, 'a.b');  // 1
accessor.set({}, 'a.b.c', 'value');    // mutates in place to { a: { b: { c: 'value' } } }
```

Nested writes auto-vivify intermediate objects. Reads through a missing or non-object segment return `undefined`.

## Swapping in a custom accessor

Pass it via the dispatcher constructor:

```ts
import { Dagonizer } from '@noocodex/dagonizer';

class JsonPointerAccessor implements StateAccessor {
  get(state: object, path: string): unknown {
    // walk path as an RFC 6901 JSON Pointer
  }
  set(state: object, path: string, value: unknown): void {
    // write at the JSON Pointer location
  }
}

const dispatcher = new Dagonizer<MyState>({ accessor: new JsonPointerAccessor() });
```

The same accessor flows through every code path that resolves a state path:

- `scatter.source`: reading the array to scatter over.
- `scatter.projection`: copying parent fields into the clone before the body runs.
- `gather.mapping` (map strategy): writing produced clone fields back to parent paths.
- `gather.target` (append strategy): writing the gathered results.
- `gather.partitions` (partition strategy): writing each output bucket.

## Accessor inside gather strategies

Custom `GatherStrategy` subclasses receive the dispatcher's accessor on the execution context:

```ts
class AverageGather extends GatherStrategy {
  readonly name = 'average';
  async apply<TState extends NodeStateInterface>(
    config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void> {
    if (config.target === undefined) return;
    const all = execution.records.map((r) =>
      execution.accessor.get(r.cloneState, config.field ?? 'score') as number,
    );
    const avg = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
    execution.accessor.set(execution.state, config.target, avg);
  }
}
```

Every state-path read and write goes through one resolution strategy.

## Related reference

- [Reference: Contracts](../reference/contracts)
- [Reference: Runtime](../reference/runtime)
- [Reference: Core](../reference/core)
