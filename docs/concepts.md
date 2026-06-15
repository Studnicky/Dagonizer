---
seeAlso:
  - text: 'The Archivist demo'
    link: './examples/the-archivist'
    description: 'these concepts in a running LLM-agent flow'
  - text: 'The Cartographer demo'
    link: './examples/the-cartographer'
    description: 'these concepts in a running data-orchestration / ETL flow'
  - text: 'Architecture'
    link: './architecture'
    description: 'internals and submodule layout'
  - text: 'Getting Started'
    link: './getting-started'
    description: 'install and run a one-node DAG'
  - text: 'DAGBuilder'
    link: './guide/builder'
    description: 'fluent authoring API'
  - text: 'Subclassing state'
    link: './guide/subclassing'
    description: 'domain state classes'
---

# Concepts

Vocabulary that the rest of the docs assume. The engine is domain-agnostic: agentic LLM orchestration and data-orchestration / ETL are the same engine — only the node domain differs. The Archivist demo shows LLM-agent concepts in a running flow; the Cartographer demo shows data-pipeline and streaming concepts. Read this after running either (or both).

## Node

The fundamental unit of work is a **batch**. A **node** consumes a `Batch<TState>` and returns a `RoutedBatch<TOutput>` — it **partitions** the batch's items across its named output ports. That single operation is the one node contract:

```ts
execute(batch: Batch<TState>, context): Promise<RoutedBatch<TOutput, TState>>
```

A single item is a batch of one; the engine never processes a scalar specially. **Routing is partitioning**: a node distributing items across `needs-gdpr` / `geo-only` ports, micro-batching, and the reservoir are all the same mechanism — `Map<output, Batch>`.

You almost never write `execute` by hand. Nodes descend from the **taxonomy**:

- **`MonadicNode<TState, TOutput, TServices>`** — the root node base (the *monad*). Implements `NodeInterface` and supplies `name` / `outputs` / `contract` / `timeout` / `validate` / `destroy`, leaving `execute(batch)` abstract. Extend it directly to author a **batch-native** node — the hot path where one call processes the whole batch and hits shared caches across it.
- **`ScalarNode<TState, TOutput, TServices>`** — extends `MonadicNode` and is the **per-item** specialization. You implement `protected executeOne(state, context): Promise<NodeOutputInterface<TOutput>>`; the base loops it over the batch and groups items by the returned port. This is the common case.

The classify-intent node in the Archivist is a typical `ScalarNode`: its `executeOne` reads the user query, writes a classification to state, and returns one of `'discover' | 'identify' | 'recall' | 'rejected'`.

```ts
class ClassifyIntentNode extends ScalarNode<ArchivistState, 'on-topic' | 'off-topic'> {
  readonly name = 'classify-intent';
  readonly outputs = ['on-topic', 'off-topic'] as const;
  protected override async executeOne(state: ArchivistState): Promise<NodeOutputInterface<'on-topic' | 'off-topic'>> {
    state.classification = classify(state.query);
    return NodeOutputBuilder.of(state.classification === 'rejected' ? 'off-topic' : 'on-topic');
  }
}
```

Nodes are registered with the dispatcher under a string name; the same registered node can appear in many DAGs and placements. A node never throws — a per-item error routes to the item's `error` port (its own sub-batch). The dispatcher guards the boundary, but a throwing node is a bug.

## DAG

A **DAG** is a JSON-LD document that declares an entrypoint and a list of node placements with their routing. It is plain data: store it in a file, a database row, or a configuration service, and load it through `Dagonizer.load(json)`. Validation against `DAGSchema` happens at the ingest boundary; everything downstream is typed.

The Archivist DAG has roughly ten placements covering classify, scout scatter, compose retry loop, and persist. Its `@context` and `@type` discriminator make it both a runtime artifact and a Linked Data document.

## Placement

A **placement** is one vertex in the DAG. Each placement has a name, a `@type` discriminator that selects the kind, and an `outputs` map that routes named outputs to the next placement. Flows terminate at an explicit `TerminalNode` placement.

Five kinds:

