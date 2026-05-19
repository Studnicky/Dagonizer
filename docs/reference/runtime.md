---
seeAlso:
  - text: 'Reference: Contracts — `ClockProvider`, `SchedulerProvider`, `StateAccessor`'
    link: './contracts'
  - text: 'Reference: Testing — `VirtualClockProvider`, `VirtualScheduler`'
    link: './testing'
---

# Runtime

`@noocodex/dagonizer/runtime`

The runtime module provides the monotonic clock and scheduler that power `RetryPolicy` delays and lifecycle timestamps. Both are swappable for deterministic tests via their provider interfaces.

---

## Class: `Clock`

Engine-owned monotonic clock. Static class; never instantiated.

```ts
import { Clock } from '@noocodex/dagonizer/runtime';
```

### `Clock.monotonicMs()`

```ts
static monotonicMs(): number
```

Monotonic time in integer milliseconds. Derived from `hrtime()` — not wall-clock. Used by lifecycle timestamps and `RetryPolicy` delay math.

### `Clock.hrtime()`

```ts
static hrtime(): bigint
```

Raw monotonic high-resolution time in nanoseconds. Derived from `performance.now()` (available in both Node and browsers). The `Clock` module is the only permitted call site for `performance.now()` in the package.

### `Clock.configure(provider)`

```ts
static configure(provider: ClockProvider): void
```

Install a custom clock provider. Used in tests — install `VirtualClockProvider` to control timestamps.

### `Clock.reset()`

```ts
static reset(): void
```

Restore the default real-time clock provider.

---

## Interface: `ClockProvider`

Backend for the `Clock` singleton.

```ts
interface ClockProvider {
  hrtime(): bigint;
}
```

---

## Class: `Scheduler`

Engine-owned monotonic timer. Static class; never instantiated.

```ts
import { Scheduler } from '@noocodex/dagonizer/runtime';
```

### `Scheduler.current()`

```ts
static current(): SchedulerHandle
```

Returns the active scheduler handle. `RetryPolicy` calls `Scheduler.current().after(ms, signal)` for backoff delays.

### `Scheduler.configure(provider)`

```ts
static configure(provider: SchedulerProvider): void
```

Install a custom scheduler. Use `VirtualScheduler` in tests to advance time without real waits.

### `Scheduler.reset()`

```ts
static reset(): void
```

Restore the default `RealTimeScheduler`.

---

## Interface: `SchedulerHandle`

Public scheduling surface returned by `Scheduler.current()`.

```ts
interface SchedulerHandle {
  after(delayMs: number, signal?: AbortSignal): Promise<void>;
  at(atMs: number, signal?: AbortSignal): Promise<void>;
  every(intervalMs: number, signal?: AbortSignal): AsyncIterable<void>;
  cancelAll(): void;
}
```

`after(delayMs, signal?)` is the relative-delay form: resolves after `delayMs` ms. `at(atMs, signal?)` resolves at the given monotonic timestamp. `every(intervalMs, signal?)` yields once per interval until the signal fires. `cancelAll()` cancels all in-flight timers.

---

## Interface: `SchedulerProvider`

Low-level backend for `Scheduler`. Same shape as `SchedulerHandle`; implement to supply a custom scheduling backend.

```ts
interface SchedulerProvider {
  after(delayMs: number, signal?: AbortSignal): Promise<void>;
  at(atMs: number, signal?: AbortSignal): Promise<void>;
  every(intervalMs: number, signal?: AbortSignal): AsyncIterable<void>;
  cancelAll(): void;
}
```

---

## Class: `RealTimeScheduler`

Default `SchedulerProvider`. Wraps `setTimeout` / `setInterval`. Do not instantiate directly — `Scheduler.current()` uses it automatically.

---

## Class: `RetryPolicy`

```ts
import { RetryPolicy, BackoffStrategy } from '@noocodex/dagonizer/runtime';
```

Also re-exported from `@noocodex/dagonizer` root.

```ts
const policy = new RetryPolicy({
  maxAttempts: 5,
  strategy: BackoffStrategy.EXPONENTIAL,
  baseDelay: 500,
  maxDelay: 10_000,
  multiplier: 2,
  jitterFactor: 0.1,
  retryOn: [NetworkError],
  abortOn: [AuthError],
});

const result = await policy.run(task, context.signal);
```

See [Retry](/guide/retry) for detailed usage.

### `RetryPolicy.run(task, signal?)`

```ts
async run<T>(task: (attempt: number) => Promise<T> | T, signal?: AbortSignal): Promise<T>
```

Runs `task` under the configured policy. Resolves with the function's return value on success, or throws the last error when attempts are exhausted. `signal` aborts mid-wait.

### `RetryPolicy.getDelay(attempt, error?)`

```ts
getDelay(attempt: number, error?: Error | null): number
```

Compute the backoff delay (ms) for a 1-based attempt number. Override in subclasses for custom curves.

### `RetryPolicy.shouldRetry(error, attempt)`

```ts
shouldRetry(error: Error, attempt: number): boolean
```

Decision predicate. Override for conditional logic beyond the `retryOn` / `abortOn` lists.

---

## Const: `BackoffStrategy`

```ts
const BackoffStrategy = {
  CONSTANT:            'constant',
  LINEAR:              'linear',
  EXPONENTIAL:         'exponential',
  DECORRELATED_JITTER: 'decorrelated-jitter',
} as const;
```

Pass as `strategy` in `RetryPolicyOptionsInterface`. See [Retry](/guide/retry) for delay formulas.
## Related guides

- [Cancellation](../guide/cancellation) — `SignalComposer`
- [Retry](../guide/retry) — `RetryPolicy`, `BackoffStrategy`
- [State accessors](../guide/state-accessor) — `DottedPathAccessor`
