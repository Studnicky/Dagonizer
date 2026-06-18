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

`@studnicky/dagonizer` root export.

## Class: `Dagonizer<TState, TServices>`

The DAG dispatcher. Holds node and DAG registries, validates configurations at registration time, and runs the node-graph iterator.

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';

interface MyServices { logger: Console }
class MyState extends NodeStateBase {}

// ---cut---
const dispatcher = new Dagonizer<MyState>();
// With services:
const dispatcher2 = new Dagonizer<MyState, MyServices>({ services: { logger: console } });
```

`TState` must satisfy `NodeStateInterface`. In practice, always extend `NodeStateBase`. `TServices` is the optional services bag exposed to every node via `context.services`; defaults to `undefined`.

### Constructor

```ts twoslash
import { Dagonizer } from '@studnicky/dagonizer';
import type { DagonizerOptionsInterface, NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
// constructor(options?: DagonizerOptionsInterface<TState, TServices>)
declare const options: DagonizerOptionsInterface;
const d = new Dagonizer(options);
```

`options.accessor` swaps the path resolver for scatter source reads, state-mapping input copies, and gather writes. Defaults to `DottedPathAccessor`. `options.services` is the typed services bag; defaults to `undefined`.

### `DagonizerOptionsInterface`

```ts twoslash
import type {
  DagonizerOptionsInterface,
  NodeStateInterface,
  HandoffChannelInterface,
  DagContainerInterface,
} from '@studnicky/dagonizer';
import type { StateAccessor } from '@studnicky/dagonizer/types';
// ---cut---
declare const _opts: DagonizerOptionsInterface;
// accessor?: StateAccessor
// services?: TServices
// containers?: Readonly<Record<string, DagContainerInterface<TState>>>
// channels?: Readonly<Record<string, HandoffChannelInterface>>
// registryVersion?: string
export {};
```

| Field | Type | Description |
|---|---|---|
| `accessor` | `StateAccessor` | Path resolver for scatter source reads, gather writes, and state-mapping copies. Defaults to `DottedPathAccessor`. |
| `services` | `TServices` | Typed services bag exposed to every node via `context.services`. Defaults to `undefined`. |
| `containers` | `Readonly<Record<string, DagContainerInterface<TState>>>` | Named container backends keyed by logical role name. On a non-empty registry, a placement that declares a role this map does not bind throws `DAGError` at `registerDAG` time. Defaults to an empty registry, where declared roles are inert and all placements run in-process. |
| `channels` | `Readonly<Record<string, HandoffChannelInterface>>` | Named egress channels keyed by terminal placement name. When a non-embedded flow reaches a named terminal, the dispatcher builds a `DAGHandoff` envelope and calls `channel.publish(handoff)`. Unbound terminals do not publish. |
| `registryVersion` | `string` | Registry version string included in every `DAGHandoff` envelope for receiver version-handshake validation. Defaults to `'0'`. |

---

### `registerNode(node)`

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { NodeInterface, OperationContractFragment } from '@studnicky/dagonizer';
import { Timeout } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
declare const node: NodeInterface<MyState, string, undefined>;
const d = new Dagonizer<MyState>();
d.registerNode(node);
```

Registers a node in the dispatcher's node registry. If the node defines an optional `validate()` method, it is called immediately and throws `DAGError` if it returns `{ valid: false }`.

Nodes are stored widened to `NodeInterface<TState, string, TServices>`. Narrow `TOutput` to wide `string` is sound covariantly.

---

### `registerBundle(bundle)`

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { DispatcherBundle } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
declare const bundle: DispatcherBundle<MyState>;
const d = new Dagonizer<MyState>();
d.registerBundle(bundle);
```

Register every node, then every DAG, in the supplied bundle. Order is fixed: nodes first so the semantic-pass DAG validator can resolve every node reference. Throws as soon as any individual registration throws (validation failure, duplicate name, etc.); registrations that ran before the failing one remain installed.

```ts twoslash
import type {
  DispatcherBundle,
  NodeStateInterface,
  NodeInterface,
  DAG,
} from '@studnicky/dagonizer';
// ---cut---
declare const _b: DispatcherBundle<NodeStateInterface>;
// readonly nodes: readonly NodeInterface<TState, string, TServices>[]
// readonly dags:  readonly DAG[]
export {};
```

Both arrays are required. Either may be empty (a node-only bundle uses `dags: []`; a DAG-only bundle uses `nodes: []`).

<<< @/../examples/the-archivist/dag.ts#dispatcher-bundle

---

### `registerDAG(dag)`

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { DAG } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
declare const dag: DAG;
const d = new Dagonizer<MyState>();
d.registerDAG(dag);
```

Registers a DAG after two validation passes, followed by an optional contract check:

1. **Schema pass.** `Validator.dag.validate(dag)` checks structure (required fields, valid `type` and `strategy` enumerations).
2. **Semantic pass.** Verifies entrypoint exists, all node references are resolvable, no circular embedded-DAG references, and every registered node output has a routing entry in the placement's `outputs` map.

After both passes, `ContractRegistryValidator` runs a data-flow check for each placement whose backing node carries a co-located contract. Dangling reads (a non-entrypoint node requires a path no upstream node produces) and dead writes (a node produces a path no downstream node requires) both throw `DAGError`. This check is skipped for placements without a contract.

Throws `DAGError` with a multi-line message listing all failures.

See [catching contract drift](../guide/derive.md#catching-contract-drift) for the full validation semantics.

---

### `getDAG(name)`

Returns `DAG | undefined`. `undefined` when the DAG has not been registered.

### `getNode(name)`

Returns `NodeInterface<TState, string, TServices> | undefined`. `undefined` when the node has not been registered.

### `listDAGs()`

Snapshot of every registered DAG. The returned array is a fresh shallow copy; mutating it does not affect the registry.

### `listNodes()`

Snapshot of every registered node. The returned array is a fresh shallow copy; mutating it does not affect the registry.

All four read accessors in context:

<<< @/../examples/01-linear.ts#registry-read

---

### `DAGDocument.load(json)` {#static-load}

```ts twoslash
import { DAGDocument } from '@studnicky/dagonizer';
// ---cut---
// static load(json: string): DAG
declare const rawJsonString: string;
const dag = DAGDocument.load(rawJsonString);
```

Parse a JSON string and validate against `DAGSchema`. The single permitted ingest boundary where `unknown` enters the package. Throws `ValidationError` for malformed JSON or schema-noncompliant input.

```ts twoslash
import { DAGDocument, Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
declare const rawJsonString: string;
const dag = DAGDocument.load(rawJsonString);
const dispatcher = new Dagonizer<MyState>();
dispatcher.registerDAG(dag);
```

---

### `DAGDocument.ofValue(value)` {#static-ofvalue}

```ts twoslash
import { DAGDocument } from '@studnicky/dagonizer';
// ---cut---
// static ofValue(value: unknown): DAG
declare const value: unknown;
const dag = DAGDocument.ofValue(value);
```

Validate an already-parsed value. Same boundary semantics as `load` but skips `JSON.parse`.

---

### `DAGDocument.serialize(dag)` {#static-serialize}

```ts twoslash
import { DAGDocument } from '@studnicky/dagonizer';
import type { DAG } from '@studnicky/dagonizer';
// ---cut---
// static serialize(dag: DAG): string
declare const dag: DAG;
const json: string = DAGDocument.serialize(dag);
```

Serialize a DAG to pretty JSON (2-space indent). Does not re-validate.

---

### `DAGDocument.serializeCompact(dag)` {#static-serializecompact}

```ts twoslash
import { DAGDocument } from '@studnicky/dagonizer';
import type { DAG } from '@studnicky/dagonizer';
// ---cut---
// static serializeCompact(dag: DAG): string
declare const dag: DAG;
const json: string = DAGDocument.serializeCompact(dag);
```

Serialize a DAG to compact JSON (no whitespace).

---

### `execute(dagName, initialState, options?)`

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { ExecuteOptionsInterface, Execution } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
const dispatcher = new Dagonizer<MyState>();
declare const state: MyState;
const execution: Execution<MyState> = dispatcher.execute('my-flow', state);
```

Returns an `Execution<TState>` starting at the DAG's entrypoint. The execution is lazy: the generator does not run until the caller awaits or iterates.

<<< @/../examples/the-archivist/runArchivist.ts#linear-run

`ExecuteOptionsInterface` has two fields: `signal?: AbortSignal` and `deadlineMs?: number`.

---

### `resume(dagName, state, fromStage, options?)`

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { ExecuteOptionsInterface, Execution } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
const dispatcher = new Dagonizer<MyState>();
declare const state: MyState;
const execution: Execution<MyState> = dispatcher.resume('my-flow', state, 'node-b');
```

Identical to `execute()` but begins at `fromStage` instead of the DAG's entrypoint. The caller is responsible for rehydrating `state` (typically via `Checkpoint.load(raw).restoreState(CheckpointRestoreAdapterFn.wrap(fn))`) before calling.

<<< @/../examples/the-archivist/runArchivist.ts#resume-run

---

### `destroy()`

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
const dispatcher = new Dagonizer<MyState>();
await dispatcher.destroy();
```

Calls the optional `destroy()` method on every registered node, then clears all registries. Use to clean up connection pools or other resources held by nodes.

---

### Observability hooks

Five protected no-op methods. Subclass `Dagonizer` and override to attach metrics, logging, or tracing.

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { ExecutionResultInterface } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
class ObservableDagonizer extends Dagonizer<MyState> {
  protected override onFlowStart(dagName: string, state: MyState): void {
    console.log('start', dagName);
  }
  protected override onFlowEnd(dagName: string, state: MyState, result: ExecutionResultInterface<MyState>): void {
    console.log('end', dagName, result.terminalOutcome);
  }
  protected override onNodeStart(nodeName: string, state: MyState, placementPath: readonly string[]): void {}
  protected override onNodeEnd(nodeName: string, output: string | null, state: MyState, placementPath: readonly string[]): void {}
  protected override onError(nodeName: string, error: Error, state: MyState, placementPath: readonly string[]): void {}
}
```

| Hook | Fires |
|------|-------|
| `onFlowStart` | After `state.markRunning()`, before the first node |
| `onFlowEnd` | After the final node (all paths: normal, cancelled, failed) |
| `onNodeStart` | Before `node.execute()` for each node entry point |
| `onNodeEnd` | After each node resolves, before the result is yielded; `output` is `string \| null` (`null` = no route emitted) |
| `onError` | When the signal fires or a node throws |

`placementPath` is the ordered array of parent embedded-DAG placement names leading to the current node. Top-level nodes receive `[]`; a node inside an `EmbeddedDAGNode` named `'search'` receives `['search']`. The full cytoscape-style node id is `[...placementPath, nodeName].join('/')`.

See [Observability](/guide/observability) for usage examples. Contract misalignment — a dangling read or a dead write — throws a `DAGError` at `registerDAG`/`build` time rather than surfacing a warning; see [catching contract drift](../guide/derive.md#catching-contract-drift).

---

## Interface: `DispatcherBundle`

```ts twoslash
import type {
  DispatcherBundle,
  NodeStateInterface,
  NodeInterface,
  DAG,
} from '@studnicky/dagonizer';
// ---cut---
declare const bundle: DispatcherBundle<NodeStateInterface>;
const _nodes: readonly NodeInterface<NodeStateInterface, string, undefined>[] = bundle.nodes;
const _dags: readonly DAG[] = bundle.dags;
```

A coherent unit of nodes and DAGs registered together. Plugin packages and feature modules export a `DispatcherBundle` so consumers register the whole unit in one call.

---

## Const: `SCATTER_PROGRESS_KEY`

```ts twoslash
import { SCATTER_PROGRESS_KEY } from '@studnicky/dagonizer';
// ---cut---
// SCATTER_PROGRESS_KEY === '__dagonizer_scatter_progress__'
const key = SCATTER_PROGRESS_KEY; // type: "__dagonizer_scatter_progress__"
export {};
```

Reserved metadata key used by the scatter executor to persist per-item resume bookkeeping. Consumer nodes must not write to this key. The stored value is a `StoredScatterProgress` map keyed by the scatter placement's `name`.

```ts twoslash
// Illustrative local shapes (the actual StoredScatterProgress is a discriminated union):
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

export {};
```

---

## Related guides

- [DAGBuilder](../guide/builder)
- [Cancellation](../guide/cancellation)
- [Services](../guide/services)
- [State accessors](../guide/state-accessor)
- [Observability](../guide/observability)
