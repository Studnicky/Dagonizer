---
title: 'DAGBuilder'
description: 'DAGBuilder is the chainable authoring API for deterministic workflows. TypeScript narrows the route map at each .node() call from the node TOutput union, so misspelled routes are compile errors before the DAG runs. Output is the same canonical JSON-LD DAG that Dagonizer.load produces and the dispatcher consumes.'
seeAlso:
  - text: 'Authoring DAGs'
    link: './authoring'
    description: 'when to choose DAGBuilder or raw DAG literals'
  - text: 'Subclassing state'
    link: './subclassing'
    description: 'define the state class your nodes mutate'
  - text: 'Shared state'
    link: './shared-state'
    description: 'decision matrix for inputs/gather versus stores; checkpoint integration'
  - text: 'Schema and JSON loading'
    link: './schema'
    description: 'load DAGs from JSON instead of building them in code'
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

See [Authoring DAGs](./authoring) for the decision matrix between DAGBuilder and raw `DAG` literals. Both surfaces produce the same canonical `DAG` JSON-LD object.

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

<<< @/../examples/dags/02-builder.topology.ts#type-safe-routing

## Scatter

`.scatter()` places a `ScatterNode` in the parent flow. A scatter isolates a state clone per source item, runs a body (a registered node or a sub-DAG) in the clone, folds clone state back through a required `gather`, and routes on the aggregate outcome via an outcome `reducer`. `source` is a required positional argument.

`gather` is required on every scatter. Use `{ strategy: 'discard' }` to express a side-effect-only fan-out where no clone state flows back to the parent:

<<< @/../examples/dags/02-builder.topology.ts#scatter-discard

Heterogeneous fan-out — running different logic per item — is expressed by authoring the `source` as a descriptor array and writing a body node that dispatches on `state.metadata.currentItem`:

<<< @/../examples/dags/02-builder.topology.ts#scatter-heterogeneous

`scoutDispatchNode` reads `state.metadata.currentItem` and routes to the matching scout logic. Whether bodies are identical or all different is the implementer's choice; the engine is indifferent.

### Generate-collect pattern

Each source item gets one clone. After all clones finish, the `gather.mapping` writes produced artifacts back in source-index order:

<<< @/../examples/dags/02-builder.topology.ts#scatter-map

`gather.strategy: 'partition'` groups clones by their output token:

<<< @/../examples/dags/02-builder.topology.ts#scatter-partition

The full signature is shown in the scatter placement example:

<<< @/../examples/dags/04-scatter.ts#scatter-placement

`ScatterOptionsType<TState>`:

| Field | Type | Description |
|---|---|---|
| `itemKey?` | `string` | Metadata key the clone reads for the current item. Default `'currentItem'`. |
| `concurrency?` | `number` | Max clones running concurrently. Default: source length. |
| `inputs?` | `Partial<Record<string, Path<TState>>>` | Parent → clone field copy before the body runs. Becomes `stateMapping.input` on the entity. Keys are child-state keys; values are parent-state dotted paths. |
| `gather` | `GatherConfig` | **Required.** How produced clone state merges back into the parent. Use `{ strategy: 'discard' }` for side-effect-only fan-outs. |
| `reducer?` | `string` | Outcome reducer name. Defaults to `'aggregate'`. Built-in reducers: `'aggregate'`, `'terminal'`, `'all-success'`, `'any-success'`. Custom reducers registered via `OutcomeReducers.register` are referenceable by name. |

`Path<T>` enumerates valid dotted-path strings over a state shape recursively. For example `Path<{ user: { name: string; age: number } }>` resolves to `'user' | 'user.name' | 'user.age'`. Arrays contribute `${number}` and `${number}.${ElementPath}` paths. The depth cap is 8 levels; deeper nesting falls back to `string`. The type is exported from the `@studnicky/dagonizer/builder` subpath.

The `inputs` option in a scatter call uses `Path<TState>` to constrain parent dotted paths at compile time:

<<< @/../examples/dags/02-builder.topology.ts#scatter-inputs

When `body` is a `NodeInterface`, the impl is registered automatically and the placement emits `body: { node: body.name }`.

When `body` is `{ dag: 'name' }`, the placement runs a full registered sub-DAG per clone. Pair with the `container` key on the raw scatter entity to dispatch each clone to an isolate (worker thread, child process). See [Distribution and cloud](./distribution) for the `DagContainerBase` authoring guide and the `DagonizerOptionsType.containers` binding.

For patterns where nodes across multiple scatter placements accumulate to shared mutable state (agent memory, audit log), see [Shared state](./shared-state).

## Embedded DAG

`.embeddedDAG()` places an `EmbeddedDAGNode` in the parent flow. It invokes a registered sub-DAG exactly once (cardinality 1) and routes the parent on the child's terminal outcome (`success` | `error`). `options.inputs` seeds the child from the parent before it runs; `options.outputs` copies child fields back into the parent after the child completes.

<<< @/../examples/dags/09-terminals.ts#embedded-terminals

The pattern with inputs and outputs field mapping is shown in the embedded DAG parent:

<<< @/../examples/dags/05-embedded-dags.ts#parent-dag

`TypedEmbeddedDAGOptionsType<TChildState, TParentState>`:

| Field | Type | Description |
|---|---|---|
| `inputs?` | `Partial<Record<keyof TChildState, ParentPath<TParentState>>>` | Child-state key → parent dotted path. Copied into the child before it runs. |
| `outputs?` | `Partial<Record<ParentPath<TParentState>, keyof TChildState>>` | Parent dotted path → child-state key. Copied back into the parent after the child completes. |

