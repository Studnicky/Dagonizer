/**
 * Clock: engine-owned monotonic clock provider.
 *
 * Single concept of time: monotonic high-resolution nanoseconds, derived from
 * `@studnicky/clock`'s `RealTimeClockProvider` (backed by `performance.now()`)
 * by default. No wall-clock; that's a different concern (logging, tracing)
 * and lives elsewhere.
 *
 * `Clock` is a thin static facade over one substrate `Clock` instance. A
 * static facade — rather than direct substrate `Clock` instances threaded
 * through every call site — is kept here because `RetryPolicy.ts` (a
 * permanently off-limits file for this phase) depends on the sibling
 * `Scheduler.current()` static-singleton pattern; `Clock` mirrors that shape
 * for consistency, and its own call sites (`NodeStateBase.ts`,
 * `ReservoirBuffer.ts`) are FSM/engine-internal code with no natural
 * constructor-injection seam today.
 *
 * Static class; no instances, no free helpers.
 */

import { Clock as SubstrateClock, RealTimeClockProvider } from '@studnicky/clock';

import type { ClockProviderInterface } from '../contracts/ClockProviderInterface.js';

const NS_PER_MS = 1_000_000n;

let activeClock: SubstrateClock = SubstrateClock.create(RealTimeClockProvider.create());

/**
 * Engine-owned monotonic clock. All time reads go through `Clock.hrtime()` or
 * `Clock.monotonicMs()`. No wall-clock is exposed. Install a
 * `VirtualClockProvider` in tests for deterministic timestamps.
 */
export class Clock {
  private constructor() { /* static class */ }

  /** Monotonic high-resolution time in nanoseconds since arbitrary origin. */
  static hrtime(): bigint {
    return activeClock.hrtime();
  }

  /**
   * Monotonic time in integer milliseconds. Derived from `hrtime()`;
   * not wall-clock. Suitable for timestamps in the lifecycle FSM,
   * scheduler delays, and other relative-time math.
   */
  static monotonicMs(): number {
    return Number(activeClock.hrtime() / NS_PER_MS);
  }

  /** Install a custom clock provider. Engine-only; called at boot or in tests. */
  static configure(provider: ClockProviderInterface): void {
    activeClock = SubstrateClock.create(provider);
  }

  /** Reset to the real-time provider. */
  static reset(): void {
    activeClock = SubstrateClock.create(RealTimeClockProvider.create());
  }
}
