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

`@studnicky/dagonizer/runtime`

Runtime utilities: monotonic clock, scheduler, retry policy, signal composition, and state accessor. All clock and scheduler primitives are swappable via their provider contracts for deterministic tests.

```ts twoslash
import {
  BackoffStrategy,
  Clock,
  DottedPathAccessor,
  RealTimeScheduler,
  RetryPolicy,
  Scheduler,
  SignalComposer,
} from '@studnicky/dagonizer/runtime';
import type {
  ClockProvider,
  ErrorConstructorType,
  RetryPolicyOptionsInterface,
  SchedulerProvider,
  StateAccessor,
} from '@studnicky/dagonizer/runtime';
```

---

## Class: `Clock`

Engine-owned monotonic clock. Static class; never instantiated.

### `Clock.monotonicMs()`

```ts twoslash
import { Clock } from '@studnicky/dagonizer/runtime';
// ---cut---
const ms: number = Clock.monotonicMs();
```

Monotonic time in integer milliseconds. Derived from `performance.now()`, not wall-clock. Used by lifecycle timestamps and `RetryPolicy` delay math.

### `Clock.hrtime()`

```ts twoslash
import { Clock } from '@studnicky/dagonizer/runtime';
// ---cut---
const t: bigint = Clock.hrtime();
```

Raw monotonic high-resolution time in nanoseconds. Available in both Node and browsers. The `Clock` module is the only permitted call site for `performance.now()` in the package.

### `Clock.configure(provider)`

```ts twoslash
import { Clock } from '@studnicky/dagonizer/runtime';
import type { ClockProvider } from '@studnicky/dagonizer/runtime';
// ---cut---
declare const provider: ClockProvider;
Clock.configure(provider);
```

Install a custom clock provider. Use in tests with `VirtualClockProvider` to control timestamps.

### `Clock.reset()`

```ts twoslash
import { Clock } from '@studnicky/dagonizer/runtime';
// ---cut---
Clock.reset();
```

Restore the default real-time clock provider.

---

## Class: `Scheduler`

Engine-owned monotonic timer. Static class; never instantiated.

### `Scheduler.current()`

```ts twoslash
import { Scheduler } from '@studnicky/dagonizer/runtime';
import type { SchedulerProvider } from '@studnicky/dagonizer/runtime';
// ---cut---
const provider: SchedulerProvider = Scheduler.current();
```

Returns the active scheduler. `RetryPolicy` calls `Scheduler.current().after(ms, signal)` for backoff delays.

### `Scheduler.configure(provider)`

```ts twoslash
import { Scheduler } from '@studnicky/dagonizer/runtime';
import type { SchedulerProvider } from '@studnicky/dagonizer/runtime';
// ---cut---
declare const provider: SchedulerProvider;
Scheduler.configure(provider);
```

Install a custom scheduler. Use `VirtualScheduler` in tests to advance time without real waits.

### `Scheduler.reset()`

```ts twoslash
import { Scheduler } from '@studnicky/dagonizer/runtime';
// ---cut---
Scheduler.reset();
```

Restore the default `RealTimeScheduler`.

---

## Class: `RealTimeScheduler`

Default `SchedulerProvider`. Wraps `setTimeout` and `setInterval`. Do not instantiate directly; `Scheduler.current()` uses it automatically.

---

## Class: `RetryPolicy`

```ts twoslash
import { RetryPolicy, BackoffStrategy } from '@studnicky/dagonizer/runtime';
```

Also re-exported from `@studnicky/dagonizer` root.

```ts
<<< @/../examples/dags/07-retry.ts#policy-config
```

See [Retry](/guide/retry) for detailed usage.

### `RetryPolicy.run(task, options?)`

```ts twoslash
import { RetryPolicy, BackoffStrategy } from '@studnicky/dagonizer/runtime';
// ---cut---
const policy = RetryPolicy.from({ maxAttempts: 3, strategy: BackoffStrategy.EXPONENTIAL });
const result = await policy.run(async (attempt: number) => {
  if (attempt < 3) throw new Error('not yet');
  return 'done';
});
```

Runs `task` under the configured policy. Resolves with the function's return value on success, or throws the last error when attempts are exhausted. `options.signal` aborts mid-wait.

### `RetryPolicy.getDelay(attempt, error?)`

```ts twoslash
import { RetryPolicy, BackoffStrategy } from '@studnicky/dagonizer/runtime';
// ---cut---
const policy = RetryPolicy.from({ maxAttempts: 3, strategy: BackoffStrategy.CONSTANT });
const delay: number = policy.getDelay(1);
```

Compute the backoff delay (ms) for a 1-based attempt number. Override in subclasses for custom curves.

### `RetryPolicy.shouldRetry(error, attempt)`

```ts twoslash
import { RetryPolicy, BackoffStrategy } from '@studnicky/dagonizer/runtime';
// ---cut---
const policy = RetryPolicy.from({ maxAttempts: 3, strategy: BackoffStrategy.CONSTANT });
const shouldRetry: boolean = policy.shouldRetry(new Error('oops'), 1);
```

Decision predicate. Override for conditional logic beyond the `retryOn` / `abortOn` lists.

---

## Const: `BackoffStrategy`

```ts twoslash
const BackoffStrategy = {
  CONSTANT:            'constant',
  LINEAR:              'linear',
  EXPONENTIAL:         'exponential',
  DECORRELATED_JITTER: 'decorrelated-jitter',
} as const;

type BackoffStrategy = (typeof BackoffStrategy)[keyof typeof BackoffStrategy];
```

`BackoffStrategy` serves as both the const enum object and the union type of its values. Pass a value as `strategy` in `RetryPolicyOptionsInterface`. See [Retry](/guide/retry) for delay formulas.

---

## Class: `SignalComposer`

Fold `signal` and `deadlineMs` from `ExecuteOptionsInterface` into a single `AbortSignal`. Static class.

### `SignalComposer.compose(options)`

```ts twoslash
import { SignalComposer } from '@studnicky/dagonizer/runtime';
import type { ExecuteOptionsInterface } from '@studnicky/dagonizer/contracts';
// ---cut---
declare const ctrl: AbortController;
declare const url: string;
const signal = SignalComposer.compose({ signal: ctrl.signal, deadlineMs: 5000 });
if (signal !== null) {
  await fetch(url, { signal });
}
```

- Neither field supplied: returns `null`.
- One field supplied: returns that signal directly.
- Both supplied: returns `AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)])`.

`deadlineMs` is wired through `AbortSignal.timeout()`, which surfaces a platform `TimeoutError` as the abort reason. `Dagonizer` inspects that reason to mark the lifecycle `timed_out` rather than `cancelled`.

---

## Class: `DottedPathAccessor`

Default `StateAccessor`. Walks `path.split('.')` to read and write nested fields on a state object. Creates intermediate plain objects on write when they are absent. Treats `null` and `undefined` segments on read as misses (returns `undefined`).

```ts twoslash
import { DottedPathAccessor } from '@studnicky/dagonizer/runtime';
import type { StateAccessor } from '@studnicky/dagonizer/runtime';
// ---cut---
const accessor: StateAccessor = new DottedPathAccessor();
```

Used by the dispatcher for scatter source reads, state-mapping input copies, and gather writes. Swap via `new Dagonizer({ accessor: customAccessor })`.

---

## Related guides

- [Cancellation](../guide/cancellation)
- [Retry](../guide/retry)
- [State accessors](../guide/state-accessor)
- [Observability](../guide/observability)
