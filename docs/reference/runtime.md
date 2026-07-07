---
title: 'Runtime'
description: 'Runtime utility reference for Clock, Scheduler, RealTimeScheduler, RetryPolicy, backoff strategies, Signal composition, and DottedPathAccessor.'
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`ClockProviderInterface`, `SchedulerProviderInterface`, `StateAccessorInterface`'
  - text: 'Reference: Testing'
    link: './testing'
    description: '`VirtualClockProvider`, `VirtualScheduler`'
---

# Runtime

## What It Is

The runtime surface contains the small utilities Dagonizer uses while executing a DAG: monotonic time, scheduling, retry policy, backoff strategies, abort/deadline composition, and dotted-path state access.

Use this page when swapping deterministic test providers, applying retry/backoff around one operation, composing cancellation signals, or customizing how scatter/state-mapping paths read and write state.

## How It Works

Runtime utilities are deliberately injectable. `Clock` and `Scheduler` delegate to provider interfaces. `DottedPathAccessor` implements the default `StateAccessorInterface`. `RetryPolicy` wraps transient operations without changing DAG topology.

That means tests can pin time, production can use real time, and application code can keep provider/network resilience separate from reviewer-visible DAG control flow.

## Diagrams, Examples, and Outputs

Runtime primitives are not graph placements, but they affect how graph execution behaves. These pages show the same contracts in tests and runtime wiring:

- [Reference: Contracts](./contracts) - `ClockProviderInterface`, `SchedulerProviderInterface`, `StateAccessorInterface`
- [Reference: Testing](./testing) - `VirtualClockProvider`, `VirtualScheduler`

## What It Lets You Do

The runtime reference lets applications swap timing, scheduling, retry, signal, and state-access behavior at execution boundaries.

`@studnicky/dagonizer/runtime`

Runtime utilities: monotonic clock, scheduler, retry policy, signal composition, and state accessor. All clock and scheduler primitives are swappable via their provider contracts for deterministic tests.

## Code Samples

The code below covers clock providers, scheduler providers, retry policy, backoff names, signal composition, and the default dotted-path accessor.

### Import

```ts twoslash
import {
  Clock,
  DottedPathAccessor,
  RealTimeScheduler,
  RetryPolicy,
  Scheduler,
} from '@studnicky/dagonizer/runtime';
import type {
  ClockProviderInterface,
  ErrorConstructorType,
  RetryPolicyOptionsType,
  SchedulerProviderInterface,
  StateAccessorInterface,
} from '@studnicky/dagonizer/runtime';
import { Signal } from '@studnicky/signal';
```

---

### Class: `Clock`

Engine-owned monotonic clock. Static class; never instantiated.

#### `Clock.monotonicMs()`

```ts twoslash
import { Clock } from '@studnicky/dagonizer/runtime';
// ---cut---
const ms: number = Clock.monotonicMs();
```

Monotonic time in integer milliseconds. Derived from `performance.now()`, not wall-clock. Used by lifecycle timestamps and `RetryPolicy` delay math.

#### `Clock.hrtime()`

```ts twoslash
import { Clock } from '@studnicky/dagonizer/runtime';
// ---cut---
const t: bigint = Clock.hrtime();
```

Raw monotonic high-resolution time in nanoseconds. Available in both Node and browsers. The `Clock` module is the only permitted call site for `performance.now()` in the package.

#### `Clock.configure(provider)`

```ts twoslash
import { Clock } from '@studnicky/dagonizer/runtime';
import type { ClockProviderInterface } from '@studnicky/dagonizer/runtime';
// ---cut---
declare const provider: ClockProviderInterface;
Clock.configure(provider);
```

Install a custom clock provider. Use in tests with `VirtualClockProvider` to control timestamps.

#### `Clock.reset()`

```ts twoslash
import { Clock } from '@studnicky/dagonizer/runtime';
// ---cut---
Clock.reset();
```

Restore the default real-time clock provider.

---

### Class: `Scheduler`

Engine-owned monotonic timer. Static class; never instantiated.

#### `Scheduler.current()`

```ts twoslash
import { Scheduler } from '@studnicky/dagonizer/runtime';
import type { SchedulerProviderInterface } from '@studnicky/dagonizer/runtime';
// ---cut---
const provider: SchedulerProviderInterface = Scheduler.current();
```

Returns the active scheduler. `RetryPolicy` calls `Scheduler.current().after(ms, signal)` for backoff delays.

#### `Scheduler.configure(provider)`

```ts twoslash
import { Scheduler } from '@studnicky/dagonizer/runtime';
import type { SchedulerProviderInterface } from '@studnicky/dagonizer/runtime';
// ---cut---
declare const provider: SchedulerProviderInterface;
Scheduler.configure(provider);
```

Install a custom scheduler. Use `VirtualScheduler` in tests to advance time without real waits.

#### `Scheduler.reset()`

```ts twoslash
import { Scheduler } from '@studnicky/dagonizer/runtime';
// ---cut---
Scheduler.reset();
```

Restore the default `RealTimeScheduler`.

---

### Class: `RealTimeScheduler`

Default `SchedulerProviderInterface`. Wraps `setTimeout` and `setInterval`. Do not instantiate directly; `Scheduler.current()` uses it automatically.

---

### Class: `RetryPolicy`

```ts twoslash
import { RetryPolicy } from '@studnicky/dagonizer/runtime';
import { BackoffStrategyNames } from '@studnicky/dagonizer';
```

Also re-exported from `@studnicky/dagonizer` root.

```ts
<<< @/../examples/dags/07-retry.ts#policy-config
```

See [Retry](/guide/retry) for detailed usage.

#### `RetryPolicy.run(task, options?)`

