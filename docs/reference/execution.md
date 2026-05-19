---
seeAlso:
  - text: 'Reference: Dagonizer — `execute`, `resume`'
    link: './dagonizer'
  - text: 'Reference: Lifecycle'
    link: './lifecycle'
  - text: 'Reference: Checkpoint'
    link: './checkpoint'
---

# Execution

`Execution<TState>` is the handle returned by `Dagonizer.execute()` and `Dagonizer.resume()`. It is both an `AsyncIterable` (streaming per stage) and a `PromiseLike` (awaitable for the final result). The underlying generator runs exactly once regardless of how it is consumed.

## Class: `Execution<TState>`

```ts
import { Execution } from '@noocodex/dagonizer';
```

Not instantiated directly — returned by the dispatcher.

---

### `[Symbol.asyncIterator]()`

Iterate stage results as they complete:

```ts
const execution = dispatcher.execute('my-flow', state);
for await (const node of execution) {
  console.log(node.nodeName, node.output);
}
const result = await execution; // cached — no second run
```

Each yielded `NodeResultInterface<TState>` carries:

| Field | Type | Description |
|-------|------|-------------|
| `nodeName` | `string` | Name of the node that completed |
| `output` | `string \| undefined` | Output name returned by the operation |
| `skipped` | `boolean` | `true` for an empty fan-out that bypassed execution |
| `state` | `TState` | Reference to the shared state object (mutated in place) |

For parallel and fan-out nodes, the iterator first yields intermediate results for each constituent node, then yields the group result.

---

### `.then(onfulfilled, onrejected)`

`Execution` implements `PromiseLike` — `await` it for the final `ExecutionResultInterface<TState>`:

```ts
const result = await dispatcher.execute('my-flow', state);
```

If the iterator has already been consumed, the cached result is returned — the generator is not re-run.

`ExecutionResultInterface<TState>` carries:

| Field | Type | Description |
|-------|------|-------------|
| `state` | `TState` | Final state (same reference passed in) |
| `cursor` | `string \| null` | Next node to run on resume; `null` if completed normally |
| `executedNodes` | `string[]` | Nodes that ran (in order) |
| `skippedNodes` | `string[]` | Nodes skipped (empty fan-out) |

---

## Consumption patterns

**One-shot await:**

```ts
const result = await dispatcher.execute('flow', state);
if (result.cursor !== null) {
  // interrupted — checkpoint it
}
```

**Streaming with early exit:**

```ts
const execution = dispatcher.execute('flow', state, { signal: ctl.signal });
for await (const node of execution) {
  if (isHeavyNode(node.nodeName)) {
    ctl.abort(new Error('pause here'));
  }
}
const result = await execution; // result.cursor holds where we stopped
```

**Consuming both modes:**

```ts
const execution = dispatcher.execute('flow', state);
const nodes: string[] = [];
for await (const n of execution) nodes.push(n.nodeName);
const result = await execution; // same run, cached
console.log(nodes, result.cursor);
```

The iterator never throws. Cancellation and operation errors resolve to a final `ExecutionResultInterface` with a non-null `cursor` and the appropriate `lifecycle.kind`.
## Related guides

- [Cancellation](../guide/cancellation)
- [Checkpoint](../guide/checkpoint)
