---
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`ClockProvider`, `SchedulerProvider`, `StateAccessor`'
  - text: 'Reference: Testing'
    link: './testing'
    description: '`VirtualClockProvider`, `VirtualScheduler`'
---

# Runtime

`@noocodex/dagonizer/runtime`

Runtime utilities: monotonic clock, scheduler, retry policy, signal composition, and state accessor. All clock and scheduler primitives are swappable via their provider contracts for deterministic tests.

```ts
import {
  BackoffStrategy,
  Clock,
  DottedPathAccessor,
  RealTimeScheduler,
  RetryPolicy,
  Scheduler,
  SignalComposer,
} from '@noocodex/dagonizer/runtime';
import type {
  BackoffStrategyValue,
  ClockProvider,
  ErrorConstructorType,
  RetryPolicyOptionsInterface,
  SchedulerProvider,
  StateAccessor,
} from '@noocodex/dagonizer/runtime';
```

---

## Class: `Clock`

Engine-owned monotonic clock. Static class; never instantiated.

### `Clock.monotonicMs()`

```ts
static monotonicMs(): number
```

Monotonic time in integer milliseconds. Derived from `performance.now()`, not wall-clock. Used by lifecycle timestamps and `RetryPolicy` delay math.

### `Clock.hrtime()`

```ts
static hrtime(): bigint
```

Raw monotonic high-resolution time in nanoseconds. Available in both Node and browsers. The `Clock` module is the only permitted call site for `performance.now()` in the package.

### `Clock.configure(provider)`

```ts
static configure(provider: ClockProvider): void
```

Install a custom clock provider. Use in tests with `VirtualClockProvider` to control timestamps.

### `Clock.reset()`

```ts
static reset(): void
```

Restore the default real-time clock provider.

---

## Class: `Scheduler`

Engine-owned monotonic timer. Static class; never instantiated.

### `Scheduler.current()`

```ts
static current(): SchedulerProvider
```

Returns the active scheduler. `RetryPolicy` calls `Scheduler.current().after(ms, signal)` for backoff delays.

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

## Class: `RealTimeScheduler`

Default `SchedulerProvider`. Wraps `setTimeout` and `setInterval`. Do not instantiate directly; `Scheduler.current()` uses it automatically.

---

## Class: `RetryPolicy`

```ts
import { RetryPolicy, BackoffStrategy } from '@noocodex/dagonizer/runtime';
```

Also re-exported from `@noocodex/dagonizer` root.

```ts
<<< @/../examples/dags/07-retry.ts#policy-config
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

type BackoffStrategyValue = (typeof BackoffStrategy)[keyof typeof BackoffStrategy];
```

Pass as `strategy` in `RetryPolicyOptionsInterface`. See [Retry](/guide/retry) for delay formulas.

---

## Class: `SignalComposer`

Fold `signal` and `deadlineMs` from `ExecuteOptionsInterface` into a single `AbortSignal`. Static class.

### `SignalComposer.compose(options)`

```ts
static compose(options: ExecuteOptionsInterface): AbortSignal | null
```

- Neither field supplied: returns `null`.
- One field supplied: returns that signal directly.
- Both supplied: returns `AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)])`.

`deadlineMs` is wired through `AbortSignal.timeout()`, which surfaces a platform `TimeoutError` as the abort reason. `Dagonizer` inspects that reason to mark the lifecycle `timed_out` rather than `cancelled`.

```ts
import { SignalComposer } from '@noocodex/dagonizer/runtime';

const signal = SignalComposer.compose({ signal: ctrl.signal, deadlineMs: 5000 });
if (signal !== null) {
  await fetch(url, { signal });
}
```

---

## Class: `DottedPathAccessor`

Default `StateAccessor`. Walks `path.split('.')` to read and write nested fields on a state object. Creates intermediate plain objects on write when they are absent. Treats `null` and `undefined` segments on read as misses (returns `undefined`).

```ts
class DottedPathAccessor implements StateAccessor {
  get(state: object, path: string): unknown;
  set(state: object, path: string, value: unknown): void;
}
```

Used by the dispatcher for scatter source reads, state-mapping input copies, and gather writes. Swap via `new Dagonizer({ accessor: customAccessor })`.

---

## Related guides

- [Cancellation](../guide/cancellation)
- [Retry](../guide/retry)
- [State accessors](../guide/state-accessor)
- [Observability](../guide/observability)
