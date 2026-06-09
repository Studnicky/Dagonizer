---
title: 'DAGBuilder'
description: 'DAGBuilder is the chainable authoring API for deterministic workflows. TypeScript narrows the route map at each .node() call from the node TOutput union, so misspelled routes are compile errors before the DAG runs. Output is the same canonical JSON-LD DAG that Dagonizer.load produces and the dispatcher consumes.'
seeAlso:
  - text: 'Authoring DAGs'
    link: './authoring'
    description: 'when to choose DAGBuilder, DAGDeriver, or raw DAG literals'
  - text: 'Subclassing state'
    link: './subclassing'
    description: 'define the state class your nodes mutate'
  - text: 'Shared state'
    link: './shared-state'
    description: 'decision matrix for inputs/gather versus stores; checkpoint integration'
  - text: 'Schema and JSON loading'
    link: './schema'
    description: 'load DAGs from JSON instead of building them in code'
  - text: 'Contract-derived flows'
    link: './derive'
    description: 'generate the same DAG shape from OperationContracts'
  - text: 'Visualization'
    link: './visualization'
    description: 'render the built DAG as Mermaid or Cytoscape'
nextSteps:
  - text: 'Phase 02, DAGBuilder demo'
    link: '../examples/02-builder'
    description: 'runnable end-to-end example'
---

<script setup lang="ts">
import { dag as builderDag } from '../../examples/dags/02-builder.topology.ts';
</script>

# DAGBuilder

`DAGBuilder` is a chainable authoring API for deterministic workflows: ETL pipelines, transformation chains, fixed sequences where the order IS the spec. Each `.node()` call narrows the `routes` map from the node `TOutput` union, so misspelled or missing routes are compile errors before the DAG runs.

If the flow is agent-shaped (operations declare data dependencies, topology falls out automatically), use [DAGDeriver](./derive) instead. See [Authoring DAGs](./authoring) for the decision matrix. Both surfaces produce the same canonical `DAG` JSON-LD object.

## Basic usage

The Phase 02 demo registers two nodes and builds a two-step chat flow:

<<< @/../examples/dags/02-builder.topology.ts#imports

<<< @/../examples/dags/02-builder.topology.ts#nodes

<<< @/../examples/dags/02-builder.topology.ts#builder

<<< @/../examples/02-builder.ts#run

The first `.node()` call sets the entrypoint automatically. Call `.entrypoint('name')` to override.

The built DAG visualised:

<DagGraph :dag="builderDag" aria-label="A two-node DAGBuilder example: classify routes to respond on either topic; respond terminates." />

## Type-safe output routing

When the node declares a narrow `TOutput` union, `.node()` enforces exhaustive routing at compile time:

```ts
// NodeInterface<S, 'ok' | 'warn' | 'error'>
.node('check', checkNode, {
  ok:    'save',
  warn:  'log',
  // error: ???   ← TypeScript error: property 'error' is missing
})
```

## Contract-aware authoring

When the underlying `NodeInterface` carries a `contract` field (`hardRequired` plus `produces`), `build()` runs the same dangling-read and dead-write validation that `DAGDeriver` runs at derive time. Drift fails at build time, not run time.

- **Dangling read**. A non-entrypoint node declares `hardRequired: ['foo']` but no upstream node produces `'foo'`. Throws `DAGError`.
- **Dead write**. A node declares `produces: ['bar']` but no downstream node `hardRequires` `'bar'`. Fires the `onContractWarning` callback (non-fatal).

```ts
import { DAGBuilder, DAGError } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer';
import type { NodeStateBase } from '@noocodex/dagonizer';

const fetchNode: NodeInterface<NodeStateBase, 'success'> = {
  name: 'fetch',
  outputs: ['success'],
  contract: { hardRequired: ['url'], produces: ['raw'] },
  async execute(state) { return { output: 'success' }; },
};

const parseNode: NodeInterface<NodeStateBase, 'success'> = {
  name: 'parse',
  outputs: ['success'],
  // Deliberate mismatch: hardRequires 'data' but upstream only produces 'raw'
  contract: { hardRequired: ['data'], produces: ['record'] },
  async execute(state) { return { output: 'success' }; },
};

// Throws DAGError: node 'parse' hardRequires 'data' but no upstream node produces it.
new DAGBuilder('pipeline', '1.0')
  .node('fetch', fetchNode, { success: 'parse' })
  .node('parse', parseNode, { success: null })
  .build();
```

