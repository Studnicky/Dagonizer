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
  - text: 'Example 07: Retry Flow'
    link: '../examples/07-retry'
    description: 'runnable RetryPolicy-with-backoff example'
---

<script setup lang="ts">
import { ComposeRetryLoopDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Retry

## What It Is

Dagonizer has two different retry mechanisms, and the distinction matters.

Node retry is graph topology: a node routes a `retry` output back into the DAG, and a state counter decides when to stop looping and route to salvage. `RetryPolicy` is operation resilience: it retries one transient call with backoff while honoring `context.signal`.

## How It Works

Node retry is a route decision: state counts attempts and the DAG loops to retry or routes to salvage. `RetryPolicy` is an operation wrapper: it waits with backoff and cooperates with `context.signal` before returning control to the node. Both can be used together, but they solve different problems.

Dagonizer separates two concerns that both get called "retry":

- **Node retry is a flow shape.** When a node cannot complete (its own deadline fires, or its work throws), it makes a *flow decision*: route a `retry` output that the DAG wires back to the node (a loop edge), or, once the attempt budget is spent, route a `salvage` output to a recovery node. The loop and the recovery both live in the topology. No retry policy hides inside the node.
- **`RetryPolicy` guards a single operation.** It wraps one thunk and re-runs it on transient failures with a backoff curve. It is operation-level resilience: the right tool for a flaky network call inside a tool or adapter, not for node control flow.

## Diagrams, Examples, and Outputs

The Archivist compose retry loop shows retry as visible topology: `retry` loops back, `salvage` routes to recovery, and success moves forward. The diagram is generated from the embedded DAG used by the runnable example pages:

<DagJsonMermaid :dag="ComposeRetryLoopDAG" title="Archivist compose retry loop" aria-label="Archivist compose retry loop JSON-LD DAG beside Mermaid generated from it." />

- [Cancellation](./cancellation) - RetryPolicy.run and node deadlines cooperate with context.signal
- [Shared state](./shared-state) - The retry budget lives on NodeStateBase, the conceptual root
- [Runtime](../reference/runtime) - RetryPolicy, BackoffStrategy, and the SchedulerProvider hook
- [Example 07: Retry Flow](../examples/07-retry) - runnable RetryPolicy-with-backoff example
- [Example 22: Retry Timing and Salvage](../examples/22-backoff-strategies) - retry timing beside visible salvage topology

## What It Lets You Do

### Use when

Use this guide when deciding between retry as visible DAG flow and retry as a runtime policy around one transient operation. The distinction keeps reviewer-visible control flow separate from provider/network resilience.

## Code Samples

The snippets below show both sides of retry: visible retry/salvage edges in a real DAG and operation-level `RetryPolicy` configuration for transient calls.

## Details for Nerds

### Node retry as a flow shape

The attempt counter is built into `NodeStateBase`, the state every application extends, so any node can use it and it survives checkpoint/resume:

| Method | Purpose |
|---|---|
| `state.recordAttempt(key)` | Increment the counter for `key`; returns the new count. |
| `state.retriesFor(key)` | Read the count (0 when never recorded). |
| `state.withinRetryBudget(key, max)` | Record an attempt and report whether more remain: `true` → route `retry`, `false` → route `salvage`. |
| `state.clearAttempts(key)` | Reset on success, so a re-entered placement starts fresh. |

`key` is typically `context.nodeName` (the placement observability label), so each placement keeps its own budget. A node arms its own deadline, and on failure asks the budget which way to route:

<<< @/../examples/the-archivist/nodes/extractQuery.ts#retry-salvage-node

The DAG closes the loop. The `retry` output is a self-edge back to the same placement; the `salvage` output routes to a deterministic recovery node that rejoins the happy path:

<<< @/../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts#retry-salvage-wiring

The recovery computation (here, a naive whitespace term-split when the LLM extractor never answered) lives in `extract-query-salvage`, its own node reached by the `salvage` edge. Keeping it out of the producing node's `catch` is the point: execution (what a node computes) stays separate from flow decisioning (which edge the DAG takes), and an application can re-route or replace any recovery without touching the node that failed.

External cancellation is not a retry. When `context.signal` is already aborted, the node re-throws so the engine records the run as cancelled rather than looping.

The validator does no acyclic check, so the self-edge and the multi-node compose loop are both legal topologies. The renderers draw the loop edge directly.

### `RetryPolicy`

`RetryPolicy` retries a thunk on declared error classes with a configurable backoff strategy. `policy.run(task, { signal })` cooperates with the dispatcher's `AbortSignal`, so a cancelled flow stops cleanly mid-retry. Reach for it when a single operation (an HTTP fetch, an API round-trip) fails transiently and the right response is "try the same call again," not "re-route the flow." The adapters use it (via `RetryableErrorPolicy`) for rate-limited LLM API calls.

Example 07 constructs the policy at module scope so the configuration lives next to the operation it guards and no fresh instance is built per invocation. `jitterFactor: 0` keeps the delay deterministic for the example:

<<< @/../examples/dags/07-retry.ts#policy-config

The node body calls `policy.run(...)`, propagating `context.signal`:

<<< @/../examples/dags/07-retry.ts#retry-node

Runtime wiring is the standard `registerNode` plus `registerDAG` pair:

<<< @/../examples/07-retry.ts#runtime

#### `BackoffStrategy`

`BackoffStrategyType` is a string union: `'constant' | 'linear' | 'exponential' | 'decorrelated-jitter'`. Use the runtime string values directly, or reference the `BackoffStrategyNames` constants object (`CONSTANT`, `LINEAR`, `EXPONENTIAL`, `DECORRELATED_JITTER`) whose values resolve to those strings.

| Constant key | Runtime string value | Delay formula |
|---|---|---|
| `CONSTANT` | `'constant'` | `baseDelay` (each attempt identical) |
| `LINEAR` | `'linear'` | `baseDelay × attempt` |
| `EXPONENTIAL` | `'exponential'` | `baseDelay × multiplier^(attempt-1)` (default) |
| `DECORRELATED_JITTER` | `'decorrelated-jitter'` | Random in `[baseDelay, baseDelay × 3]` |

All strategies apply `jitterFactor` (default `0.1`, plus or minus 10%) to spread retry traffic, except `'decorrelated-jitter'` which is already random. The final delay is capped at `maxDelay` (default 30 s).

#### Error filtering

<<< @/../examples/dags/07-retry.ts#error-filtering

Precedence:

1. If `attempt >= maxAttempts`, do not retry.
2. If `abortOn` is set and the error matches, do not retry — an explicit abort list always wins, even against a `DAGError` that self-reports `retryable: true`.
3. If `retryOn` is set, the error must match it to retry; a miss does not retry, even against a `DAGError` that self-reports `retryable: true`.
4. If no `retryOn` filter is set and the error is a `DAGError`, retry only when `error.retryable` is `true`.
5. Otherwise (no filters, non-`DAGError` error), retry.

A `DAGError` constructed with `retryable: false` (the schema default — see [Reference: Errors](../reference/errors)) is therefore not retried unless an explicit `retryOn` matcher opts it back in, or the throw site passes `retryable: true`.

#### Abort cooperation

`policy.run(task, { signal: context.signal })` checks the signal before each attempt. During a backoff wait, if the signal fires the wait resolves with the abort reason (thrown). A cancelled flow stops cleanly mid-retry:

<<< @/../examples/dags/07-retry.ts#abort-cooperation

#### Custom backoff

Subclass `RetryPolicy` and override `getDelay` for non-standard curves:

<<< @/../examples/dags/07-retry.ts#custom-backoff

Override `shouldRetry` to express conditional logic without modifying the constructor options.

#### Deterministic testing

Install `VirtualScheduler` before the policy run so retry sleeps do not block real wall time. Drive each backoff window with `scheduler.advance(ms)`; restore real time with `Clock.reset()` and `Scheduler.reset()` when done:

<<< @/../examples/07-retry.ts#deterministic-testing

See [Testing](../reference/testing) for the full `VirtualScheduler` and `VirtualClockProvider` API.

### Composing with adapter resilience

`RetryPolicy`, `BaseAdapter`'s opt-in circuit breaker/token bucket, and `DAGError.retryable` are three independent failure-handling concerns. Each answers a different question, and `BaseAdapter.chat()` composes all three in one fixed order for its OWN internal handling:

1. **Circuit breaking** (`CircuitBreaker`, outermost) — fail fast once a backend has failed enough times in a row. An open circuit rejects `chat()` with `CircuitBreakerOpenError` instantly, before anything else runs.
2. **Rate limiting** (`TokenBucket`, next) — bound throughput. An exhausted bucket rejects `chat()` with `TokenBucketExhaustedError`, again before any attempt or retry.
3. **Retry** (`RetryableErrorPolicy`, an internal `RetryPolicy` subclass, innermost) — re-run one transient failure with backoff, honoring each `LlmError`'s `classification.retryable` flag.

This ordering means a call that is about to fail fast (open circuit, empty bucket) never burns a retry attempt or a rate-limit token it was never going to use — see [Reference: Adapters](../reference/adapters#baseadapter) for the field-level configuration (`circuitBreaker`/`tokenBucket` on `BaseAdapterOptionsType`).

**An application-owned outer `RetryPolicy` is a different scenario.** Wrapping the whole `chat()` call in your own retry policy (`await outer.run(() => adapter.chat(request))`) sits above all three internal mechanisms. When the circuit is open, `chat()` throws `CircuitBreakerOpenError` immediately — no internal retry is even attempted — and a naive outer `RetryPolicy` with no filters would retry that rejection anyway, hammering an already-open circuit `maxAttempts` times. List both resilience errors in `abortOn` to avoid this:

```ts
import { RetryPolicy } from '@studnicky/dagonizer/runtime';
import { CircuitBreakerOpenError, TokenBucketExhaustedError } from '@studnicky/dagonizer/adapter';

const outer = RetryPolicy.from({
  maxAttempts: 3,
  abortOn: [CircuitBreakerOpenError, TokenBucketExhaustedError],
});

const response = await outer.run(() => adapter.chat(request));
```

This is documented guidance, not an enforced default. An application that wants an outer retry to keep probing through a half-open circuit can configure its policy differently. See [Error filtering](#error-filtering) above for how `abortOn` composes with `DAGError.retryable`.

### Choosing between them

| | Node retry (flow shape) | `RetryPolicy` |
|---|---|---|
| Granularity | A whole node's execution | A single operation (thunk) |
| Where the loop lives | The DAG (a `retry` edge) | Inside `run()`, invisible to the graph |
| Bound | `state.withinRetryBudget(key, max)` | `maxAttempts` |
| On exhaustion | Routes `salvage` to a recovery node | Throws the last error |
| Best for | LLM/agent nodes whose failure is a flow decision | Transient network/API calls in a tool or adapter |

## Related Concepts

- [Cancellation](./cancellation) - RetryPolicy.run and node deadlines cooperate with context.signal
- [Shared state](./shared-state) - The retry budget lives on NodeStateBase, the conceptual root
- [Runtime](../reference/runtime) - RetryPolicy, BackoffStrategy, and the SchedulerProvider hook
- [Example 07: Retry Flow](../examples/07-retry) - runnable RetryPolicy-with-backoff example
- [Example 22: Retry Timing and Salvage](../examples/22-backoff-strategies)
- [Example 07: Retry Flow](../examples/07-retry)
- [Reference, Runtime, `RetryPolicy`, `BackoffStrategy`](../reference/runtime)
- [Reference, Contracts, `RetryPolicyOptionsType`](../reference/contracts)
- [Guide, Shared state](./shared-state)
