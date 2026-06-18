/**
 * RetryPolicy: configurable retry-with-backoff policy.
 *
 * Strategy enum: constant, linear, exponential, decorrelated-jitter.
 * Filtering: `retryOn` + `abortOn` lists of Error constructors. When neither
 * is provided, every error is retried up to `maxAttempts`.
 *
 * Delay is scheduled via `Scheduler.current()` so tests can install a
 * `VirtualScheduler` and step through retries deterministically. Cancellation
 * is honored via `AbortSignal`; `run(task, { signal })` aborts mid-wait when
 * the signal fires.
 *
 * Class extension is the canonical extension point: subclass `RetryPolicy`
 * and override `shouldRetry` / `getDelay` for custom behavior. No callbacks.
 *
 * Use `RetryPolicy.from(partial)` to construct from a
 * `RetryPolicyOptionsInterface` partial; defaults are materialised once here.
 */

import type { AbortableOptionsInterface } from '../contracts/AbortableOptionsInterface.js';
import type { ErrorConstructorType } from '../contracts/ErrorConstructorType.js';
import type { RetryPolicyOptionsInterface } from '../contracts/RetryPolicyOptionsInterface.js';
import { BackoffStrategy } from '../entities/runtime/BackoffStrategy.js';
import { DAGError, ExecutionError } from '../errors/DAGError.js';

import { Scheduler } from './Scheduler.js';

export { BackoffStrategy };

const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_MULTIPLIER = 2;
const DEFAULT_JITTER_FACTOR = 0.1;
const DEFAULT_MAX_ATTEMPTS = 3;
const DECORRELATED_JITTER_MULTIPLIER = 3;

/** Canonical defaults for `RetryPolicyOptionsInterface` numeric/strategy fields. */
const RETRY_POLICY_DEFAULTS = {
  'maxAttempts':  DEFAULT_MAX_ATTEMPTS,
  'strategy':     BackoffStrategy.EXPONENTIAL as BackoffStrategy,
  'baseDelay':    DEFAULT_BASE_DELAY_MS,
  'maxDelay':     DEFAULT_MAX_DELAY_MS,
  'multiplier':   DEFAULT_MULTIPLIER,
  'jitterFactor': DEFAULT_JITTER_FACTOR,
  'retryOn':      [] as readonly ErrorConstructorType[],
  'abortOn':      [] as readonly ErrorConstructorType[],
} as const;


const BACKOFF_COMPUTERS: Readonly<Record<BackoffStrategy, (attempt: number, baseDelay: number, multiplier: number) => number>> = {
  'constant': (_attempt, baseDelay) => baseDelay,
  'linear': (attempt, baseDelay) => baseDelay * attempt,
  'exponential': (attempt, baseDelay, multiplier) => baseDelay * Math.pow(multiplier, attempt - 1),
  // Jitter range is [baseDelay, baseDelay * DECORRELATED_JITTER_MULTIPLIER].
  // When baseDelay >= maxDelay the range collapses to [baseDelay, baseDelay];
  // getDelay() then clamps the result to maxDelay, keeping it in [0, maxDelay].
  'decorrelated-jitter': (_attempt, baseDelay) => {
    const lo = baseDelay;
    const hi = baseDelay * DECORRELATED_JITTER_MULTIPLIER;
    return Math.random() * Math.max(0, hi - lo) + lo;
  },
};

/**
 * Retry-with-backoff policy. Strategy enum (`CONSTANT`, `LINEAR`,
 * `EXPONENTIAL`, `DECORRELATED_JITTER`), `retryOn`/`abortOn` filters, and
 * a `run(task, options)` execution loop.
 *
 * Delay waits are scheduled via `Scheduler.current()`; install
 * `VirtualScheduler` in tests to advance time deterministically.
 *
 * @example
 * ```ts
 * const policy = RetryPolicy.from({
 *   maxAttempts: 3,
 *   strategy: BackoffStrategy.EXPONENTIAL,
 *   retryOn: [NetworkError],
 *   abortOn: [AuthError],
 * });
 *
 * // Inside a node's execute():
 * const data = await policy.run(
 *   () => fetchRemote(url),
 *   { signal: context.signal },
 * );
 * ```
 */
export class RetryPolicy {
  readonly maxAttempts: number;
  readonly strategy: BackoffStrategy;
  readonly baseDelay: number;
  readonly maxDelay: number;
  readonly multiplier: number;
  readonly jitterFactor: number;
  /**
   * Filter: error types that may be retried. Empty array (`[]`) means "no
   * filter — retry any error type". A non-empty array means "retry only
   * errors that are instances of one of these constructors".
   *
   * Stored as a required field with an `[]` default. No `null` sentinel;
   * `length === 0` is the canonical "no filter" representation.
   */
  readonly retryOn: readonly ErrorConstructorType[];
  /**
   * Filter: error types that abort retrying immediately. Empty array (`[]`)
   * means "no abort filter". A non-empty array causes any matching error to
   * be re-thrown without further attempts, regardless of `retryOn`.
   */
  readonly abortOn: readonly ErrorConstructorType[];