Pass an `onContractWarning` callback to capture dead writes:

```ts
const dag = new DAGBuilder('pipeline', '1.0')
  .node('fetch', fetchNode, { success: 'parse' })
  .node('parse', parseNode, { success: null })
  .build((message) => {
    console.warn('[contract]', message);
  });
```

Placements added via `.scatter()` with a `{ dag }` body do not receive a `NodeInterface` and are not tracked in the impl registry; they are silently skipped during contract validation, preventing false-positive dangling-read errors for node names declared elsewhere.

The `onContractWarning` hook on `build()` fires at construction time and is local to the builder call. When the resulting DAG is registered with a `Dagonizer` subclass, the dispatcher's `onContractWarning` hook fires again at `registerDAG` time if the nodes carry co-located contracts. See [Contract-derived flows](./derive) and [Reference, contracts](../reference/contracts).

## `DAGBuilder.fromNodes()`, the linear shortcut

For the common case where the flow is linear and every node carries a contract, skip the fluent chain:

```ts
import { DAGBuilder } from '@noocodex/dagonizer';

const dag = DAGBuilder.fromNodes({
  name: 'pipeline',
  version: '1.0',
  entrypoint: 'fetch',
  nodes: [fetchNode, parseNode, saveNode],
});
```

Equivalent fluent form:

```ts
const dag = new DAGBuilder('pipeline', '1.0')
  .node('fetch', fetchNode, { success: 'parse' })
  .node('parse', parseNode, { success: 'save'  })
  .node('save',  saveNode,  { success: null     })
  .build();
```

`DAGBuilder.fromNodes()` delegates to `DAGDeriver.derive({ nodes })`, the same deriver that powers contract-first topology. Use it when the shape is linear and all nodes carry contracts. Drop into the fluent `.node()` API when you need:

- Scatter placements (node body or sub-DAG body)
- Terminal routes to `null` mid-flow
- Explicit entrypoint overrides
- Non-contract nodes that still appear in the placement list

## Scatter

`.scatter()` places a `ScatterNode` in the parent flow. A scatter isolates a state clone per source item, runs a body (a registered node or a sub-DAG) in the clone, folds clone state back through a required `gather`, and routes on the aggregate outcome via an outcome `reducer`. `source` is a required positional argument.

`gather` is required on every scatter. Use `{ strategy: 'discard' }` to express a side-effect-only fan-out where no clone state flows back to the parent:

```ts
const dag = new DAGBuilder('notify', '1')
  .scatter('fan-out', 'targets', notifyNode,
    { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
    {
      gather:      { strategy: 'discard' },
      concurrency: 10,
    },
  )
  .build();
```

Heterogeneous fan-out — running different logic per item — is expressed by authoring the `source` as a descriptor array and writing a body node that dispatches on `state.metadata.currentItem`:

```ts
// state.scoutProviders = ['openlibrary', 'googlebooks', 'wikipedia']
const dag = new DAGBuilder('search', '1')
  .scatter('scout', 'scoutProviders', scoutDispatchNode,
    { 'any-success': 'merge', 'all-error': null, 'empty': null },
    {
      gather:      { strategy: 'collect', target: 'scoutResults' },
      reducer:     'any-success',
      concurrency: 3,
    },
  )
  .node('merge', mergeNode, { success: null })
  .build();
```

`scoutDispatchNode` reads `state.metadata.currentItem` and routes to the matching scout logic. Whether bodies are identical or all different is the implementer's choice; the engine is indifferent.

### Generate-collect pattern

Each source item gets one clone. After all clones finish, the `gather.mapping` writes produced artifacts back in source-index order:

```ts
const dag = new DAGBuilder('batch', '1')
  .scatter('generate', 'providers', generateNode,
    { 'all-success': 'select', 'partial': 'select', 'all-error': null, 'empty': null },
    {
      gather:      { strategy: 'map', mapping: { 'candidate': 'candidates' } },
      concurrency: 4,
    },
  )
  .node('select', selectNode, { success: null })
  .build();
```

`gather.strategy: 'partition'` groups clones by their output token:

```ts
scatter('process-items', 'items', processNode,
  { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
  {
    gather: { strategy: 'partition', partitions: { success: 'processed', error: 'failed' } },
    concurrency: 4,
  },
)
```

