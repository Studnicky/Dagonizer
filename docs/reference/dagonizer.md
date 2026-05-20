---
seeAlso:

  - text: 'Reference: Execution'

    link: './execution'
    description: 'what `execute` / `resume` return'

  - text: 'Reference: Contracts — `NodeInterface`, `ExecuteOptionsInterface`'

    link: './contracts'

  - text: 'Reference: Core — `ParallelCombiners`, `FanInStrategies`'

    link: './core'

  - text: 'Reference: Lifecycle'

    link: './lifecycle'
---

# Dagonizer

`@noocodex/dagonizer` — main entry point export.

## Class: `Dagonizer<TState, TServices>`

The DAG dispatcher. Holds the node and DAG registries, validates configurations at registration time, and runs the node-graph iterator.

```ts
import { Dagonizer } from '@noocodex/dagonizer';

const dispatcher = new Dagonizer<MyState>();
// With services:
const dispatcher = new Dagonizer<MyState, MyServices>({ services: { logger, db } });
```

`TState` must satisfy `NodeStateInterface`. In practice, always extend `NodeStateBase`. `TServices` is the optional services bag exposed to every node via `context.services`; defaults to `undefined`.

### Constructor

```ts
constructor(options?: DagonizerOptionsInterface<TServices>)
```

`options.accessor` swaps the path resolver for fan-out reads, fan-in writes, and deep-DAG state mapping. Defaults to `DottedPathAccessor`. `options.services` is the typed services bag; defaults to `undefined`.

### `DagonizerOptionsInterface`

```ts
interface DagonizerOptionsInterface<TServices = undefined> {
  readonly accessor?: StateAccessor;
  readonly services?: TServices;
}
```

---

### `registerNode(node)`

```ts
registerNode<TOutput extends string>(
  node: NodeInterface<TState, TOutput, TServices>,
): void
```

Registers a node in the dispatcher's node registry. If the node defines an optional `validate()` method, it is called immediately and throws `DAGError` if it returns `{ valid: false }`.

Nodes are stored widened to `NodeInterface<TState, string, TServices>`. Narrow `TOutput` → wide `string` is sound covariantly.

---

### `registerDAG(dag)`

```ts
registerDAG(dag: DAG): void
```

Registers a DAG after two validation passes:

1. **Schema pass** — `Validator.dag.validate(dag)` checks structure (required fields, valid `type` and `strategy` enumerations).
2. **Semantic pass** — verifies entrypoint exists, all node references are resolvable, no circular sub-DAG references, and every registered node output has a routing entry in the placement's `outputs` map.

Throws `DAGError` with a multi-line message listing all failures.

---

### `static load(json)`

```ts
static load(json: string): DAG
```

Parse a JSON string and validate against `DAGSchema`. The single permitted ingest boundary where `unknown` enters the package. Throws `ValidationError` for malformed JSON or schema-noncompliant input.

```ts
const dag = Dagonizer.load(rawJsonString);
dispatcher.registerDAG(dag);
```

---

### `static fromValue(value)`

```ts
static fromValue(value: unknown): DAG
```

Validate an already-parsed value. Same boundary semantics as `load` but skips `JSON.parse`.

---

### `static serialize(dag)`

```ts
static serialize(dag: DAG): string
```

Serialize a DAG to pretty JSON (2-space indent). Does not re-validate.

---

### `static serializeCompact(dag)`

```ts
static serializeCompact(dag: DAG): string
```

Serialize a DAG to compact JSON (no whitespace).

---

### `execute(dagName, initialState, options?)`

```ts
execute(
  dagName: string,
  initialState: TState,
  options?: { signal?: AbortSignal; deadlineMs?: number },
): Execution<TState>
```

Returns an `Execution<TState>` starting at the DAG's entrypoint. The execution is lazy — the generator does not run until the caller awaits or iterates.

```ts
// Await (one-shot)
const result = await dispatcher.execute('my-dag', state);

// Iterate (streaming per node)
for await (const node of dispatcher.execute('my-dag', state)) {
  console.log(node.nodeName, node.output);
}
```

---

### `resume(dagName, state, fromStage, options?)`

```ts
resume(
  dagName: string,
  state: TState,
  fromStage: string,
  options?: { signal?: AbortSignal; deadlineMs?: number },
): Execution<TState>
```

Identical to `execute()` but begins at `fromStage` instead of the DAG's entrypoint. The caller is responsible for rehydrating `state` (typically via `Checkpoint.restore`) before calling.

```ts
const { dagName, state, cursor } = Checkpoint.restore(raw, (snap) => MyState.restore(snap));
const result = await dispatcher.resume(dagName, state, cursor);
```

---

### `destroy()`

```ts
async destroy(): Promise<void>
```

Calls the optional `destroy()` method on every registered node, then clears all registries. Use to clean up connection pools or other resources held by nodes.

---

### Observability hooks

Five protected no-op methods. Subclass `Dagonizer` and override to attach metrics, logging, or tracing.

```ts
protected onFlowStart(dagName: string, state: TState): void
protected onFlowEnd(dagName: string, state: TState, result: ExecutionResultInterface<TState>): void
protected onNodeStart(nodeName: string, state: TState): void
protected onNodeEnd(nodeName: string, output: string | undefined, state: TState): void
protected onError(nodeName: string, error: Error, state: TState): void
```

| Hook | Fires |
|------|-------|
| `onFlowStart` | After `state.markRunning()`, before the first node |
| `onFlowEnd` | After the final node (all paths — normal, cancelled, failed) |
| `onNodeStart` | Before `node.execute()` for each node entry point |
| `onNodeEnd` | After each node resolves, before the result is yielded |
| `onError` | When the signal fires or a node throws |

See [Observability](/guide/observability) for usage examples.
## Related guides

- [DAGBuilder](../guide/builder)
- [Cancellation](../guide/cancellation)
- [Services](../guide/services)
- [State accessors](../guide/state-accessor)
- [Observability](../guide/observability)