Supply `TChildState` and `TParentState` to narrow path strings at compile time; both default to `NodeStateInterface`, which accepts any string.

### Runtime DAG resolution: `dagFrom` and `from`

Both `.scatter()` and `.embeddedDAG()` accept a runtime-resolved DAG name in addition to a build-time string literal. This is the engine's primitive for recursion and self-reference: the DAG to run is chosen from state at execution time rather than being hard-coded at authoring time.

**`.embeddedDAG()` with `{ from: 'statePath' }`**

Pass `{ from: 'statePath' }` as the `dag` argument. At execution time the engine reads the dotted state path and looks up the resulting string as a registered DAG name. If the resolved name is unregistered, the placement routes to `error` without throwing.

```ts
// The DAG to invoke is stored in state.selectedDag at runtime.
builder.embeddedDAG(
  'invoke',
  { from: 'selectedDag' },   // resolved from state at execution time
  { success: 'next', error: 'end-fail' },
);
```

**`.scatter()` with `{ dagFrom: 'statePath' }` as the body**

Pass `{ dagFrom: 'statePath' }` as the `body` argument. Each scatter clone resolves the state path to a DAG name and runs that DAG as its body. Unregistered names route the clone to `error`.

```ts
builder.scatter(
  'fan-out',
  'items',
  { dagFrom: 'cloneConfig.targetDag' },  // resolved per-clone from state
  { 'all-success': 'merge', 'all-error': 'end-fail', 'partial': 'merge', 'empty': 'end' },
  { gather: { strategy: 'discard' } },
);
```

Both variants are the engine's only recursive primitive: a node can write a DAG name into state (or inherit one from its placement's source item) and the engine resolves it at the point of invocation. This enables trampoline flows and polymorphic fan-out without hard-coded DAG names in the topology.

## `.terminal(name, options?)`

<<< @/../examples/dags/09-terminals.ts#terminal-completed

Appends a `TerminalNode` placement. When the engine reaches it, the flow ends with the declared `outcome`. The default is `'completed'`. Passing `{ outcome: 'failed' }` marks the state as failed before resolving.

TerminalNodes carry no `outputs` map. They are placement-only constructs with no backing `NodeInterface`. Every output of every node in a DAG must route to another named node — a `TerminalNode` placement is the only valid flow endpoint.

### Routing embedded-DAG outputs to a terminal placement

An `EmbeddedDAGNode` placement targets named terminals directly:

<<< @/../examples/dags/09-terminals.ts#embedded-terminals

When the child DAG exits with a failed terminal, the `error` output arrives at `end-fail`, which marks the parent flow `failed`. Without a named terminal, the author would need a dedicated SingleNode to call `state.markFailed()`. The terminal collapses that to one `.terminal(name, { outcome: 'failed' })` call.

### Example, two explicit terminals

<<< @/../examples/dags/09-terminals.ts#terminal-failed

Running with `state.shouldPass = true` produces `lifecycle.variant = 'completed'`; running with `false` produces `'failed'`.

## `.phase(name, phase, node)`

<<< @/../examples/dags/19-phase-nodes.ts#phase-dag

Appends a `PhaseNode` placement: a lifecycle-attached task that runs around the main DAG loop rather than inside it. `phase: 'pre'` placements run before the entrypoint in DAG declaration order. `phase: 'post'` placements run after the main loop drains, in DAG declaration order, on every exit path (completion, abort, timeout, terminal-failed, node throw).

PhaseNodes carry no `outputs`. They never route to other placements. They are not the main-loop entrypoint either; `.phase()` deliberately does not set `entrypoint`.

### Pre-phase semantics

Pre-phase placements run before the entrypoint. They can mutate state and the entrypoint observes those mutations. If a pre-phase throws, the run aborts: lifecycle becomes `failed`, the main loop never executes, and post-phases still run (so cleanup work attached to `post` still gets a chance).

### Post-phase semantics

Post-phase placements run after the main loop drains. They run on every exit path. If a post-phase throws, the engine collects a warning on state (`code: 'POST_PHASE_FAILED'`) and continues to the next post-phase. The lifecycle is not changed.

### `ExecutionResult.executedNodes` ordering

Pre-phase names appear at the start of `executedNodes`; post-phase names appear at the end (only when the placement completed successfully). Main-loop nodes appear in between.

### Phase hooks

The dispatcher invokes `onPhaseEnter(dagName, 'pre' | 'post', placementName, state)` immediately before each phase placement runs and `onPhaseExit(...)` immediately after. Override these protected methods in a `Dagonizer` subclass to observe phase boundaries. See [Observability](./observability).

### Example

<<< @/../examples/dags/19-phase-nodes.ts#phase-dag

## `.entrypoint()`

By default the first added node is the entrypoint. Override explicitly:

<<< @/../examples/dags/02-builder.topology.ts#entrypoint-override

## `.build()`

`build()` materialises the accumulated nodes and returns a `DAG`. It throws an `Error` if no entrypoint has been set (no nodes added and `.entrypoint()` not called).

The returned object is identical to one written by hand. Pass it directly to `dispatcher.registerDAG()`.

## Related reference

- [Phase 02, DAGBuilder demo](../examples/02-builder)
- [Reference, Dagonizer](../reference/dagonizer)
- [Reference, Entities, `DAG`, `SingleNode`, `ScatterNode`, `EmbeddedDAGNode`](../reference/entities)
