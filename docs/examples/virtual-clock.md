---
title: 'Example: Virtual clock (deterministic retry timing)'
description: 'VirtualClockProvider and VirtualScheduler from @studnicky/dagonizer/testing replace the real wall-clock so retry backoff intervals are driven by programmatic scheduler.advance(ms) calls. Zero elapsed wall-clock time.'
seeAlso:
  - text: 'Example 22: Backoff strategies'
    link: './22-backoff-strategies'
    description: 'RetryPolicy with each BackoffStrategy via VirtualScheduler'
  - text: 'Phase 07: Retry'
    link: './07-retry'
    description: 'retry as a flow shape in the Archivist'
  - text: 'Reference: Runtime'
    link: '../reference/runtime'
    description: 'ClockProvider, Scheduler, RetryPolicy'
  - text: 'Reference: Testing'
    link: '../reference/testing'
    description: 'VirtualClockProvider and VirtualScheduler API'
---

# Example: Virtual clock (deterministic retry timing)

`VirtualClockProvider` and `VirtualScheduler` from `@studnicky/dagonizer/testing` replace the real wall-clock. Retry backoff intervals are driven by programmatic `scheduler.advance(ms)` calls rather than actual waits, making retry behavior testable in zero elapsed wall-clock time.

The example uses a flaky operation that fails on the first two attempts and succeeds on the third. Exponential backoff delays are 100ms → 200ms (300ms total virtual time). Both `ClockProvider` and `Scheduler` are restored to real time after the demonstration.

```
Attempt 1: fails → backoff 100ms virtual
Attempt 2: fails → backoff 200ms virtual
Attempt 3: succeeds
Total virtual time: 300ms. Real wall-clock time: ~0ms.
```

## Code

<<< @/../examples/virtual-clock.ts

## What it demonstrates

- **`VirtualClockProvider`.** Implements `ClockProvider` with a programmatic `now()` that advances by explicit `tick(ms)` calls. Install via `Clock.install(provider)` before constructing the dispatcher.
- **`VirtualScheduler`.** Implements `Scheduler` with a pending-timer queue. Install via `Scheduler.install(scheduler)`. Call `scheduler.advance(ms)` to drain all timers whose deadline falls within the advanced time. No real `setTimeout` calls are made.
- **`demonstrateVirtualClock()`.** Fully self-contained: installs providers, runs the retry sequence, advances virtual time, verifies the result, and restores real-time providers. No global state leaks.
- **Use in tests.** Replace real providers in any test that exercises retry or timeout behavior. The pattern scales to `concurrency > 1` scatter runs where each clone's retry policy is driven by the same virtual scheduler.
- **Restore real providers.** Always call `Clock.restore()` and `Scheduler.restore()` after a virtual-clock test to avoid contaminating the real scheduler in subsequent test cases.

## Run

```bash
npx tsx examples/virtual-clock.ts
```
