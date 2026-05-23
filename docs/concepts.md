---
seeAlso:
  - text: 'Architecture'
    link: './architecture'
  - text: 'Getting Started'
    link: './getting-started'
  - text: 'DAGBuilder'
    link: './guide/builder'
  - text: 'Subclassing State'
    link: './guide/subclassing'
---

# Dagonizer concepts

The dispatcher observes every node transition from the moment a flow begins to the moment the cursor is null or execution stops.

## Nodes

A **node** is a vertex in the flow graph. It references one registered node and declares output routing: a map from each output name to the next node name (or `null` to terminate that path).

Four node kinds:

- **`single`** — a single registered node. The node returns one output name; the dispatcher follows the corresponding route.
- **`parallel`** — a set of already-declared single nodes that run concurrently via `Promise.all`. Once all complete, a combine strategy reduces their individual outputs to one aggregate output for routing. Strategies:
  - `all-success` — routes to `success` only when every node returned `success`; otherwise `error`.
  - `any-success` — routes to `success` if at least one node returned `success`; otherwise `error`.
  - `collect` — always routes to `success` and writes a `Record<nodeName, output>` into `state.metadata.parallelOutputs`.
- **`fan-out`** — reads an array from a dotted path in state, runs one registered node per item (with configurable concurrency), then merges results back through a fan-in strategy. Aggregate output is `all-success`, `partial`, `all-error`, or `empty`.
- **`deep-dag`** — invokes a second registered DAG as a nested call, with optional state mapping for input and output. Errors and warnings from the child DAG bubble up to the parent.

### When to choose each

| Need | Kind |
|------|------|
| Sequential steps with conditional branching | `single` |
| Multiple independent fetches that must all finish before proceeding | `parallel` |
| Process every item in a collection, then aggregate | `fan-out` |
| Reuse a DAG across multiple parent DAGs | `deep-dag` |

---

## Node state

Node state is the clipboard that travels through every node in a flow. All mutations happen in-place on the state object.

**`NodeStateInterface`** is the minimum shape the dispatcher requires. It defines:

- `lifecycle` — current lifecycle kind and timestamps
- `errors` / `warnings` — accumulated from all nodes
- `metadata` — generic key-value bag for cross-node communication
- Mutation methods: `collectError`, `collectWarning`, `setMetadata`, and the lifecycle mark methods

**`NodeStateBase`** is the concrete base class. Extend it for domain-specific state:

```ts
class PipelineState extends NodeStateBase {
  items: Item[] = [];
  processedIds = new Set<string>();
}
```

`NodeStateBase.clone()` is called by the dispatcher before fan-out items and deep-DAG calls. The clone carries a copy of `metadata` but resets `lifecycle` to `pending` and clears `errors` and `warnings` — each child execution is a fresh run that accumulates its own results.

To implement `NodeStateInterface` from scratch (without extending `NodeStateBase`), provide your own lifecycle FSM and `clone()`. This is uncommon; most consumers subclass `NodeStateBase`.

---

## Nodes (registered)

A registered node is an object that satisfies `NodeInterface<TState, TOutput>`. It has:

- `name: string` — registry key
- `outputs: readonly TOutput[]` — declared output ports
- `execute(state, context): Promise<NodeOutputInterface<TOutput>>` — the work

Nodes are stateless. All durable state goes through the `TState` argument. A node that needs configuration takes it through its constructor.

**Never-throws contract.** Nodes catch their own errors and express them as output choices:

```ts
const classifyNode: NodeInterface<MyState, 'on_topic' | 'off_topic' | 'error'> = {
  name: 'classify',
  outputs: ['on_topic', 'off_topic', 'error'],
  async execute(state, context) {
    try {
      const result = await classify(state.text, { signal: context.signal });
      state.classification = result;
      return { output: result.label === 'relevant' ? 'on_topic' : 'off_topic' };
    } catch {
      return { output: 'error' };
    }
  },
};
```

**Type-safe `TOutput` generic.** When `TOutput` is narrowed, the node placement's `outputs` must be a `Record<TOutput, string | null>`. If any output is unwired the TypeScript compiler fails the build, and `registerDAG` provides a runtime safety net.

**Output types.** `NodeOutputInterface<TOutput>` carries the output name and an optional `errors` array. Errors are collected into node state, not thrown.

**Optional `validate()`.** Called during `registerNode` if present. Return `{ valid: false, errors: string[] }` to reject the node at registration time.

