/**
 * SignalComposer: fold the dispatcher's `signal` and `deadlineMs` options
 * into a single `AbortSignal`.
 *
 * Static class. Returns `null` when neither option is supplied (no
 * cancellation surface; the dispatcher composes a never-aborting signal
 * when it builds a node's context).
 *
 * `deadlineMs` is wired through `AbortSignal.timeout()`; the platform
 * surfaces a `TimeoutError` as the abort reason, which `Dagonizer`
 * detects to mark the lifecycle as `timed_out` rather than `cancelled`.
 */

import type { ExecuteOptionsInterface } from '../contracts/ExecuteOptionsInterface.js';

/**
 * Compose an `AbortSignal` from caller-supplied cancellation options.
 *
 * @example
 * ```ts
 * const signal = SignalComposer.compose({ signal: ctrl.signal, deadlineMs: 5000 });
 * if (signal !== null) {
 *   await fetch(url, { signal });
 * }
 * ```
 */
export class SignalComposer {
  private constructor() { /* static class */ }

  /**
   * Returns the composed `AbortSignal`, or `null` when neither
   * `options.signal` nor `options.deadlineMs` is supplied.
   *
   * - one input  → that input is returned directly
   * - two inputs → composed via `AbortSignal.any([…])`
   */
  static compose(options: ExecuteOptionsInterface): AbortSignal | null {
    const signals: AbortSignal[] = [];
    if (options.signal) signals.push(options.signal);
    if (options.deadlineMs !== undefined) signals.push(AbortSignal.timeout(options.deadlineMs));
    if (signals.length === 0) return null;
    if (signals.length === 1) return signals[0] ?? null;
    return AbortSignal.any(signals);
  }
}