- **`single`**: one registered node. The node returns one output name; the dispatcher follows the corresponding route.
- **`scatter`**: isolates one state clone per item in a source array, runs a node body in each clone, merges produced clone state back into the parent via a `gather` config, and routes on the aggregate outcome via a `reducer`. This is the fork (generate-collect) pattern; a `ScatterNode` is always 1→N over a required `source`.
- **`embedded`**: invokes a registered sub-DAG exactly once (cardinality 1) in an isolated state, then routes the parent on the child's terminal outcome (`success` or `error`). Optional `stateMapping` seeds the child from the parent before it runs and copies fields back after it completes. The Archivist's sub-DAG compositions are `EmbeddedDAGNode` placements.
- **`terminal`**: named end state for explicit completion or failure. Use when a flow has more than one "done" semantics (for example, `accepted` versus `rejected`).
- **`phase`**: a single placement that wraps one registered node with a lifecycle attachment. `phase: 'pre'` runs the node before the DAG entrypoint; `phase: 'post'` runs the node after the main loop drains on every exit path. Pre-phase errors abort the run; post-phase errors are collected as warnings and do not change the already-set lifecycle. Phase placements carry no `outputs` and cannot route to other placements.

### When to choose each

| Need | Kind |
|------|------|
| Sequential steps with conditional branching | `single` |
| Process every item in a collection, then aggregate | `scatter` |
| Invoke a registered sub-DAG exactly once and route on its outcome | `embedded` |
| Distinguish multiple terminal semantics | `terminal` |
| Attach a pre- or post-run lifecycle hook to the DAG | `phase` |

## State

**State** is the shared data bag that travels through every node. It implements `NodeStateInterface` and typically extends `NodeStateBase`. The Archivist's `ArchivistState` carries the user query, classification, retrieved candidates, scout results, composed answer, and persistence metadata.

All mutations happen in place on the state object. The dispatcher returns the same reference it received.

`NodeStateBase` provides:

- `lifecycle`: discriminated union of the current lifecycle kind plus timestamps
- `errors` and `warnings`: arrays collected from every node
- `metadata`: generic key-value bag for cross-node messages
- `collectError`, `collectWarning`, `setMetadata`, lifecycle mark methods

`clone()` is called by the dispatcher before scatter clones. The clone carries a copy of `metadata` but resets `lifecycle` to `pending` and clears `errors` and `warnings`. Each child execution is a fresh run.

Override `snapshotData()` and `restoreData()` to make domain fields checkpointable.

## Lifecycle

A **lifecycle** is the FSM behind each DAG execution: `pending → running → completed | failed | cancelled | timed_out`. `DAGLifecycleMachine` is the pure reducer; `NodeStateBase` owns the instance.

- The dispatcher marks `running` when the flow starts.
- It marks `completed` when the flow reaches a `TerminalNode` with `outcome: 'completed'` (the default).
- It marks `failed` when a node throws (which should not happen, but the dispatcher guards the boundary), or when execution reaches a `TerminalNode` with `outcome: 'failed'`.
- It marks `cancelled` when the composed `AbortSignal` fires before a deadline.
- It marks `timed_out` when the `deadlineMs` timer fires.

Terminal states are sticky. Once a flow is `completed`, `failed`, `cancelled`, or `timed_out`, further lifecycle events are ignored.

The discriminated union carries timestamps appropriate to each state:

```ts
| { kind: 'pending';   startedAt: null;   finishedAt: null;   error: null;  reason: null }
| { kind: 'running';   startedAt: number; finishedAt: null;   error: null;  reason: null }
| { kind: 'completed'; startedAt: number; finishedAt: number; error: null;  reason: null }
| { kind: 'failed';    startedAt: number; finishedAt: number; error: Error; reason: null }
| { kind: 'cancelled'; startedAt: number; finishedAt: number; error: null;  reason: string }
| { kind: 'timed_out'; startedAt: number; finishedAt: number; error: null;  reason: null }
```

Timestamps are monotonic milliseconds from `Clock.monotonicMs()`, not wall-clock. Use them for duration math, not for display.

## Dispatcher

The **dispatcher** is the `Dagonizer<TState>` instance. It holds the node and DAG registries, owns the execution loop, and exposes the observability hooks (`onFlowStart`, `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`). Consumers extend `Dagonizer` to compose multi-observer behavior into one subclass.

Production code instantiates one dispatcher per process. Tests instantiate per case for isolation.

## Execution

An **execution** is one run of a DAG. `dispatcher.execute(dagName, state, options)` returns an `Execution<TState>` that is both `PromiseLike` (await it for the final result) and `AsyncIterable` (iterate it for one event per node). Both modes share a single internal generator; the flow body runs once.

`ExecutionResultInterface` carries:

- `state`: the final state (same reference as the input)
- `cursor`: the next node that would have run, or `null` if the flow completed
- `executedNodes`: nodes that ran
- `skippedNodes`: nodes skipped (for example, an empty scatter)

When `cursor` is non-null, the execution stopped early. Pass it to `dispatcher.resume()` to continue.

## Route

