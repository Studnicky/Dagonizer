---
title: 'Retry'
description: 'RetryPolicy retries a thunk on declared error classes with a configurable backoff strategy. The signal argument cooperates with the dispatcher AbortSignal, so a cancelled flow stops cleanly mid-retry.'
seeAlso:
  - text: 'Cancellation'
    link: './cancellation'
    description: 'RetryPolicy.run cooperates with context.signal'
  - text: 'Observability'
    link: './observability'
    description: 'onError fires when maxAttempts is exceeded'
  - text: 'Runtime'
    link: '../reference/runtime'
    description: 'RetryPolicy, BackoffStrategy, and the SchedulerProvider hook'
nextSteps:
  - text: 'Phase 07, Retry demo'
    link: '../examples/07-retry'
    description: 'runnable retry-with-backoff example'
---

# Retry

`RetryPolicy` retries a thunk on declared error classes with a configurable backoff strategy. `policy.run(task, signal)` cooperates with the dispatcher's `AbortSignal`, so a cancelled flow stops cleanly mid-retry. The Phase 07 demo wires it inside a node `execute()` body.

## Basic usage

The policy is constructed inside the node so the configuration lives next to the operation it guards. `jitterFactor: 0` keeps the delay deterministic for the example:

<<< @/../examples/07-retry.ts#policy-config

The full node, including the `policy.run` call site that propagates `context.signal`:

<<< @/../examples/07-retry.ts#retry-node

Runtime wiring is the standard `registerNode` plus `registerDAG` pair:

<<< @/../examples/07-retry.ts#runtime

## Real-world usage in the Archivist

The Archivist demo wraps two LLM-backed operations in `RetryPolicy` instances. The five scout nodes share one policy that retries on the wrapper-level abort for two attempts:

<<< @/../examples/the-archivist/nodes/scouts.ts#scout-retry

The ranker uses a similar policy for transient ranking failures:

<<< @/../examples/the-archivist/nodes/rankCandidates.ts#rank-retry

Both policies are module-scoped so each node body calls `policy.run(...)` without constructing a fresh instance per invocation.

## `BackoffStrategy`

| Value | Delay formula |
|---|---|
| `CONSTANT` | `baseDelay` (each attempt identical) |
| `LINEAR` | `baseDelay × attempt` |
| `EXPONENTIAL` | `baseDelay × multiplier^(attempt-1)` (default) |
| `DECORRELATED_JITTER` | Random in `[baseDelay, baseDelay × 3]` |

All strategies apply `jitterFactor` (default `0.1`, plus or minus 10%) to spread retry traffic, except `DECORRELATED_JITTER` which is already random. The final delay is capped at `maxDelay` (default 30 s).

## Error filtering

```ts
class NetworkError extends Error {}
class AuthError extends Error {}

const policy = new RetryPolicy({
  maxAttempts: 5,
  strategy: BackoffStrategy.EXPONENTIAL,
  retryOn: [NetworkError],    // only retry these
  abortOn: [AuthError],       // never retry these
});
```

Precedence:

1. If `attempt >= maxAttempts`, do not retry.
2. If `abortOn` is set and the error matches, do not retry.
3. If `retryOn` is set and the error does not match, do not retry.
4. Otherwise, retry.

## Abort cooperation

`policy.run(task, context.signal)` checks the signal before each attempt. During a backoff wait, if the signal fires the wait resolves with the abort reason (thrown). A cancelled flow stops cleanly mid-retry:

```ts
const policy = new RetryPolicy({ maxAttempts: 10, baseDelay: 1000 });
// If context.signal aborts during a 1 s sleep, run() throws immediately.
await policy.run(task, context.signal);
```

## Custom backoff

Subclass `RetryPolicy` and override `getDelay` for non-standard curves:

```ts
class FibonacciRetry extends RetryPolicy {
  override getDelay(attempt: number): number {
    const fib = (n: number): number => n <= 1 ? n : fib(n - 1) + fib(n - 2);
    return Math.min(fib(attempt) * 100, this.maxDelay);
  }
}
```

Override `shouldRetry` to express conditional logic without modifying the constructor options.

## Deterministic testing

Install `VirtualScheduler` before the test so retry sleeps do not block:

```ts
import { VirtualScheduler, VirtualClockProvider } from '@noocodex/dagonizer/testing';
import { Scheduler, Clock } from '@noocodex/dagonizer/runtime';

const clock = new VirtualClockProvider(0n);
const scheduler = new VirtualScheduler();
Clock.configure(clock);
Scheduler.configure(scheduler);

// ... run policy ...
scheduler.advance(5_000); // step through delays
// ... assert ...

Clock.reset();
Scheduler.reset();
```

See [Testing](../reference/testing) for the full `VirtualScheduler` and `VirtualClockProvider` API.

## Related reference

- [Phase 07, Retry demo](../examples/07-retry)
- [Reference, Runtime, `RetryPolicy`, `BackoffStrategy`](../reference/runtime)
- [Reference, Contracts, `RetryPolicyOptionsInterface`](../reference/contracts)
