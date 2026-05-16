# Testing

`@noocodex/dagonizer/testing`

The testing subpath exports two deterministic replacements for the real-time clock and scheduler. Install them before each test; reset them after.

---

## Class: `VirtualClockProvider`

In-memory monotonic clock. Time advances only when you advance it.

```ts
import { VirtualClockProvider } from '@noocodex/dagonizer/testing';
import { Clock } from '@noocodex/dagonizer/runtime';
```

### Constructor

```ts
new VirtualClockProvider(initialNs?: bigint)
```

`initialNs` is the starting nanosecond value. Defaults to `0n`.

### `.tickMs(deltaMs)`

```ts
tickMs(deltaMs: number): void
```

Advance the virtual clock by `deltaMs` milliseconds.

### `.tickNs(deltaNs)`

```ts
tickNs(deltaNs: bigint): void
```

Advance the virtual clock by `deltaNs` nanoseconds.

### `.setNs(ns)`

```ts
setNs(ns: bigint): void
```

Set the virtual clock to an absolute nanosecond value.

### Usage

```ts
import { VirtualClockProvider } from '@noocodex/dagonizer/testing';
import { Clock } from '@noocodex/dagonizer/runtime';
import { after, before, describe, it } from 'node:test';

describe('lifecycle timestamps', () => {
  const clock = new VirtualClockProvider(0n);

  before(() => Clock.configure(clock));
  after(() => Clock.reset());

  it('records duration correctly', async () => {
    const state = new MyState();
    state.markRunning();
    clock.tickMs(100);
    state.markCompleted();
    const lc = state.lifecycle;
    assert.strictEqual(lc.kind, 'completed');
    assert.strictEqual(lc.finishedAt - lc.startedAt, 100);
  });
});
```

---

## Class: `VirtualScheduler`

In-memory min-heap scheduler. No platform timers. Advance time via `advance(ms)`, `runUntil(atMs)`, or `runAll()`.

```ts
import { VirtualScheduler } from '@noocodex/dagonizer/testing';
import { Scheduler } from '@noocodex/dagonizer/runtime';
```

### Constructor

```ts
new VirtualScheduler(initialAtMs?: number)
```

`initialAtMs` is the starting virtual-now value. Defaults to `0`.

### `.advance(deltaMs)`

```ts
advance(deltaMs: number): void
```

Advance virtual time by `deltaMs`, firing all tasks scheduled in that window in order.

### `.runUntil(atMs)`

```ts
runUntil(atMs: number): void
```

Advance virtual time to `atMs`, firing tasks in order.

### `.runAll()`

```ts
runAll(): void
```

Fire all pending one-shot tasks in monotonic order.

### `.virtualNow`

```ts
get virtualNow(): number
```

Current virtual time in ms.

### `.pendingCount`

```ts
get pendingCount(): number
```

Number of active (non-cancelled) pending tasks.

### Usage with `RetryPolicy`

```ts
import { VirtualScheduler } from '@noocodex/dagonizer/testing';
import { VirtualClockProvider } from '@noocodex/dagonizer/testing';
import { Scheduler, Clock, RetryPolicy, BackoffStrategy } from '@noocodex/dagonizer/runtime';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

describe('RetryPolicy', () => {
  const clock = new VirtualClockProvider(0n);
  const scheduler = new VirtualScheduler(0);

  before(() => {
    Clock.configure(clock);
    Scheduler.configure(scheduler);
  });
  after(() => {
    Clock.reset();
    Scheduler.reset();
  });

  it('retries with exponential backoff', async () => {
    let attempts = 0;
    const policy = new RetryPolicy({
      maxAttempts: 3,
      strategy: BackoffStrategy.EXPONENTIAL,
      baseDelay: 1000,
      jitterFactor: 0,
    });

    const promise = policy.run(async () => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return 'ok';
    });

    // Step through retry delays
    scheduler.advance(1000); // attempt 1 → sleep 1000ms
    scheduler.advance(2000); // attempt 2 → sleep 2000ms

    const result = await promise;
    assert.strictEqual(result, 'ok');
    assert.strictEqual(attempts, 3);
  });
});
```

### `SchedulerProvider` interface

Both `VirtualScheduler` and `RealTimeScheduler` implement `SchedulerProvider`:

```ts
interface SchedulerProvider {
  scheduleAt(atMs: number, fire: () => void | Promise<void>): ScheduledTask;
  scheduleEvery(intervalMs: number, fire: () => void | Promise<void>): ScheduledTask;
  cancelAll(): void;
}
```

Implement this interface to create a custom test scheduler (e.g. one that records fired tasks for assertions).

## See also

- [Reference: Runtime — `Clock`, `Scheduler`](./runtime)
- [Reference: Contracts — `ClockProvider`, `SchedulerProvider`](./contracts)

## Related guides

- [Cancellation](../guide/cancellation)
- [Retry](../guide/retry)
