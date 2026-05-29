---
seeAlso:
  - text: 'Reference: Execution'
    link: './execution'
    description: 'what `execute` and `resume` return'
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`NodeInterface`, `ExecuteOptionsInterface`'
  - text: 'Reference: Core'
    link: './core'
    description: '`ParallelCombiners`, `GatherStrategies`, `OutcomeReducers`'
  - text: 'Reference: Lifecycle'
    link: './lifecycle'
---

# Dagonizer

`@noocodex/dagonizer` root export.

## Class: `Dagonizer<TState, TServices>`

The DAG dispatcher. Holds node and DAG registries, validates configurations at registration time, and runs the node-graph iterator.

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

`options.accessor` swaps the path resolver for scatter source reads, projection copies, and gather writes. Defaults to `DottedPathAccessor`. `options.services` is the typed services bag; defaults to `undefined`.

### `DagonizerOptionsInterface`

```ts
interface DagonizerOptionsInterface<TServices = undefined> {
  readonly accessor?: StateAccessor;
  readonly services?: TServices;
  readonly instrumentation?: Instrumentation;
}
```

`instrumentation` is the plugin-supplied observability surface. Defaults to a `NoopInstrumentation` (every hook is a no-op when not overridden). Plugins extend `NoopInstrumentation` and pass the instance through this option. The dispatcher fires both the protected `on*` subclass hooks and the equivalent `instrumentation.*` methods at every execution boundary.

---

### `registerNode(node)`

```ts
registerNode<TOutput extends string>(
  node: NodeInterface<TState, TOutput, TServices>,
): void
```

Registers a node in the dispatcher's node registry. If the node defines an optional `validate()` method, it is called immediately and throws `DAGError` if it returns `{ valid: false }`.

Nodes are stored widened to `NodeInterface<TState, string, TServices>`. Narrow `TOutput` to wide `string` is sound covariantly.

---

### `registerBundle(bundle)`

```ts
registerBundle(bundle: DispatcherBundle<TState, TServices>): void
```

Register every node, then every DAG, in the supplied bundle. Order is fixed: nodes first so the semantic-pass DAG validator can resolve every node reference. Throws as soon as any individual registration throws (validation failure, duplicate name, etc.); registrations that ran before the failing one remain installed.

```ts
interface DispatcherBundle<TState extends NodeStateInterface, TServices = undefined> {
  readonly nodes: readonly NodeInterface<TState, string, TServices>[];
  readonly dags:  readonly DAG[];
}
```

Both arrays are required. Either may be empty (a node-only bundle uses `dags: []`; a DAG-only bundle uses `nodes: []`).

```ts
import type { DispatcherBundle } from '@noocodex/dagonizer';

const bundle: DispatcherBundle<MyState> = {
  nodes: [fetchNode, parseNode, persistNode],
  dags:  [pipelineDag],
};
dispatcher.registerBundle(bundle);
```

---

### `registerDAG(dag)`

```ts
registerDAG(dag: DAG): void
```

Registers a DAG after three validation passes:

1. **Schema pass.** `Validator.dag.validate(dag)` checks structure (required fields, valid `type` and `strategy` enumerations).
2. **Semantic pass.** Verifies entrypoint exists, all node references are resolvable, no circular scatter body references, and every registered node output has a routing entry in the placement's `outputs` map.
3. **Contract pass.** For DAGs derived from a `nodes` registry, `ContractRegistryValidator` checks every non-entrypoint node's `hardRequired` paths against upstream producers. Dangling reads throw `DAGError`; dead writes call `onContractWarning`.

Throws `DAGError` with a multi-line message listing all failures.

