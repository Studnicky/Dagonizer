---
seeAlso:
  - text: 'Reference: Runtime'
    link: './runtime'
    description: '`Clock`, `Scheduler`'
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`ClockProviderInterface`, `SchedulerProviderInterface`'
---

# Testing

`@studnicky/dagonizer/testing`

The testing subpath exports two deterministic replacements for the real-time clock and scheduler. Install them before each test; reset them after.

---

## Class: `VirtualClockProvider`

In-memory monotonic clock. Time advances only when you advance it.

```ts twoslash
import { VirtualClockProvider } from '@studnicky/dagonizer/testing';
import { Clock } from '@studnicky/dagonizer/runtime';
```

### Constructor

```ts twoslash
import { VirtualClockProvider } from '@studnicky/dagonizer/testing';
// ---cut---
new VirtualClockProvider(0n);
```

`initialNs` is the starting nanosecond value. Defaults to `0n`.

### `.tickMs(deltaMs)`

```ts twoslash
import { VirtualClockProvider } from '@studnicky/dagonizer/testing';
const clock = new VirtualClockProvider(0n);
// ---cut---
clock.tickMs(100);
```

Advance the virtual clock by `deltaMs` milliseconds.

### `.tickNs(deltaNs)`

```ts twoslash
import { VirtualClockProvider } from '@studnicky/dagonizer/testing';
const clock = new VirtualClockProvider(0n);
// ---cut---
clock.tickNs(100_000_000n);
```

Advance the virtual clock by `deltaNs` nanoseconds.

The clock only moves forward — `tickNs`/`tickMs` are relative advances, there is no method to set an absolute value after construction. To start the clock at a specific nanosecond value, pass it to the constructor:

```ts twoslash
import { VirtualClockProvider } from '@studnicky/dagonizer/testing';
// ---cut---
const clock = new VirtualClockProvider(500_000_000n);
```

### Usage

```ts
<<< @/../examples/dags/virtual-clock.ts#virtual-time
```

---

## Class: `VirtualScheduler`

In-memory min-heap scheduler. No platform timers. Advance time via `advance(ms)`, `runUntil(atMs)`, or `runAll()`.

```ts twoslash
import { VirtualScheduler } from '@studnicky/dagonizer/testing';
import { Scheduler } from '@studnicky/dagonizer/runtime';
```

### Constructor

```ts twoslash
import { VirtualScheduler } from '@studnicky/dagonizer/testing';
// ---cut---
new VirtualScheduler(0);
```

`initialAtMs` is the starting virtual-now value. Defaults to `0`.

### `.advance(deltaMs)`

```ts twoslash
import { VirtualScheduler } from '@studnicky/dagonizer/testing';
const scheduler = new VirtualScheduler(0);
// ---cut---
scheduler.advance(500);
```

Advance virtual time by `deltaMs`, firing all tasks scheduled in that window in order.

### `.runUntil(atMs)`

```ts twoslash
import { VirtualScheduler } from '@studnicky/dagonizer/testing';
const scheduler = new VirtualScheduler(0);
// ---cut---
scheduler.runUntil(1000);
```

Advance virtual time to `atMs`, firing tasks in order.

### `.runAll()`

```ts twoslash
import { VirtualScheduler } from '@studnicky/dagonizer/testing';
const scheduler = new VirtualScheduler(0);
// ---cut---
scheduler.runAll();
```

Fire all pending one-shot tasks in monotonic order.

### `.virtualNow`

```ts twoslash
import { VirtualScheduler } from '@studnicky/dagonizer/testing';
const scheduler = new VirtualScheduler(0);
// ---cut---
const now: number = scheduler.virtualNow;
```

Current virtual time in ms.

### `.pendingCount`

```ts twoslash
import { VirtualScheduler } from '@studnicky/dagonizer/testing';
const scheduler = new VirtualScheduler(0);
// ---cut---
const count: number = scheduler.pendingCount;
```

Number of active (non-cancelled) pending tasks.

### Usage with `RetryPolicy`

```ts
<<< @/../examples/dags/virtual-clock.ts#virtual-time
```

### `SchedulerProviderInterface` interface

Both `VirtualScheduler` and `RealTimeScheduler` implement `SchedulerProviderInterface`:

```ts twoslash
import type { SchedulerProviderInterface } from '@studnicky/dagonizer/runtime';
// ---cut---
// SchedulerProviderInterface (from @studnicky/dagonizer/runtime):
//   after(delayMs, options?: { signal? }): Promise<void>
//   at(atMs, options?: { signal? }): Promise<void>
//   every(intervalMs, options?: { signal? }): AsyncIterable<void>
//   cancelAll(): void
const _scheduler: SchedulerProviderInterface = {} as SchedulerProviderInterface;
```

Implement this interface to create a custom test scheduler (e.g. one that records fired tasks for assertions).
## Related guides

- [Cancellation](../guide/cancellation)
- [Retry](../guide/retry)