```ts twoslash
import { RetryPolicy } from '@studnicky/dagonizer/runtime';
import { BackoffStrategyNames } from '@studnicky/dagonizer';
// ---cut---
const policy = RetryPolicy.from({ maxAttempts: 3, strategy: BackoffStrategyNames.EXPONENTIAL });
const result = await policy.run(async (attempt: number) => {
  if (attempt < 3) throw new Error('not yet');
  return 'done';
});
```

Runs `task` under the configured policy. Resolves with the function's return value on success, or throws the last error when attempts are exhausted. `options.signal` aborts mid-wait.

#### `RetryPolicy.getDelay(attempt, error?)`

```ts twoslash
import { RetryPolicy } from '@studnicky/dagonizer/runtime';
import { BackoffStrategyNames } from '@studnicky/dagonizer';
// ---cut---
const policy = RetryPolicy.from({ maxAttempts: 3, strategy: BackoffStrategyNames.CONSTANT });
const delay: number = policy.getDelay(1);
```

Compute the backoff delay (ms) for a 1-based attempt number. Override in subclasses for custom curves.

#### `RetryPolicy.shouldRetry(error, attempt)`

```ts twoslash
import { RetryPolicy } from '@studnicky/dagonizer/runtime';
import { BackoffStrategyNames } from '@studnicky/dagonizer';
// ---cut---
const policy = RetryPolicy.from({ maxAttempts: 3, strategy: BackoffStrategyNames.CONSTANT });
const shouldRetry: boolean = policy.shouldRetry(new Error('oops'), 1);
```

Decision predicate. Order: `abortOn` match stops retrying; `retryOn` (when set) must match to retry; with no `retryOn` filter, a `DAGError` falls back to its own `error.retryable` field; otherwise retry. See [Guide: Retry — Error filtering](../guide/retry#error-filtering) for the full precedence and [Composing with adapter resilience](../guide/retry#composing-with-adapter-resilience) for `abortOn: [CircuitBreakerOpenError, TokenBucketExhaustedError]` guidance. Override `shouldRetry` for conditional logic beyond `retryOn` / `abortOn`.

---

### Const: `BackoffStrategyNames` and type `BackoffStrategy`

```ts twoslash
const BackoffStrategyNames = {
  CONSTANT:            'constant',
  LINEAR:              'linear',
  EXPONENTIAL:         'exponential',
  DECORRELATED_JITTER: 'decorrelated-jitter',
} as const;

type BackoffStrategy = (typeof BackoffStrategyNames)[keyof typeof BackoffStrategyNames];
```

`BackoffStrategyNames` is the frozen lookup object; `BackoffStrategy` is the union type of its values. Both ship from `@studnicky/dagonizer` (and `@studnicky/dagonizer/entities`). Pass a value as `strategy` in `RetryPolicyOptionsType`. See [Retry](/guide/retry) for delay formulas.

---

### Class: `Signal` (`@studnicky/signal`)

Fold `signal` and `deadlineMs` from `ExecuteOptionsType` into a single `AbortSignal`. Static class, imported from the `@studnicky/signal` package (a dependency of `@studnicky/dagonizer`, not re-exported from `./runtime`).

#### `Signal.compose(options)`

```ts twoslash
import type { ExecuteOptionsType } from '@studnicky/dagonizer/contracts';
import { Signal } from '@studnicky/signal';
// ---cut---
declare const ctrl: AbortController;
declare const url: string;
const signal = Signal.compose({ signal: ctrl.signal, deadlineMs: 5000 });
await fetch(url, { signal });
```

- Neither field supplied: returns `Signal.never()` (a never-aborting sentinel — always a valid `AbortSignal`, never `null`).
- One field supplied: returns that signal directly.
- Both supplied: returns a composed signal that aborts when either the caller signal or deadline fires.

`deadlineMs` is wired through `AbortSignal.timeout()`, which surfaces a platform `TimeoutError` as the abort reason. `Dagonizer` inspects that reason to mark the lifecycle `timed_out` rather than `cancelled`. A negative or `NaN` `deadlineMs` throws `SignalError`.

#### `Signal.never()`

Returns a cached, never-aborting `AbortSignal`. Used throughout the engine wherever a run has no caller-supplied cancellation surface, so every node context carries a valid signal — never `null`.

---

### Class: `DottedPathAccessor`

Default `StateAccessorInterface`. Walks `path.split('.')` to read and write nested fields on a state object. Creates intermediate plain objects on write when they are absent. Treats `null` and `undefined` segments on read as misses (returns `undefined`).

```ts twoslash
import { DottedPathAccessor } from '@studnicky/dagonizer/runtime';
import type { StateAccessorInterface } from '@studnicky/dagonizer/runtime';
// ---cut---
const accessor: StateAccessorInterface = new DottedPathAccessor();
```

Used by the dispatcher for scatter source reads, state-mapping input copies, and gather writes. Swap via `new Dagonizer({ accessor: customAccessor })`.

---

## Details for Nerds

`RetryPolicy` is for one transient operation, not for visible DAG control flow. If retry is part of the business process, model it as DAG routing. If retry is provider/network resilience around one call, keep it in runtime policy.

`DottedPathAccessor` is the default path resolver for scatter source reads, gather writes, and embedded-DAG state mappings. Swap it only when an application state model needs different path semantics.

## Related Concepts

- [Reference: Contracts](./contracts) - `ClockProviderInterface`, `SchedulerProviderInterface`, `StateAccessorInterface`
- [Reference: Testing](./testing) - `VirtualClockProvider`, `VirtualScheduler`
- [Cancellation](../guide/cancellation) - abort signals and deadline propagation
- [Retry](../guide/retry) - choosing DAG-visible retry versus operation retry
- [State Accessors](../guide/state-accessor) - custom path resolver guidance
- [Observability](../guide/observability) - timing and lifecycle event projection
