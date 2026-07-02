---
'@studnicky/dagonizer': major
---

`Clock`, `RealTimeScheduler`, and `RetryPolicy` now build on `@studnicky/clock`, `@studnicky/scheduler`, and `@studnicky/retry` instead of hand-rolled implementations.

`Clock` is a thin static facade over a substrate `Clock` instance (`RealTimeClockProvider` by default). `ClockProviderInterface` now requires `now()` in addition to `hrtime()`, matching substrate's `ClockProviderType`. `RealTimeScheduler` subclasses substrate's `RealTimeScheduler`, adding the Promise/`AbortSignal` layer (`after`/`at`/`every`) this engine's `SchedulerProviderInterface` requires on top of substrate's callback-based `scheduleAt`. `testing/VirtualClock.ts` and `testing/VirtualScheduler.ts` (the `@studnicky/dagonizer/testing` deterministic-time doubles) are rebuilt on substrate's `VirtualClockProvider`/`VirtualScheduler` + `VirtualTimeCounter`, preserving their existing `tickNs`/`tickMs`/`advance`/`runUntil`/`runAll` test API.

`RetryPolicy` now extends `@studnicky/retry`'s `Retry`, gaining its attempt-lifecycle FSM, `getStats()`/`resetStats()` request statistics, and observability hooks (`onAttempt`, `onSuccess`, `onRetryableError`, `onRetryScheduled`, `onGiveUp`) for subclasses to override. The declarative `strategy`/`baseDelay`/`maxDelay`/`multiplier`/`jitterFactor` backoff config and `retryOn`/`abortOn` error-constructor filters are unchanged; `RetryPolicy.run()` unwraps substrate's `MaxRetriesExceededError`/`NonRetryableError` wrapper types back to the original task error, so callers still catch the raw error. `RetryPolicy.run()` no longer schedules its backoff delay through the injected `Scheduler` — delays now go through substrate's `Retry`, which uses a real timer directly. `entities/runtime/BackoffStrategy.ts`'s schema-derived string enum is unchanged; substrate's own `BackoffStrategyType` is a function type, not a JSON-serializable wire value, so it does not replace this entity.

`package.json` gains `@studnicky/clock`, `@studnicky/scheduler`, and `@studnicky/retry` as dependencies.