**Optional `destroy()`.** Called by `dispatcher.destroy()`. Use for resource cleanup (connection pools, etc.).

---

## Lifecycle

Every flow execution has a lifecycle: `pending → running → {completed | failed | cancelled | timed_out}`.

The dispatcher:

- marks `running` when the flow starts
- marks `completed` when every node routes to `null` without error
- marks `failed` when a node throws (nodes should not throw, but the dispatcher guards the boundary)
- marks `cancelled` when the composed `AbortSignal` fires before a deadline
- marks `timed_out` when the `deadlineMs` timer fires

**Terminal stickiness.** Once `completed`, `failed`, `cancelled`, or `timed_out` is reached, the state ignores all further lifecycle events. Illegal transitions throw `DAGError`.

**`lifecycle` is canonical.** There is no `state.status` accessor. Inspect `state.lifecycle.kind` directly. The discriminated union carries timestamps appropriate to each terminal state:

```ts
| { kind: 'pending';   startedAt: null;   finishedAt: null;   error: null;  reason: null }
| { kind: 'running';   startedAt: number; finishedAt: null;   error: null;  reason: null }
| { kind: 'completed'; startedAt: number; finishedAt: number; error: null;  reason: null }
| { kind: 'failed';    startedAt: number; finishedAt: number; error: Error; reason: null }
| { kind: 'cancelled'; startedAt: number; finishedAt: number; error: null;  reason: string }
| { kind: 'timed_out'; startedAt: number; finishedAt: number; error: null;  reason: null }
```

Timestamps are monotonic milliseconds from `Clock.monotonicMs()` — not wall-clock. Use them for duration math, not for display to end-users.

**`DAGLifecycleMachine`** is the pure reducer behind `NodeStateBase`. It is exported for callers that implement their own state class.

---

## Cancellation

Cancellation flows through `AbortSignal`. Pass `{ signal }` and/or `{ deadlineMs }` to `execute()` or `resume()`.

The dispatcher composes multiple signals:

```ts
// caller signal + deadline → AbortSignal.any([callerSignal, AbortSignal.timeout(deadlineMs)])
```

Each node receives the composed signal in `context.signal`. Nodes should propagate it to every awaitable IO call (fetch, database, subprocess). When the signal fires during a backoff wait in `RetryPolicy.run()`, the wait resolves early and the abort propagates up.

When the signal fires between node dispatches, the dispatcher stops without starting the next node. When it fires during a node, the node is responsible for detecting `context.signal.aborted` or propagating the signal to IO.

After early termination:

- `result.cursor` holds the next node that would have run (pass to `dispatcher.resume()` to continue)
- `result.state.lifecycle.kind` is `cancelled` or `timed_out` depending on which signal fired

A caller-controlled `AbortController` cancels the flow; `AbortSignal.timeout(ms)` (wrapped in `deadlineMs`) triggers `timed_out`. Both are composed through `AbortSignal.any()`.

---

## Fan-in strategies

Fan-in runs after all fan-out items have been processed. It writes results back into parent state before the aggregate output (`all-success`, `partial`, `all-error`, `empty`) determines the next node.

**`append`** — requires `target: string` (dotted path). All item results, regardless of their output, are flattened into an array at that path.

```ts
fanIn: { strategy: 'append', target: 'results' }
```

**`partition`** — requires `partitions: Record<outputName, targetPath>`. Items are grouped by their output name and written to separate paths.

```ts
fanIn: { strategy: 'partition', partitions: { success: 'passed', error: 'failed' } }
```

**`custom`** — requires `customNode: string`. The dispatcher sets `state.metadata.fanInResults` to a `Record<outputName, item[]>` map and invokes the named registered node. The node reads the map and writes aggregated data into state however it chooses.

```ts
fanIn: { strategy: 'custom', customNode: 'mergeFanResults' }
```

When to use each:

- `append` when downstream needs a flat list of all items
- `partition` when downstream needs to distinguish successes from errors
- `custom` when the merge logic is non-trivial or domain-specific

---

## Deep-DAG state mapping

Deep-DAGs run in a cloned child state. State mapping controls what crosses the parent/child boundary.

**`input` mapping** — `stateMapping.input` copies fields from the parent node state into the child node state before the deep-DAG runs.

```ts
stateMapping: {
  input: { 'childKey': 'parent.nested.key' }
}
```

