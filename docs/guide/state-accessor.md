---
seeAlso:

  - text: 'Subclassing State'

    link: './subclassing'
    description: 'the state object the accessor reads from and writes to'

  - text: 'DAGBuilder'

    link: './builder'
    description: 'placements that use `source` / `target` paths run through the accessor'
---

# State accessors

Fan-out source reads, fan-in writes, and deep-DAG state mapping all walk paths into the live state object. The default `DottedPathAccessor` walks `path.split('.')` and creates intermediate plain objects on write.

## The contract

```ts
import type { StateAccessor } from '@noocodex/dagonizer/contracts';

interface StateAccessor {
  get(state: object, path: string): unknown;
  set(state: object, path: string, value: unknown): void;
}
```

Implementations are stateless. The same instance is shared across every fan-out, fan-in, and deep-DAG step.

## Default behavior

`DottedPathAccessor` ships in `@noocodex/dagonizer/runtime`:

```ts
import { DottedPathAccessor } from '@noocodex/dagonizer/runtime';

const accessor = new DottedPathAccessor();
accessor.get({ a: { b: 1 } }, 'a.b');  // → 1
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

- `fanOut.source` — reading the array to fan over.
- `fanIn.target` (append strategy) — writing the merged results.
- `fanIn.partitions` (partition strategy) — writing each output bucket.
- `deepDAG.stateMapping.input` / `output` — copying fields between parent and child state.

## Accessor inside fan-in strategies

Custom `FanInStrategy` subclasses receive the dispatcher's accessor on the execution context:

```ts
class AverageFanIn extends FanInStrategy {
  readonly name = 'average';
  async apply<TState extends NodeStateInterface>(
    config: FanInConfig,
    execution: FanInExecution<TState>,
  ): Promise<void> {
    if (config.target === undefined) return;
    const all = [...execution.results.values()].flat() as number[];
    const avg = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
    execution.accessor.set(execution.state, config.target, avg);
  }
}
```

This keeps every state-path read/write going through one resolution strategy.
## Related reference

- [Reference: Contracts — `StateAccessor`](../reference/contracts)
- [Reference: Runtime — `DottedPathAccessor`](../reference/runtime)
- [Reference: Core — `FanInExecution.accessor`](../reference/core)