The full signature:

```ts
scatter<TState extends NodeStateInterface, TOutput extends string, TServices = undefined>(
  name:    string,
  source:  string,
  body:    NodeInterface<TState, TOutput, TServices> | { readonly dag: string },
  outputs: Record<string, null | string>,
  options: ScatterOptionsInterface<TState> = {},
): this
```

`ScatterOptionsInterface<TState>`:

| Field | Type | Description |
|---|---|---|
| `itemKey?` | `string` | Metadata key the clone reads for the current item. Default `'currentItem'`. |
| `concurrency?` | `number` | Max clones running concurrently. Default: source length. |
| `inputs?` | `Partial<Record<string, Path<TState>>>` | Parent → clone field copy before the body runs. Becomes `stateMapping.input` on the entity. Keys are child-state keys; values are parent-state dotted paths. |
| `gather` | `GatherConfig` | **Required.** How produced clone state merges back into the parent. Use `{ strategy: 'discard' }` for side-effect-only fan-outs. |
| `reducer?` | `string` | Outcome reducer name. Defaults to `'aggregate'`. Built-in reducers: `'aggregate'`, `'terminal'`, `'all-success'`, `'any-success'`. Custom reducers registered via `OutcomeReducers.register` are referenceable by name. |

`Path<T>` enumerates valid dotted-path strings over a state shape recursively:

```ts
// Path<{ user: { name: string; age: number } }>
//   = 'user' | 'user.name' | 'user.age'
```

Arrays contribute `${number}` and `${number}.${ElementPath}` paths. The depth cap is 8 levels; deeper nesting falls back to `string`. The type is exported from the `@noocodex/dagonizer/builder` subpath.

When `body` is a `NodeInterface`, the impl is registered automatically and the placement emits `body: { node: body.name }`.

For patterns where nodes across multiple scatter placements accumulate to shared mutable state (agent memory, audit log), see [Shared state](./shared-state).

## Embedded DAG

`.embeddedDAG()` places an `EmbeddedDAGNode` in the parent flow. It invokes a registered sub-DAG exactly once (cardinality 1) and routes the parent on the child's terminal outcome (`success` | `error`). `options.inputs` seeds the child from the parent before it runs; `options.outputs` copies child fields back into the parent after the child completes.

```ts
const dag = new DAGBuilder('parent', '1')
  .embeddedDAG('run-child', 'child-dag',
    { success: 'finalize', error: 'finalize' },
    {
      inputs:  { payload: 'user.name' },   // child key ← parent path
      outputs: { 'user.age': 'result' },   // parent path ← child key
    },
  )
  .node('finalize', finalizeNode, { success: null })
  .build();
```

The full signature:

```ts
embeddedDAG<TChildState extends NodeStateInterface = NodeStateInterface,
            TParentState extends NodeStateInterface = NodeStateInterface>(
  name:    string,
  dagName: string,
  outputs: Record<'success' | 'error', null | string>,
  options?: TypedEmbeddedDAGOptionsInterface<TChildState, TParentState>,
): this
```

`TypedEmbeddedDAGOptionsInterface<TChildState, TParentState>`:

| Field | Type | Description |
|---|---|---|
| `inputs?` | `Partial<Record<keyof TChildState, ParentPath<TParentState>>>` | Child-state key → parent dotted path. Copied into the child before it runs. |
| `outputs?` | `Partial<Record<ParentPath<TParentState>, keyof TChildState>>` | Parent dotted path → child-state key. Copied back into the parent after the child completes. |

Supply `TChildState` and `TParentState` to narrow path strings at compile time; both default to `NodeStateInterface`, which accepts any string.

## `.terminal(name, outcome?)`

```ts
.terminal(name: string, outcome: 'completed' | 'failed' = 'completed'): this
```

Appends a `TerminalNode` placement. When the engine reaches it, the flow ends with the declared `outcome`. The default is `'completed'`. Passing `'failed'` marks the state as failed before resolving.

TerminalNodes carry no `outputs` map. They are placement-only constructs with no backing `NodeInterface`.

### When to use an explicit terminal versus a null route

A null route (`{ ok: null }`) is the shortest form and is sufficient when the endpoint has no semantic meaning beyond "done." It is sugar for an implicit `completed` terminal.

