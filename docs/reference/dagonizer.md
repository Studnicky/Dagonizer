---
seeAlso:
  - text: 'Reference: Execution'
    link: './execution'
    description: 'what `execute` and `resume` return'
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`NodeInterface`, `ExecuteOptionsType`'
  - text: 'Reference: Core'
    link: './core'
    description: '`GatherStrategies`, `OutcomeReducers`'
  - text: 'Reference: Lifecycle'
    link: './lifecycle'
---

# Dagonizer

`@studnicky/dagonizer` root export.

## Class: `Dagonizer<TState>`

The DAG dispatcher. Holds node and DAG registries, validates configurations at registration time, and runs the node-graph iterator.

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';

class MyState extends NodeStateBase {}

// ---cut---
const dispatcher = new Dagonizer<MyState>();
```

`TState` must satisfy `NodeStateInterface`. In practice, always extend `NodeStateBase`.

### Constructor

```ts twoslash
import { Dagonizer } from '@studnicky/dagonizer';
import type { DagonizerOptionsType, NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
// constructor(options?: DagonizerOptionsType)
declare const options: DagonizerOptionsType;
const d = new Dagonizer(options);
```

`options.accessor` swaps the path resolver for scatter source reads, state-mapping input copies, and gather writes. Defaults to `DottedPathAccessor`.

### `DagonizerOptionsType`

```ts twoslash
import type {
  DagonizerOptionsType,
  NodeStateInterface,
  HandoffChannelInterface,
  DagContainerInterface,
} from '@studnicky/dagonizer';
import type { StateAccessorInterface } from '@studnicky/dagonizer/types';
// ---cut---
declare const _opts: DagonizerOptionsType;
// accessor?: StateAccessorInterface
// containers?: Readonly<Record<string, DagContainerInterface>>
// channels?: Readonly<Record<string, HandoffChannelInterface>>
// registryVersion?: string
// validateOutputs?: boolean
export {};
```

| Field | Type | Description |
|---|---|---|
| `accessor` | `StateAccessorInterface` | Path resolver for scatter source reads, gather writes, and state-mapping copies. Defaults to `DottedPathAccessor`. |
| `containers` | `Readonly<Record<string, DagContainerInterface>>` | Named container backends keyed by logical role name. On a non-empty registry, a placement that declares a role this map does not bind throws `DAGError` at `registerDAG` time. Defaults to an empty registry, where declared roles are inert and all placements run in-process. |
| `channels` | `Readonly<Record<string, HandoffChannelInterface>>` | Named egress channels keyed by terminal placement name. When a non-embedded flow reaches a named terminal, the dispatcher builds a `DAGHandoff` envelope and calls `channel.publish(handoff)`. Unbound terminals do not publish. |
| `registryVersion` | `string` | Registry version string included in every `DAGHandoff` envelope for receiver version-handshake validation. Defaults to `'0'`. |
| `validateOutputs` | `boolean` | When `true`, validates each node output against the node's declared `outputSchema` for that port after execution. On mismatch the item is re-routed to `'error'`. Default `false` — zero overhead in production. Enable in dev/test to catch contract violations early. |

---

### `registerNode(node)`

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { NodeInterface } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
declare const node: NodeInterface<MyState, string>;
const d = new Dagonizer<MyState>();
d.registerNode(node);
```

Registers a node in the dispatcher's node registry. If the node defines an optional `validate()` method, it is called immediately and throws `DAGError` if it returns `{ valid: false }`.

Nodes are stored widened to `NodeInterface<NodeStateInterface, string>`. `TState` is widened to `NodeStateInterface` so heterogeneous child-node states (whose concrete class may differ from `TState`) are stored without casts. Narrowing `TOutput` to wide `string` is sound covariantly.

---

### `registerBundle(bundle)`

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { DispatcherBundleType } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
declare const bundle: DispatcherBundleType<MyState>;
const d = new Dagonizer<MyState>();
d.registerBundle(bundle);
```

Register every node, then every DAG, in the supplied bundle. Order is fixed: nodes first so the semantic-pass DAG validator can resolve every node reference. Throws as soon as any individual registration throws (validation failure, duplicate name, etc.); registrations that ran before the failing one remain installed.

```ts twoslash
import type {
  DispatcherBundleType,
  NodeStateInterface,
  NodeInterface,
  DAGType,
} from '@studnicky/dagonizer';
// ---cut---
declare const _b: DispatcherBundleType<NodeStateInterface>;
// readonly nodes: readonly NodeInterface<TState, string>[]
// readonly dags:  readonly DAGType[]
export {};
```

Both arrays are required. Either may be empty (a node-only bundle uses `dags: []`; a DAG-only bundle uses `nodes: []`).

<<< @/../examples/the-archivist/dag.ts#dispatcher-bundle

---

### `registerDAG(dag, stateFactory?)`

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { DAGType, ChildStateFactoryType } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
declare const dag: DAGType;
declare const stateFactory: ChildStateFactoryType;
const d = new Dagonizer<MyState>();
d.registerDAG(dag);
// With an explicit child-state factory:
d.registerDAG(dag, stateFactory);
```

Registers a DAG after a semantic validation pass, followed by an optional contract check. The optional `stateFactory` argument overrides the default child-state constructor thunk for embedded-DAG and scatter executions within this DAG; when omitted, `ChildStateFactory.cloneParent` is stored.

1. **Semantic pass.** Verifies entrypoint exists, all node references are resolvable, no circular embedded-DAG references, and every registered node output has a routing entry in the placement's `outputs` map.

After the semantic pass, a data-flow check runs for each placement whose backing node declares required and produced state paths. Dangling reads (a non-entrypoint node requires a path no upstream node produces) and dead writes (a node produces a path no downstream node requires) both throw `DAGError`. This check is skipped for placements without a contract.

Schema validation is handled at the ingest boundary (`DAGDocument.load` / `DAGDocument.ofValue`); `registerDAG` does not repeat the structural pass because `DAGType` already guarantees schema conformance.

Throws `DAGError` with a multi-line message listing all failures.

---

### `getDAG(name)`

Returns `DAG | undefined`. `undefined` when the DAG has not been registered.

### `getNode(name)`

Returns `NodeInterface<NodeStateInterface, string> | undefined`. `undefined` when the node has not been registered.

### `listDAGs()`

Snapshot of every registered DAG. The returned array is a fresh shallow copy; mutating it does not affect the registry.

### `listNodes()`

Snapshot of every registered node. The returned array is a fresh shallow copy; mutating it does not affect the registry.

All four read accessors in context:

<<< @/../examples/01-linear.ts#registry-read

---

### `DAGDocument.load(json, options?)` {#static-load}

```ts twoslash
import { DAGDocument } from '@studnicky/dagonizer';
// ---cut---
// static load(json: string, options?: DAGDocumentLoadOptionsType): DAGType
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

**`options.overrides`** — a `Partial<DAGType>` merged into the decoded document before schema validation. Use this to inject runtime configuration (e.g. concurrency limits from an environment config) without mutating the source JSON.

```ts twoslash
import { DAGDocument } from '@studnicky/dagonizer';
// ---cut---
declare const rawJsonString: string;
declare const concurrency: number;
const dag = DAGDocument.load(rawJsonString, {
  overrides: {
    nodes: JSON.parse(rawJsonString).nodes.map((n: { name: string }) =>
      n.name === 'scatter' ? { ...n, concurrency } : n
    ),
  },
});
```

---

### `DAGDocument.ofValue(value, options?)` {#static-ofvalue}

```ts twoslash
import { DAGDocument } from '@studnicky/dagonizer';
// ---cut---
// static ofValue(value: unknown, options?: DAGDocumentLoadOptionsType): DAGType
declare const value: unknown;
const dag = DAGDocument.ofValue(value);
```

Validate an already-parsed value. Same boundary semantics as `load` but skips `JSON.parse`. Accepts the same `options.overrides` field.

---

### `DAGDocument.serialize(dag)` {#static-serialize}

```ts twoslash
import { DAGDocument } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';
// ---cut---
// static serialize(dag: DAGType): string
declare const dag: DAGType;
const json: string = DAGDocument.serialize(dag);
```

Serialize a DAG to pretty JSON (2-space indent). Does not re-validate.

---

### `DAGDocument.serializeCompact(dag)` {#static-serializecompact}

```ts twoslash
import { DAGDocument } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';
// ---cut---
// static serializeCompact(dag: DAGType): string
declare const dag: DAGType;
const json: string = DAGDocument.serializeCompact(dag);
```

Serialize a DAG to compact JSON (no whitespace).

---

### `execute(dagName, initialState, options?)`

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { ExecuteOptionsType, Execution } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
const dispatcher = new Dagonizer<MyState>();
declare const state: MyState;
const execution: Execution<MyState> = dispatcher.execute('my-flow', state);
```

Returns an `Execution<TState>` starting at the DAG's entrypoint. The execution is lazy: the generator does not run until the caller awaits or iterates.

<<< @/../examples/the-archivist/runArchivist.ts#linear-run

`ExecuteOptionsType` has two fields: `signal?: AbortSignal` and `deadlineMs?: number`.

---

### `resume(dagName, state, fromStage, options?)`

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { ExecuteOptionsType, Execution } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
const dispatcher = new Dagonizer<MyState>();
declare const state: MyState;
const execution: Execution<MyState> = dispatcher.resume('my-flow', state, 'node-b');
```

Identical to `execute()` but begins at `fromStage` instead of the DAG's entrypoint. The caller is responsible for rehydrating `state` (typically via `Checkpoint.load(raw).restoreState(CheckpointRestoreAdapter.wrap(fn))`) before calling.

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

Seven protected no-op methods. Subclass `Dagonizer` and override to attach metrics, logging, or tracing.

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { ExecutionResultType, NodeStateInterface } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
class ObservableDagonizer extends Dagonizer<MyState> {
  protected override onFlowStart(dagName: string, state: MyState): void {
    console.log('start', dagName);
  }
  protected override onFlowEnd(dagName: string, state: MyState, result: ExecutionResultType<MyState>): void {
    console.log('end', dagName, result.terminalOutcome);
  }
  protected override onNodeStart(nodeName: string, state: NodeStateInterface, placementPath: readonly string[]): void {}
  protected override onNodeEnd(nodeName: string, output: string | null, state: NodeStateInterface, placementPath: readonly string[]): void {}
  protected override onError(nodeName: string, error: Error, state: NodeStateInterface, placementPath: readonly string[]): void {}
  protected override onPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: NodeStateInterface, placementPath: readonly string[]): void {}
  protected override onPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: NodeStateInterface, placementPath: readonly string[]): void {}
}
```

| Hook | Fires |
|------|-------|
| `onFlowStart` | After `state.markRunning()`, before the first node |
| `onFlowEnd` | After the final node (all paths: normal, cancelled, failed) |
| `onNodeStart` | Before `node.execute()` for each node entry point |
| `onNodeEnd` | After each node resolves, before the result is yielded; `output` is `string \| null` (`null` = no route emitted) |
| `onError` | When the signal fires or a node throws |
| `onPhaseEnter` | Before a `pre` or `post` phase placement runs; signature `(dagName, phase: 'pre'\|'post', placementName, state, placementPath)` |
| `onPhaseExit` | After a `pre` or `post` phase placement completes (success or collected error); same signature as `onPhaseEnter` |

`placementPath` is the ordered array of parent embedded-DAG placement names leading to the current node. Top-level nodes receive `[]`; a node inside an `EmbeddedDAGNode` named `'search'` receives `['search']`. The full cytoscape-style node id is `[...placementPath, nodeName].join('/')`.

See [Observability](/guide/observability) for usage examples. Contract misalignment — a dangling read or a dead write — throws a `DAGError` at `registerDAG`/`build` time rather than surfacing a warning.

---

## Interface: `DispatcherBundleType`

```ts twoslash
import type {
  DispatcherBundleType,
  NodeStateInterface,
  NodeInterface,
  DAGType,
} from '@studnicky/dagonizer';
// ---cut---
declare const bundle: DispatcherBundleType<NodeStateInterface>;
const _nodes: readonly NodeInterface<NodeStateInterface, string>[] = bundle.nodes;
const _dags: readonly DAGType[] = bundle.dags;
```

A coherent unit of nodes and DAGs registered together. Plugin packages and feature modules export a `DispatcherBundleType` so consumers register the whole unit in one call.

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

## Const: `WORKSET_PROGRESS_KEY`

```ts twoslash
import { WORKSET_PROGRESS_KEY } from '@studnicky/dagonizer';
// ---cut---
// WORKSET_PROGRESS_KEY === '__dagonizer_workset_progress__'
const key = WORKSET_PROGRESS_KEY; // type: "__dagonizer_workset_progress__"
export {};
```

Reserved metadata key used by the work-set scheduler to persist the in-flight work set on interruption. Consumer nodes must not write to this key. The stored value is a `WorkSetProgress` blob serialised by `WorkSetCheckpoint.write` and read back by `WorkSetCheckpoint.read`. Absent for size-1 canonical runs where the cursor model handles state directly.

---

## Related guides

- [DAGBuilder](../guide/builder)
- [Cancellation](../guide/cancellation)
- [Services](../guide/services)
- [State accessors](../guide/state-accessor)
- [Observability](../guide/observability)