Reads `parentState['parent']['nested']['key']` and writes it to `childState['childKey']`.

**`output` mapping** — `stateMapping.output` copies fields from the child node state back into the parent after the deep-DAG returns.

```ts
stateMapping: {
  output: { 'parent.result': 'childResult' }
}
```

Reads `childState['childResult']` and writes it to `parentState['parent']['result']`.

`errors` and `warnings` from the child are always bubbled up — state mapping does not affect error/warning propagation.

If no `stateMapping` is provided, the child starts with a clone of the parent's metadata, and no output values are copied back.



---

## Checkpoint / resume

Checkpoint records the position and state of an in-flight flow so it can be resumed later.

**Cursor** — the name of the next node to run. Set on `ExecutionResultInterface.cursor` when execution stops early. `null` means the flow ran to completion (no resume needed).

**State snapshot** — `NodeStateBase.snapshot()` returns a `JsonObject` containing metadata, errors, and warnings. Domain-specific fields are captured by overriding `snapshotData()`.

**Resume is a new execution.** `dispatcher.resume(dagName, state, cursor)` starts a new lifecycle run from `pending`, identical to `execute()` except it begins at `cursor` instead of the entrypoint. The checkpoint's `executedNodes` and `skippedNodes` are available from `ckpt.restoreState(fn)` for inspection but are not replayed.

**`Checkpoint.capture(dagName, result)`** builds a `Checkpoint` instance from an execution result. Throws if `result.cursor` is `null`.

**`Checkpoint.load(raw).restoreState(factory)`** validates the persisted data against `CheckpointDataSchema` and rehydrates a state instance via the factory function. The factory receives the snapshot `JsonObject` and must return a `TState`.

The package does not provide a persistence backend. Serialize the checkpoint as JSON (`ckpt.toJson()`) and store it wherever your infrastructure requires (file, KV, database row, message envelope, etc.).

---

## Composing Dagonizer with other runtimes

Dagonizer is a one-process DAG dispatcher. It pairs naturally with the runtimes that own the surfaces it deliberately doesn't — durable cross-process state, event-driven UI, distributed work scheduling. The integration points below describe what each pairing shares and where each piece carries its weight.

### Dagonizer + Temporal / durable workflow engines

Temporal owns the durable boundary: workflow definitions live as replayable event histories, survive crashes, and span hours to days. Dagonizer owns the per-task composition: each Temporal Activity (or batch of activities) can be a Dagonizer flow with typed nodes, retry policies, parallel/fan-out, and deep-DAG composition.

What they share: explicit retry semantics, abort signals, and named output routing.

Composition pattern: register Dagonizer DAGs as Temporal Activities, and let Temporal's history replay drive the outer workflow. The Dagonizer dispatcher runs synchronously inside the activity; on activity retry, the dispatcher restarts from the cursor stored in the activity's last heartbeat.

### Dagonizer + XState

XState owns interactive, event-driven state machines: user interactions, device events, hierarchical states, guards, and reactive parallel regions. Dagonizer owns the task graph that runs when a transition fires.

What they share: terminal-state semantics, typed events, immutable transitions.

Composition pattern: an XState transition's `actions` invoke `dispatcher.execute()` on a registered Dagonizer DAG; the result's `lifecycle.kind` becomes the next XState event (`COMPLETED`, `FAILED`, `CANCELLED`). XState owns the *when* and *why*; Dagonizer owns the *what runs*.

### Dagonizer + BullMQ / job queues

BullMQ owns the distributed work surface: cross-process scheduling, rate limiting, prioritization, worker scaling, and Redis-backed persistence. Dagonizer owns the per-job graph that each worker executes.

What they share: typed jobs, retry semantics, structured failures.

Composition pattern: a BullMQ job's payload contains the DAG name and initial state; the worker hydrates state and calls `dispatcher.execute(dagName, state)`. On failure, BullMQ schedules retry with backoff and the dispatcher resumes from `result.cursor` if `Checkpoint.capture()` persisted it.

### What Dagonizer carries on its own

Some flows don't need a wrapping runtime — Dagonizer runs in-process with no external dependencies. The dispatcher is a single class to instantiate; flows are plain JSON-LD objects you store in files, databases, or configuration services. Cancellation, retry, and checkpoint/resume are first-class without spinning up infrastructure.

A Dagonizer flow that needs to call remote workers does so via deep-DAG placements — the local dispatcher composes them into the larger DAG without requiring a new primitive.
