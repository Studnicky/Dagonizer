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
    description: '`GatherStrategies`, `OutcomeReducers`'
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
constructor(options?: DagonizerOptionsInterface<TState, TServices>)
```

`options.accessor` swaps the path resolver for scatter source reads, state-mapping input copies, and gather writes. Defaults to `DottedPathAccessor`. `options.services` is the typed services bag; defaults to `undefined`.

### `DagonizerOptionsInterface`

```ts
interface DagonizerOptionsInterface<TState extends NodeStateInterface = NodeStateInterface, TServices = undefined> {
  readonly accessor?:         StateAccessor;
  readonly services?:         TServices;
  readonly containers?:       Readonly<Record<string, DagContainerInterface<TState>>>;
  readonly channels?:         Readonly<Record<string, HandoffChannelInterface>>;
  readonly registryVersion?:  string;
}
```

| Field | Type | Description |
|---|---|---|
| `accessor` | `StateAccessor` | Path resolver for scatter source reads, gather writes, and state-mapping copies. Defaults to `DottedPathAccessor`. |
| `services` | `TServices` | Typed services bag exposed to every node via `context.services`. Defaults to `undefined`. |
| `containers` | `Readonly<Record<string, DagContainerInterface<TState>>>` | Named container backends keyed by logical role name. An unbound role falls back to in-process and fires `onContractWarning`. Defaults to an empty registry (all placements run in-process). |
| `channels` | `Readonly<Record<string, HandoffChannelInterface>>` | Named egress channels keyed by terminal placement name. When a non-embedded flow reaches a named terminal, the dispatcher builds a `DAGHandoff` envelope and calls `channel.publish(handoff)`. Unbound terminals do not publish. |
| `registryVersion` | `string` | Registry version string included in every `DAGHandoff` envelope for receiver version-handshake validation. Defaults to `'0'`. |

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

<<< @/../examples/the-archivist/dag.ts#dispatcher-bundle

---

### `registerDAG(dag)`

```ts
registerDAG(dag: DAG): void
```

Registers a DAG after two validation passes, followed by an optional contract check:

1. **Schema pass.** `Validator.dag.validate(dag)` checks structure (required fields, valid `type` and `strategy` enumerations).
2. **Semantic pass.** Verifies entrypoint exists, all node references are resolvable, no circular embedded-DAG references, and every registered node output has a routing entry in the placement's `outputs` map.

After both passes, `ContractRegistryValidator` runs a data-flow check for each placement whose backing node carries a co-located contract. Dangling reads (a non-entrypoint node requires a path no upstream node produces) throw `DAGError`; dead writes call `onContractWarning`. This check is skipped for placements without a contract.

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

<<< @/../examples/the-archivist/runArchivist.ts#linear-run

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

Identical to `execute()` but begins at `fromStage` instead of the DAG's entrypoint. The caller is responsible for rehydrating `state` (typically via `Checkpoint.load(raw).restoreState(CheckpointRestoreAdapterFn.fromFn(fn))`) before calling.

<<< @/../examples/the-archivist/runArchivist.ts#resume-run

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
protected onNodeStart(nodeName: string, state: TState, placementPath: readonly string[]): void
protected onNodeEnd(nodeName: string, output: string | null, state: TState, placementPath: readonly string[]): void
protected onError(nodeName: string, error: Error, state: TState, placementPath: readonly string[]): void
protected onContractWarning(message: string): void
```

| Hook | Fires |
|------|-------|
| `onFlowStart` | After `state.markRunning()`, before the first node |
| `onFlowEnd` | After the final node (all paths: normal, cancelled, failed) |
| `onNodeStart` | Before `node.execute()` for each node entry point |
| `onNodeEnd` | After each node resolves, before the result is yielded; `output` is `string \| null` (`null` = no route emitted) |
| `onError` | When the signal fires or a node throws |
| `onContractWarning` | When `ContractRegistryValidator` detects a dead-write during `registerDAG` |

`placementPath` is the ordered array of parent embedded-DAG placement names leading to the current node. Top-level nodes receive `[]`; a node inside an `EmbeddedDAGNode` named `'search'` receives `['search']`. The full cytoscape-style node id is `[...placementPath, nodeName].join('/')`.

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
interface ScatterItemResult {
  readonly index:          number;
  readonly output:         string;
  readonly mappingValues?: Readonly<Record<string, unknown>>;
  readonly fieldValue?:    unknown;
}
interface ScatterProgress {
  readonly placementName:    string;
  readonly completedIndices: readonly number[];
  readonly itemResults:      readonly ScatterItemResult[];
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
