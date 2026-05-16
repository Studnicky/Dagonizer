/**
 * Clock — engine-owned monotonic clock provider.
 *
 * Single concept of time: monotonic high-resolution nanoseconds from
 * `process.hrtime.bigint()`. No wall-clock — that's a different concern
 * (logging, tracing) and lives elsewhere.
 *
 * Default provider wraps `process.hrtime.bigint()`. This is the ONLY
 * permitted call site for that API outside this file.
 *
 * Static class — no instances, no free helpers.
 */

import type { ClockProvider } from '../contracts/ClockProvider.js';

class RealTimeClockProvider implements ClockProvider {
  hrtime(): bigint {
    return process.hrtime.bigint();
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
   * Monotonic time in integer milliseconds. Derived from `hrtime()` —
   * not wall-clock. Suitable for timestamps in the lifecycle FSM,
   * scheduler delays, and other relative-time math.
   */
  static monotonicMs(): number {
    return Number(_provider.hrtime() / NS_PER_MS);
  }

  /** Install a custom clock provider. Engine-only — called at boot or in tests. */
  static configure(provider: ClockProvider): void {
    _provider = provider;
  }

  /** Reset to the real-time provider. */
  static reset(): void {
    _provider = new RealTimeClockProvider();
  }
}
