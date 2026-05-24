---
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`ClockProvider`, `SchedulerProvider`, `StateAccessor`, `Instrumentation`'
  - text: 'Reference: Testing'
    link: './testing'
    description: '`VirtualClockProvider`, `VirtualScheduler`'
---

# Runtime

`@noocodex/dagonizer/runtime`

Runtime utilities: monotonic clock, scheduler, retry policy, signal composition, state accessor, and the no-op instrumentation base class. All clock and scheduler primitives are swappable via their provider contracts for deterministic tests.

```ts
import {
  BackoffStrategy,
  Clock,
  DottedPathAccessor,
  NoopInstrumentation,
  RealTimeScheduler,
  RetryPolicy,
  Scheduler,
  SignalComposer,
} from '@noocodex/dagonizer/runtime';
import type {
  BackoffStrategyValue,
  ClockProvider,
  ErrorConstructorType,
  Instrumentation,
  RetryPolicyOptionsInterface,
  SchedulerHandle,
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

## Class: `RealTimeScheduler`

Default `SchedulerProvider`. Wraps `setTimeout` and `setInterval`. Do not instantiate directly; `Scheduler.current()` uses it automatically.

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

Used by the dispatcher for fan-out source reads, fan-in writes, and embedded-DAG state mapping. Swap via `new Dagonizer({ accessor: customAccessor })`.

---

## Class: `NoopInstrumentation`

No-op base class for the `Instrumentation` contract. Plugins extend this and override only the hooks they need; every un-overridden hook stays a no-op.

```ts
class NoopInstrumentation<TState extends NodeStateInterface = NodeStateInterface>
  implements Instrumentation<TState> {
  flowStart(dagName: string, state: TState): void;
  flowEnd(dagName: string, state: TState, result: ExecutionResultInterface<TState>): void;
  nodeStart(dagName: string, nodeName: string, state: TState): void;
  nodeEnd(dagName: string, nodeName: string, output: string | undefined, state: TState): void;
  phaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState): void;
  phaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState): void;
  contractWarning(message: string): void;
  error(dagName: string, nodeName: string, error: Error, state: TState): void;
}
```

The default `Dagonizer.instrumentation` when no instance is passed through the constructor option.

```ts
import { NoopInstrumentation } from '@noocodex/dagonizer/runtime';

class MetricsInstrumentation extends NoopInstrumentation {
  override flowStart(dagName: string, _state: NodeStateInterface): void {
    metrics.counter('dag.flow.start', { dag: dagName }).inc();
  }
  override nodeEnd(_dagName: string, nodeName: string, output: string | undefined, _state: NodeStateInterface): void {
    metrics.counter('dag.node.end', { node: nodeName, output: output ?? 'none' }).inc();
  }
}

const dispatcher = new Dagonizer({ instrumentation: new MetricsInstrumentation() });
```

See [Reference: Contracts](./contracts#instrumentation) for the full `Instrumentation` interface.

---

## Related guides

- [Cancellation](../guide/cancellation)
- [Retry](../guide/retry)
- [State accessors](../guide/state-accessor)
- [Observability](../guide/observability)
