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

import type { ExecuteOptionsType } from '../contracts/ExecuteOptionsType.js';

/**
 * Cached never-aborting signal. Lazily initialised by `SignalComposer.never()`.
 * A single instance serves all callers; it is safe to share because it never
 * aborts and carries no per-call identity.
 */
let neverSignal: AbortSignal | null = null;

/**
 * Fold caller-supplied cancellation options into a single `AbortSignal`.
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
   * Returns a cached `AbortSignal` that never aborts. Used by the dispatcher
   * when building a node's context from options that supply neither `signal`
   * nor `deadlineMs`, so every node context always has a valid signal.
   *
   * The signal is created once on the first call and reused on all subsequent
   * calls; the underlying `AbortController` is intentionally never aborted.
   */
  static never(): AbortSignal {
    if (neverSignal === null) {
      neverSignal = new AbortController().signal;
    }
    return neverSignal;
  }

  /**
   * Returns the composed `AbortSignal`, or `null` when neither
   * `options.signal` nor `options.deadlineMs` is supplied.
   *
   * - one input  → that input is returned directly
   * - two inputs → composed via `AbortSignal.any([…])`
   */
  static compose(options: ExecuteOptionsType): AbortSignal | null {
    const callerSignal  = options.signal;
    const deadlineMs    = options.deadlineMs;
    const timeoutSignal = deadlineMs !== undefined ? AbortSignal.timeout(deadlineMs) : undefined;

    if (callerSignal !== undefined && timeoutSignal !== undefined) {
      return AbortSignal.any([callerSignal, timeoutSignal]);
    }
    if (callerSignal !== undefined) return callerSignal;
    if (timeoutSignal !== undefined) return timeoutSignal;
    return null;
  }
}