See [catching contract drift](../guide/derive.md#catching-contract-drift) for the full validation semantics.

---

### `getDAG(name)`

```ts
getDAG(name: string): DAG | undefined
```

Look up a registered DAG by name. Returns `undefined` when the DAG has not been registered.

### `getNode(name)`

```ts
getNode(name: string): NodeInterface<TState, string, TServices> | undefined
```

Look up a registered node by name. Returns `undefined` when the node has not been registered.

### `listDAGs()`

```ts
listDAGs(): readonly DAG[]
```

Snapshot of every registered DAG. The returned array is a fresh shallow copy; mutating it does not affect the registry.

### `listNodes()`

```ts
listNodes(): readonly NodeInterface<TState, string, TServices>[]
```

Snapshot of every registered node. The returned array is a fresh shallow copy; mutating it does not affect the registry.

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
  options?: ExecuteOptionsInterface,
): Execution<TState>
```

Returns an `Execution<TState>` starting at the DAG's entrypoint. The execution is lazy: the generator does not run until the caller awaits or iterates.

```ts
// Await (one-shot)
const result = await dispatcher.execute('my-dag', state);

// Iterate (streaming per node)
for await (const node of dispatcher.execute('my-dag', state)) {
  console.log(node.nodeName, node.output);
}
```

`ExecuteOptionsInterface` has two fields: `signal?: AbortSignal` and `deadlineMs?: number`.

---

### `resume(dagName, state, fromStage, options?)`

```ts
resume(
  dagName: string,
  state: TState,
  fromStage: string,
  options?: ExecuteOptionsInterface,
): Execution<TState>
```

Identical to `execute()` but begins at `fromStage` instead of the DAG's entrypoint. The caller is responsible for rehydrating `state` (typically via `Checkpoint.load(raw).restoreState(fn)`) before calling.

```ts
const ckpt = Checkpoint.load(raw);
const { dagName, state, cursor } = ckpt.restoreState((snap) => MyState.restore(snap));
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

Six protected no-op methods. Subclass `Dagonizer` and override to attach metrics, logging, or tracing.

```ts
protected onFlowStart(dagName: string, state: TState): void
protected onFlowEnd(dagName: string, state: TState, result: ExecutionResultInterface<TState>): void
protected onNodeStart(nodeName: string, state: TState): void
protected onNodeEnd(nodeName: string, output: string | undefined, state: TState): void
protected onError(nodeName: string, error: Error, state: TState): void
protected onContractWarning(message: string): void
```

| Hook | Fires |
|------|-------|
| `onFlowStart` | After `state.markRunning()`, before the first node |
| `onFlowEnd` | After the final node (all paths: normal, cancelled, failed) |
| `onNodeStart` | Before `node.execute()` for each node entry point |
| `onNodeEnd` | After each node resolves, before the result is yielded |
| `onError` | When the signal fires or a node throws |
| `onContractWarning` | When `ContractRegistryValidator` detects a dead-write during `registerDAG` |

See [Observability](/guide/observability) for usage examples. See [catching contract drift](../guide/derive.md#catching-contract-drift) for `onContractWarning` usage.

---

## Interface: `DispatcherBundle`

```ts
interface DispatcherBundle<TState extends NodeStateInterface, TServices = undefined> {
  readonly nodes: readonly NodeInterface<TState, string, TServices>[];
  readonly dags:  readonly DAG[];
}
```

A coherent unit of nodes and DAGs registered together. Plugin packages and feature modules export a `DispatcherBundle` so consumers register the whole unit in one call.

---

## Const: `SCATTER_PROGRESS_KEY`

```ts
const SCATTER_PROGRESS_KEY: '__dagonizer_scatter_progress__'
```

Reserved metadata key used by the scatter executor to persist per-item resume bookkeeping. Consumer nodes must not write to this key. The stored value is a `StoredScatterProgress` map keyed by the scatter placement's `name`.

```ts
interface ScatterProgress {
  readonly placementName:    string;
  readonly completedIndices: readonly number[];
  readonly itemResults:      readonly { readonly index: number; readonly output: string }[];
}
type StoredScatterProgress = Readonly<Record<string, ScatterProgress>>;
```

---

## Related guides

- [DAGBuilder](../guide/builder)
- [Cancellation](../guide/cancellation)
- [Services](../guide/services)
- [State accessors](../guide/state-accessor)
- [Observability](../guide/observability)