  /**
   * Single canonical construction path. Use `RetryPolicy.from(partial)` to
   * build an instance; all defaults are applied there. Subclasses may call
   * `super(options)` after materialising their own defaults via their own
   * `from()` override.
   *
   * Constructor is `protected` (not public) to prevent direct `new RetryPolicy()`
   * from external callers. External callers use `RetryPolicy.from(partial)`.
   */
  protected constructor(options: RetryPolicyOptionsInterface = {}) {
    const resolved = { ...RETRY_POLICY_DEFAULTS, ...options };
    this.maxAttempts  = resolved.maxAttempts;
    this.strategy     = resolved.strategy;
    this.baseDelay    = resolved.baseDelay;
    this.maxDelay     = resolved.maxDelay;
    this.multiplier   = resolved.multiplier;
    this.jitterFactor = resolved.jitterFactor;
    this.retryOn      = resolved.retryOn;
    this.abortOn      = resolved.abortOn;
  }

  /**
   * Materialise a complete `RetryPolicy` from a partial options object.
   * Single canonical creation path; all `DEFAULT_*` defaulting lives here.
   */
  static from(partial: RetryPolicyOptionsInterface = {}): RetryPolicy {
    return new RetryPolicy(partial);
  }

  /**
   * Compute the backoff delay (ms) for the given attempt number (1-based).
   * Override for custom backoff. The base implementation honors the
   * configured strategy + jitter.
   */
  getDelay(attempt: number, options: { readonly error: Error | null } = { 'error': null }): number {
    // `options.error` is reserved for subclass overrides; the base implementation ignores it.
    void options;
    const computer = BACKOFF_COMPUTERS[this.strategy];
    if (computer === undefined) {
      throw new DAGError(`Unknown backoff strategy: ${this.strategy}`);
    }
    let delay = computer(attempt, this.baseDelay, this.multiplier);

    if (this.jitterFactor > 0 && this.strategy !== BackoffStrategy.DECORRELATED_JITTER) {
      const jitter = delay * this.jitterFactor * (Math.random() * 2 - 1);
      delay += jitter;
    }

    return Math.min(Math.max(delay, 0), this.maxDelay);
  }

  /**
   * Decide whether the given error should be retried at this attempt.
   * Order of checks:
   *  1. attempt < maxAttempts
   *  2. error not in abortOn list (if provided)
   *  3. if retryOn list provided, error must be in it
   *  4. otherwise retry
   */
  shouldRetry(error: Error, attempt: number): boolean {
    if (attempt >= this.maxAttempts) {
      return false;
    }

    // abortOn: non-empty list means "abort on any matching error type".
    if (this.abortOn.length > 0) {
      for (const ErrorType of this.abortOn) {
        if (error instanceof ErrorType) {
          return false;
        }
      }
    }

    // retryOn: non-empty list means "retry only matching error types".
    // Empty list means "retry all error types" (no filter).
    if (this.retryOn.length > 0) {
      for (const ErrorType of this.retryOn) {
        if (error instanceof ErrorType) {
          return true;
        }
      }
      return false;
    }

    return true;
  }

  /**
   * Run `task` under this policy. Resolves with the function's result, or
   * throws the last error after attempts are exhausted. Aborts when
   * `options.signal` fires; the abort takes effect at the next decision
   * point (after the current attempt or during the next wait).
   */
  async run<T>(task: (attempt: number) => Promise<T> | T, options?: AbortableOptionsInterface): Promise<T> {
    const signal = options?.signal;
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < this.maxAttempts) {
      if (signal?.aborted) {
        throw ExecutionError.fromSignal(signal);
      }
      attempt++;

      try {
        const result = await task(attempt);
        // Detect abort that raced with task completion: if the signal fired
        // while `task` was executing but before `await` returned control here,
        // treat it as an abort rather than a successful result.
        if (signal?.aborted === true) {
          throw ExecutionError.fromSignal(signal);
        }
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new ExecutionError(String(error));

        if (!this.shouldRetry(lastError, attempt)) {
          throw lastError;
        }

        const delay = this.getDelay(attempt, { 'error': lastError });
        await RetryPolicy.sleep(delay, signal !== undefined ? { signal } : {});
      }
    }

    throw lastError ?? new ExecutionError('Retry attempts exhausted');
  }

  /**
   * Sleep `ms` via the installed `Scheduler`. Resolves early if
   * `options.signal` aborts during the wait.
   */
  private static async sleep(ms: number, options: AbortableOptionsInterface = {}): Promise<void> {
    if (ms <= 0) return;
    const signal = options.signal;
    try {
      await Scheduler.current().after(ms, options);
    } catch (err) {
      // Re-throw abort errors as the signal's reason for consistent error shape.
      if (signal?.aborted === true) {
        throw ExecutionError.fromSignal(signal);
      }
      throw err;
    }
  }
}
