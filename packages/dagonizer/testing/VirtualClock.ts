/**
 * VirtualClockProvider: deterministic monotonic clock for tests and replay.
 *
 * Test-only. Install via `Clock.configure(new VirtualClockProvider(0n))`.
 * Advance virtual time by nanoseconds with `tickNs()` (or by milliseconds
 * via `tickMs()` for convenience). Pair with `VirtualScheduler` so the
 * scheduler and Clock observe the same virtual time.
 */

import type { ClockProviderInterface } from '../dist/contracts/ClockProviderInterface.js';

const NS_PER_MS = 1_000_000n;

export class VirtualClockProvider implements ClockProviderInterface {
  #hrtimeNs: bigint;

  constructor(initialNs: bigint = 0n) {
    this.#hrtimeNs = initialNs;
  }

  hrtime(): bigint {
    return this.#hrtimeNs;
  }

  /** Set virtual hrtime to a specific nanosecond value. */
  setNs(ns: bigint): void {
    this.#hrtimeNs = ns;
  }

  /** Advance virtual time by `deltaNs` nanoseconds. */
  tickNs(deltaNs: bigint): void {
    this.#hrtimeNs += deltaNs;
  }

  /** Convenience: advance virtual time by `deltaMs` milliseconds. */
  tickMs(deltaMs: number): void {
    this.#hrtimeNs += BigInt(deltaMs) * NS_PER_MS;
  }
}
