---
seeAlso:

  - text: 'Cancellation'

    link: './cancellation'
    description: '`RetryPolicy.run` cooperates with `context.signal`'

  - text: 'Observability'

    link: './observability'
    description: '`onError` fires when `maxAttempts` is exceeded'
---

# Retry

`RetryPolicy` is a configurable retry-with-backoff class that integrates with the dispatcher's `AbortSignal`.

## Basic usage

```ts
import { RetryPolicy, BackoffStrategy, NodeStateBase } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer';

class S extends NodeStateBase {
  result = '';
}

const fetchNode: NodeInterface<S, 'success' | 'error'> = {
  name: 'fetch',
  outputs: ['success', 'error'],
  async execute(state, context) {
    const policy = new RetryPolicy({
      maxAttempts: 4,
      strategy: BackoffStrategy.EXPONENTIAL,
      baseDelay: 200,
    });
    try {
      state.result = await policy.run(
        () => callRemote(),
        context.signal,
      );
      return { output: 'success' };
    } catch {
      return { output: 'error' };
    }
  },
};
```

## `BackoffStrategy`

| Value | Delay formula |
|-------|--------------|
| `CONSTANT` | `baseDelay` (each attempt identical) |
| `LINEAR` | `baseDelay × attempt` |
| `EXPONENTIAL` | `baseDelay × multiplier^(attempt-1)` (default) |
| `DECORRELATED_JITTER` | Random in `[baseDelay, baseDelay × 3]` |

All strategies apply `jitterFactor` (default `0.1` = ±10%) to spread retry traffic, except `DECORRELATED_JITTER` which is already random. The final delay is capped at `maxDelay` (default 30 s).

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
1. If `attempt >= maxAttempts` → do not retry.
2. If `abortOn` is set and error matches → do not retry.
3. If `retryOn` is set and error does not match → do not retry.
4. Otherwise → retry.

## Abort cooperation

`policy.run(task, context.signal)` checks the signal before each attempt. During a backoff wait, the signal fires early and the wait resolves with the abort reason (thrown). This means a cancelled flow stops cleanly even mid-retry.

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

Override `shouldRetry` to express complex conditional logic without modifying the constructor options.

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

See [Testing](/reference/testing) for the full `VirtualScheduler` and `VirtualClockProvider` API.
## Related reference

- [Reference: Runtime — `RetryPolicy`, `BackoffStrategy`](../reference/runtime)
- [Reference: Contracts — `RetryPolicyOptionsInterface`](../reference/contracts)
- [Example: Retry](../examples/07-retry)
