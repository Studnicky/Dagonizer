/**
 * VirtualClockProvider: deterministic monotonic clock for tests and replay.
 *
 * Test-only. Install via `Clock.configure(new VirtualClockProvider(0n))`.
 * Advance virtual time by nanoseconds with `tickNs()` (or by milliseconds
 * via `tickMs()` for convenience).
 *
 * Backed by `@studnicky/clock`'s `VirtualClockProvider` + `VirtualTimeCounter`.
 * The counter tracks whole milliseconds only (substrate's virtual time model
 * is ms-granular, not ns-granular) — `tickNs()` truncates its delta to whole
 * milliseconds before advancing. `hrtime()` is therefore always a whole-ms
 * value expressed in nanoseconds. The counter only moves forward: a
 * zero-or-negative delta is a no-op, matching `VirtualTimeCounter.advance()`.
 */

import { VirtualClockProvider as SubstrateVirtualClockProvider, VirtualTimeCounter } from '@studnicky/clock';

import type { ClockProviderInterface } from '../dist/contracts/ClockProviderInterface.js';

const NS_PER_MS = 1_000_000n;

export class VirtualClockProvider extends SubstrateVirtualClockProvider implements ClockProviderInterface {
  readonly #counter: VirtualTimeCounter;

  constructor(initialNs: bigint = 0n) {
    const counter = VirtualTimeCounter.create({ 'startMs': Number(initialNs / NS_PER_MS) });
    super(counter);
    this.#counter = counter;
  }

  /** Advance virtual time by `deltaNs` nanoseconds, truncated to whole milliseconds. */
  tickNs(deltaNs: bigint): void {
    this.#counter.advance(Number(deltaNs / NS_PER_MS));
  }

  /** Advance virtual time by `deltaMs` milliseconds. */
  tickMs(deltaMs: number): void {
    this.#counter.advance(deltaMs);
  }
}