A **route** is the directed edge in the DAG: an output name on one placement mapped to the name of the next placement. The Archivist's classify-intent placement has four routes, one per output. The TypeScript compiler verifies that every declared output in the node's `TOutput` union appears in the placement's `outputs` map; an unwired output is a build error before `registerDAG` runs the same check at runtime.

## Cancellation

Cancellation flows through `AbortSignal`. Pass `{ signal }` or `{ deadlineMs }` to `execute()` or `resume()`. The dispatcher composes them:

```ts
AbortSignal.any([callerSignal, AbortSignal.timeout(deadlineMs)])
```

Each node receives the composed signal as `context.signal`. Nodes propagate it to every awaitable IO call. `RetryPolicy.run()` resolves its backoff sleep early when the signal fires.

When the signal fires between nodes, the dispatcher stops without starting the next one. When it fires during a node, the node is responsible for detecting `context.signal.aborted` or threading the signal through its IO.

After early termination: `result.cursor` holds the next node that would have run, and `result.state.lifecycle.kind` is `cancelled` or `timed_out`.

## Scatter gather strategies

After all clones finish, a gather strategy merges clone state back into the parent. The strategy is declared in `GatherConfig.strategy`.

**`map`** copies fields from each clone into the parent. One clone writes a scalar; N clones produce an index-ordered array append. This is the generate-collect pattern: each clone writes a produced artifact and all artifacts land in one parent array.

```ts
gather: { strategy: 'map', mapping: { 'candidate': 'candidates' } }
```

**`append`** requires `target` (dotted path). Flattens the clone's `field` (or the source item when `field` is absent) across all clones into the target array.

```ts
gather: { strategy: 'append', target: 'results' }
```

**`partition`** requires `partitions: Record<outputToken, targetPath>`. Buckets clones by their output token and writes each group to its declared path.

```ts
gather: { strategy: 'partition', partitions: { success: 'passed', error: 'failed' } }
```

**`collect`** requires `target` (dotted path) and an optional `field`. Collects each clone's output token (or `field` value when specified) into `target` in source-index order. Unlike `append`, `collect` preserves positional correspondence between source items and their collected values.

```ts
gather: { strategy: 'collect', target: 'outputTokens' }
```

**`discard`** is a no-op merge. Clones run for side-effects only; no clone state flows back to the parent. Use when the body node writes to an external store and the parent state needs no update.

```ts
gather: { strategy: 'discard' }
```

**`custom`** requires `customNode: string`. The dispatcher stages the per-clone records under `state.metadata.gatherResults` and dispatches the named registered node. The Archivist's `mergeCandidates` node uses `custom` to deduplicate scout results by canonical book id.

```ts
gather: { strategy: 'custom', customNode: 'mergeCandidates' }
```

### Authoring a custom gather strategy

A gather strategy is **one fold** over batches — `initial → reduce → finalize`:

```ts
class TopNGather extends GatherStrategy {
  readonly name = 'top-n';
  override initial(config, state, accessor): void { /* seed the accumulator in state */ }
  override reduce(config, batch: Batch<GatherRecord>, state, accessor): void { /* fold a batch of clone results */ }
  override async finalize(config, execution): Promise<void> { /* end-of-gather work (e.g. invoke a node) */ }
}
GatherStrategies.register(new TopNGather());
```

There is no `apply` / `applyIncremental` split and no `IncrementalGatherStrategy`: "incremental" is a `reduce` over a batch of 1, "all-at-once" is a `reduce` over a batch of N — the same method. Strategies that need every result (top-N, sort) accumulate in `reduce` and compute in `finalize`.

## Streaming and backpressure

`ScatterNode` has one code path for both finite and streaming sources. A `source` that is an array is a finite producer; a `source` that is an `AsyncIterable` or `AsyncGenerator` is a stream. Both drain through the same bounded worker pool.

`concurrency` is the backpressure mechanism. The engine pulls the next item from the source only when a worker slot frees. No item is fetched ahead of capacity; the producer cannot overrun the pool.

Resume is durable via an **inbox/work-queue**. An item stays checkpointed (un-acked) until its body completes successfully. On crash or early termination, the inbox is restored and only un-acked items reprocess. The stream source is never re-read from the beginning. This gives exactly-once processing semantics across restarts.

"Streaming is configuration, not a duplicate code path." The same scatter placement that fans over a static array also fans over a live feed; the only change is the type of the `source` value.

The Cartographer demo exercises this pattern: multi-format satellite tracking feeds are streamed through per-format ingest sub-DAGs with bounded concurrency and durable-inbox resume.

## Scatter outcome reducers