Use `.terminal(name)` when:

- The endpoint name carries meaning (`end-ok`, `response-sent`) and you want it visible in the visualisation.
- The outcome is `'failed'`. Null routes always mean `completed`; there is no null-route shorthand for a failed outcome.
- Multiple branches converge at named endpoints and legibility matters.

### Routing embedded-DAG outputs to a terminal placement

An `EmbeddedDAGNode` placement may target a named terminal directly:

```ts
const dag = new DAGBuilder('parent', '1')
  .embeddedDAG('run-child', 'child-dag', {
    success: 'end-ok',
    error:   'end-fail',
  })
  .terminal('end-ok')
  .terminal('end-fail', 'failed')
  .build();
```

When the child DAG exits with a failed terminal, the `error` output arrives at `end-fail`, which marks the parent flow `failed`. Without a named terminal, the author would need a dedicated SingleNode to call `state.markFailed()`. The terminal collapses that to one `.terminal(name, 'failed')` call.

### Example, two explicit terminals

```ts
import { DAGBuilder } from '@noocodex/dagonizer/builder';

class S extends NodeStateBase { shouldPass = true; }

const dag = new DAGBuilder('demo', '1')
  .node('check', checkNode, { pass: 'end-ok', fail: 'end-fail' })
  .terminal('end-ok')
  .terminal('end-fail', 'failed')
  .build();
```

Running with `state.shouldPass = true` produces `lifecycle.kind = 'completed'`; running with `false` produces `'failed'`.

## `.phase(name, phase, node)`

```ts
.phase<TState, TOutput, TServices>(
  name: string,
  phase: 'pre' | 'post',
  dagNode: NodeInterface<TState, TOutput, TServices>,
): this
```

Appends a `PhaseNode` placement: a lifecycle-attached task that runs around the main DAG loop rather than inside it. `phase: 'pre'` placements run before the entrypoint in DAG declaration order. `phase: 'post'` placements run after the main loop drains, in DAG declaration order, on every exit path (completion, abort, timeout, terminal-failed, node throw).

PhaseNodes carry no `outputs`. They never route to other placements. They are not the main-loop entrypoint either; `.phase()` deliberately does not set `entrypoint`.

### Pre-phase semantics

Pre-phase placements run before the entrypoint. They can mutate state and the entrypoint observes those mutations. If a pre-phase throws, the run aborts: lifecycle becomes `failed`, the main loop never executes, and post-phases still run (so cleanup work attached to `post` still gets a chance).

### Post-phase semantics

Post-phase placements run after the main loop drains. They run on every exit path. If a post-phase throws, the engine collects a warning on state (`code: 'POST_PHASE_FAILED'`) and continues to the next post-phase. The lifecycle is not changed.

### `ExecutionResult.executedNodes` ordering

Pre-phase names appear at the start of `executedNodes`; post-phase names appear at the end (only when the placement completed successfully). Main-loop nodes appear in between.

### Instrumentation

The dispatcher invokes `Instrumentation.phaseEnter(dagName, 'pre' | 'post', placementName, state)` immediately before each phase placement runs and `phaseExit(...)` immediately after. See [Observability](./observability).

### Example

```ts
import { DAGBuilder } from '@noocodex/dagonizer/builder';

const dag = new DAGBuilder('with-phases', '1')
  .node('process', processNode, { success: null })
  .phase('warm-cache', 'pre',  warmCacheNode)
  .phase('flush-logs', 'post', flushLogsNode)
  .build();
```

## `.entrypoint()`

By default the first added node is the entrypoint. Override explicitly:

```ts
new DAGBuilder('dag', '1')
  .node('setup', setupNode, { success: 'main' })
  .node('main', mainNode, { success: null })
  .entrypoint('main')  // skip setup during a resume, for example
  .build();
```

## `.build()`

`build()` materialises the accumulated nodes and returns a `DAG`. It throws an `Error` if no entrypoint has been set (no nodes added and `.entrypoint()` not called).

The returned object is identical to one written by hand. Pass it directly to `dispatcher.registerDAG()`.

## Related reference

- [Phase 02, DAGBuilder demo](../examples/02-builder)
- [Reference, Dagonizer](../reference/dagonizer)
- [Reference, Entities, `DAG`, `SingleNode`, `ScatterNode`, `EmbeddedDAGNode`](../reference/entities)
