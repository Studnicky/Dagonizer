/**
 * Clock: engine-owned monotonic clock provider.
 *
 * Single concept of time: monotonic high-resolution nanoseconds from a
 * platform clock. No wall-clock; that's a different concern (logging,
 * tracing) and lives elsewhere.
 *
 * Default provider derives nanoseconds from `performance.now()` (in ms,
 * fractional). Both Node 16+ and every modern browser ship
 * `performance.now()` on `globalThis`, so the same default works
 * unmodified in Node, the browser, and bundlers like Vite. This is the
 * ONLY permitted call site for `performance.now()` outside this file.
 *
 * Static class; no instances, no free helpers.
 */

import type { ClockProvider } from '../contracts/ClockProvider.js';

const PERF: { now(): number } = (globalThis as { performance: { now(): number } }).performance;

class RealTimeClockProvider implements ClockProvider {
  hrtime(): bigint {
    // `performance.now()` returns fractional milliseconds; multiply to
    // nanoseconds and floor via BigInt construction.
    return BigInt(Math.floor(PERF.now() * 1_000_000));
  }
}

const NS_PER_MS = 1_000_000n;

let _provider: ClockProvider = new RealTimeClockProvider();

/**
 * Engine-owned monotonic clock. All time reads go through `Clock.hrtime()` or
 * `Clock.monotonicMs()`. No wall-clock is exposed. Install a
 * `VirtualClockProvider` in tests for deterministic timestamps.
 */
export class Clock {
  private constructor() { /* static class */ }

  /** Monotonic high-resolution time in nanoseconds since arbitrary origin. */
  static hrtime(): bigint {
    return _provider.hrtime();
  }

  /**
   * Monotonic time in integer milliseconds. Derived from `hrtime()`;
   * not wall-clock. Suitable for timestamps in the lifecycle FSM,
   * scheduler delays, and other relative-time math.
   */
  static monotonicMs(): number {
    return Number(_provider.hrtime() / NS_PER_MS);
  }

  /** Install a custom clock provider. Engine-only; called at boot or in tests. */
  static configure(provider: ClockProvider): void {
    _provider = provider;
  }

  /** Reset to the real-time provider. */
  static reset(): void {
    _provider = new RealTimeClockProvider();
  }
}
