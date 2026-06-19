---
title: 'Example 22: Backoff strategies'
description: 'RetryPolicy with each BackoffStrategy (constant, linear, exponential, decorrelated-jitter), driven by VirtualScheduler for deterministic instant execution. Each strategy run records the computed delay sequence.'
seeAlso:
  - text: 'Phase 07: Retry'
    link: './07-retry'
    description: 'retry as a flow shape in the Archivist'
  - text: 'Example: Virtual clock'
    link: './virtual-clock'
    description: 'VirtualClockProvider + VirtualScheduler for deterministic time'
  - text: 'Reference: Runtime'
    link: '../reference/runtime'
    description: 'RetryPolicy, BackoffStrategy, Scheduler'
---

# Example 22: Backoff strategies

`RetryPolicy` accepts one of four `BackoffStrategy` values. Each strategy produces a different delay sequence between retry attempts:

| Strategy | Delay sequence |
|----------|----------------|
| `CONSTANT` | Fixed delay between every retry |
| `LINEAR` | Delay grows linearly with attempt number |
| `EXPONENTIAL` | Delay grows by `multiplier^(attempt-1)` (default) |
| `DECORRELATED_JITTER` | Random delay in `[baseDelay, baseDelay × 3]` |

Each strategy run uses `VirtualScheduler` (from `@studnicky/dagonizer/testing`) so retries complete in zero real wall-clock time. Virtual time is advanced programmatically. A `RecordingPolicy` subclass intercepts `getDelay()` to capture the computed delay before forwarding to the scheduler.

## Code

<<< @/../examples/22-backoff-strategies.ts

## What it demonstrates

- **`BackoffStrategyNames` enum.** Import from `@studnicky/dagonizer`. Pass to `RetryPolicy.from({ strategy: BackoffStrategyNames.EXPONENTIAL, ... })`.
- **`RetryPolicy.from(options)`.** Factory that builds a `RetryPolicy` from a plain options object. `jitterFactor: 0` makes the delay sequence exact and predictable for testing.
- **`VirtualScheduler`.** Import from `@studnicky/dagonizer/testing`. Replace the real scheduler at dispatcher construction time; call `scheduler.advance(ms)` to drain pending timers without real waits. See [Example: Virtual clock](./virtual-clock) for the full setup.
- **`RecordingPolicy`.** A `RetryPolicy` subclass that overrides `getDelay()` to capture the sequence. Real retries sleep these durations; the virtual scheduler drains them instantly.
- **`DECORRELATED_JITTER`.** Produces a random delay in `[baseDelay, baseDelay × 3]` per attempt. Use `jitterFactor: 0` with other strategies to get deterministic sequences; jitter by definition produces non-deterministic delays so capture the actual values rather than asserting exact sequences.

## Run

```bash
npx tsx examples/22-backoff-strategies.ts
```