After gather, an outcome reducer maps the set of per-clone records to one routing output for the scatter placement. The reducer name comes from `ScatterNode.reducer`.

**`aggregate`** (default) counts records where `output === 'success'`. Returns `all-success`, `partial`, `all-error`, or `empty`.

## Clone input seeding

`stateMapping.input` seeds each clone before the body runs. Keys are dotted paths on the clone; values are dotted paths on the parent. The copy runs once per clone, before the body starts.

```ts
stateMapping: { input: { 'query': 'request.query' } }
```

Authored via the `inputs` option on `.scatter()` (or `.embeddedDAG()` for embedded-DAG placements). Without `stateMapping.input`, the clone starts with the parent's metadata and no domain-field seeds beyond what `clone()` copies.

## Checkpoint and resume

A **checkpoint** records the position and state of an in-flight flow so it can resume later.

- **Cursor**: the name of the next node to run. Set on `ExecutionResultInterface.cursor` when execution stops early. `null` means the flow ran to completion.
- **State snapshot**: `NodeStateBase.snapshot()` returns a `JsonObject` containing metadata, warnings, and the retry budget. Engine errors are excluded from snapshots; they flow via `outcome.errors`. Domain-specific fields are captured by overriding `snapshotData()`.

Resume is a new execution. `dispatcher.resume(dagName, state, cursor)` starts a new lifecycle run from `pending`, identical to `execute()` except it begins at `cursor` instead of the entrypoint. The checkpoint's `executedNodes` and `skippedNodes` are available from the `RecalledCheckpoint` returned by `ckpt.restoreState(adapter)` for inspection; they are not replayed.

`Checkpoint.capture(dagName, result)` builds a `Checkpoint` instance from an execution result. It throws if `result.cursor` is `null`.

`Checkpoint.load(raw).restoreState(CheckpointRestoreAdapterFn.fromFn(factory))` validates the persisted data against `CheckpointDataSchema` and rehydrates a state instance via the factory. `CheckpointRestoreAdapterFn` ships from `@noocodex/dagonizer/checkpoint`.

The package does not provide a persistence backend. Serialize the checkpoint as JSON (`ckpt.toJson()`) and store it wherever your infrastructure requires.

## Composing Dagonizer with other runtimes

Dagonizer is a one-process DAG dispatcher. It pairs naturally with runtimes that own the surfaces it deliberately does not: durable cross-process state, event-driven UI, distributed work scheduling.

### Dagonizer plus Temporal or durable workflow engines

Temporal owns the durable boundary: workflow definitions live as replayable event histories, survive crashes, and span hours to days. Dagonizer owns the per-task composition: each Temporal Activity (or batch of activities) can be a Dagonizer flow with typed nodes, retry policies, parallel and scatter, and scatter sub-DAG composition.

Shared: explicit retry semantics, abort signals, named output routing.

Pattern: register Dagonizer DAGs as Temporal Activities; let Temporal's history replay drive the outer workflow. The dispatcher runs synchronously inside the activity. On activity retry the dispatcher restarts from the cursor stored in the activity's last heartbeat.

### Dagonizer plus XState

XState owns interactive, event-driven state machines: user interactions, device events, hierarchical states, guards, reactive parallel regions. Dagonizer owns the task graph that runs when a transition fires.

Shared: terminal-state semantics, typed events, immutable transitions.

Pattern: an XState transition's `actions` invoke `dispatcher.execute()` on a registered Dagonizer DAG; the result's `lifecycle.kind` becomes the next XState event (`COMPLETED`, `FAILED`, `CANCELLED`). XState owns the *when* and *why*; Dagonizer owns the *what runs*.

### Dagonizer plus BullMQ or job queues

BullMQ owns the distributed work surface: cross-process scheduling, rate limiting, prioritization, worker scaling, Redis-backed persistence. Dagonizer owns the per-job graph that each worker executes.

Shared: typed jobs, retry semantics, structured failures.

Pattern: a BullMQ job's payload contains the DAG name and initial state; the worker hydrates state and calls `dispatcher.execute(dagName, state)`. On failure, BullMQ schedules retry with backoff and the dispatcher resumes from `result.cursor` when `Checkpoint.capture()` persisted it.

### What Dagonizer carries on its own

Some flows do not need a wrapping runtime. Dagonizer runs in-process with no external dependencies. The dispatcher is a single class to instantiate; flows are plain JSON-LD objects you store in files, databases, or configuration services. Cancellation, retry, and checkpoint/resume work without spinning up infrastructure.

A Dagonizer flow that needs to call remote workers does so via scatter placements with a `dag` body; the local dispatcher composes them into the larger DAG without requiring a new primitive.
