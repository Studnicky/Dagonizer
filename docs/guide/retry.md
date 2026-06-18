---
title: 'Retry'
description: 'Dagonizer has two distinct retry mechanisms. Node retry is a flow shape: a node routes a retry output that loops back in the DAG, bounded by a counter on the conceptual-root state. RetryPolicy guards a single operation with backoff, cooperating with the dispatcher AbortSignal.'
seeAlso:
  - text: 'Cancellation'
    link: './cancellation'
    description: 'RetryPolicy.run and node deadlines cooperate with context.signal'
  - text: 'Shared state'
    link: './shared-state'
    description: 'The retry budget lives on NodeStateBase, the conceptual root'
  - text: 'Runtime'
    link: '../reference/runtime'
    description: 'RetryPolicy, BackoffStrategy, and the SchedulerProvider hook'
nextSteps:
  - text: 'Phase 07, Retry demo'
    link: '../examples/07-retry'
    description: 'runnable RetryPolicy-with-backoff example'
---

# Retry

Dagonizer separates two concerns that both get called "retry":

- **Node retry is a flow shape.** When a node cannot complete (its own deadline fires, or its work throws), it makes a *flow decision*: route a `retry` output that the DAG wires back to the node (a loop edge), or, once the attempt budget is spent, route a `salvage` output to a recovery node. The loop and the recovery both live in the topology. No retry policy hides inside the node.
- **`RetryPolicy` guards a single operation.** It wraps one thunk and re-runs it on transient failures with a backoff curve. It is operation-level resilience: the right tool for a flaky network call inside a tool or adapter, not for node control flow.

## Node retry as a flow shape

The attempt counter is built into `NodeStateBase`, the state every consumer extends, so any node can use it and it survives checkpoint/resume:

| Method | Purpose |
|---|---|
| `state.recordAttempt(key)` | Increment the counter for `key`; returns the new count. |
| `state.retriesFor(key)` | Read the count (0 when never recorded). |
| `state.withinRetryBudget(key, max)` | Record an attempt and report whether more remain: `true` → route `retry`, `false` → route `salvage`. |
| `state.clearAttempts(key)` | Reset on success, so a re-entered placement starts fresh. |

`key` is typically `context.nodeName` (the placement name), so each placement keeps its own budget. A node arms its own deadline, and on failure asks the budget which way to route:

<<< @/../examples/the-archivist/nodes/extractQuery.ts#retry-salvage-node

The DAG closes the loop. The `retry` output is a self-edge back to the same placement; the `salvage` output routes to a deterministic recovery node that rejoins the happy path:

<<< @/../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts#retry-salvage-wiring

The recovery computation (here, a naive whitespace term-split when the LLM extractor never answered) lives in `extract-query-salvage`, its own node reached by the `salvage` edge. Keeping it out of the producing node's `catch` is the point: execution (what a node computes) stays separate from flow decisioning (which edge the DAG takes), and a consumer can re-route or replace any recovery without touching the node that failed.

External cancellation is not a retry. When `context.signal` is already aborted, the node re-throws so the engine records the run as cancelled rather than looping.

The validator does no acyclic check, so the self-edge and the multi-node compose loop are both legal topologies. The renderers draw the loop edge directly.

## `RetryPolicy`

`RetryPolicy` retries a thunk on declared error classes with a configurable backoff strategy. `policy.run(task, { signal })` cooperates with the dispatcher's `AbortSignal`, so a cancelled flow stops cleanly mid-retry. Reach for it when a single operation (an HTTP fetch, an API round-trip) fails transiently and the right response is "try the same call again," not "re-route the flow." The adapters use it (via `RetryableErrorPolicy`) for rate-limited LLM API calls.

The Phase 07 demo constructs the policy at module scope so the configuration lives next to the operation it guards and no fresh instance is built per invocation. `jitterFactor: 0` keeps the delay deterministic for the example:

<<< @/../examples/dags/07-retry.ts#policy-config

The node body calls `policy.run(...)`, propagating `context.signal`:

<<< @/../examples/dags/07-retry.ts#retry-node

Runtime wiring is the standard `registerNode` plus `registerDAG` pair:

<<< @/../examples/07-retry.ts#runtime

### `BackoffStrategy`

| Value | Delay formula |
|---|---|
| `CONSTANT` | `baseDelay` (each attempt identical) |
| `LINEAR` | `baseDelay × attempt` |
| `EXPONENTIAL` | `baseDelay × multiplier^(attempt-1)` (default) |
| `DECORRELATED_JITTER` | Random in `[baseDelay, baseDelay × 3]` |

All strategies apply `jitterFactor` (default `0.1`, plus or minus 10%) to spread retry traffic, except `DECORRELATED_JITTER` which is already random. The final delay is capped at `maxDelay` (default 30 s).

### Error filtering

<<< @/../examples/dags/07-retry.ts#error-filtering

Precedence:

1. If `attempt >= maxAttempts`, do not retry.
2. If `abortOn` is set and the error matches, do not retry.
3. If `retryOn` is set and the error does not match, do not retry.
4. Otherwise, retry.

### Abort cooperation

`policy.run(task, { signal: context.signal })` checks the signal before each attempt. During a backoff wait, if the signal fires the wait resolves with the abort reason (thrown). A cancelled flow stops cleanly mid-retry:

<<< @/../examples/dags/07-retry.ts#abort-cooperation

### Custom backoff

Subclass `RetryPolicy` and override `getDelay` for non-standard curves:

<<< @/../examples/dags/07-retry.ts#custom-backoff

Override `shouldRetry` to express conditional logic without modifying the constructor options.

### Deterministic testing

Install `VirtualScheduler` before the policy run so retry sleeps do not block real wall time. Drive each backoff window with `scheduler.advance(ms)`; restore real time with `Clock.reset()` and `Scheduler.reset()` when done:

<<< @/../examples/07-retry.ts#deterministic-testing

See [Testing](../reference/testing) for the full `VirtualScheduler` and `VirtualClockProvider` API.

## Choosing between them

| | Node retry (flow shape) | `RetryPolicy` |
|---|---|---|
| Granularity | A whole node's execution | A single operation (thunk) |
| Where the loop lives | The DAG (a `retry` edge) | Inside `run()`, invisible to the graph |
| Bound | `state.withinRetryBudget(key, max)` | `maxAttempts` |
| On exhaustion | Routes `salvage` to a recovery node | Throws the last error |
| Best for | LLM/agent nodes whose failure is a flow decision | Transient network/API calls in a tool or adapter |

## Related reference

- [Phase 07, Retry demo](../examples/07-retry)
- [Reference, Runtime, `RetryPolicy`, `BackoffStrategy`](../reference/runtime)
- [Reference, Contracts, `RetryPolicyOptionsInterface`](../reference/contracts)
- [Guide, Shared state](./shared-state)
