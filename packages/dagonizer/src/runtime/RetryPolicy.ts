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

import type { ErrorConstructorType } from '../contracts/ErrorConstructorType.js';
import type { RetryPolicyOptionsInterface } from '../contracts/RetryPolicyOptionsInterface.js';
import {
  BackoffStrategy,
  type BackoffStrategyValue,
} from '../entities/runtime/BackoffStrategy.js';
import { DAGError, ExecutionError } from '../errors/DAGError.js';

import { Scheduler } from './Scheduler.js';

export { BackoffStrategy, type BackoffStrategyValue };

const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_MULTIPLIER = 2;
const DEFAULT_JITTER_FACTOR = 0.1;
const DEFAULT_MAX_ATTEMPTS = 3;
const DECORRELATED_JITTER_MULTIPLIER = 3;

/** Computes the raw (pre-jitter) delay in ms for a given attempt. */
type BackoffComputerType = (attempt: number, baseDelay: number, multiplier: number) => number;

const BACKOFF_COMPUTERS: Readonly<Record<BackoffStrategyValue, BackoffComputerType>> = {
  'constant': (_attempt, baseDelay) => baseDelay,
  'linear': (attempt, baseDelay) => baseDelay * attempt,
  'exponential': (attempt, baseDelay, multiplier) => baseDelay * Math.pow(multiplier, attempt - 1),
  'decorrelated-jitter': (_attempt, baseDelay) =>
    Math.random() * (baseDelay * DECORRELATED_JITTER_MULTIPLIER - baseDelay) + baseDelay,
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
  readonly strategy: BackoffStrategyValue;
  readonly baseDelay: number;
  readonly maxDelay: number;
  readonly multiplier: number;
  readonly jitterFactor: number;
  readonly retryOn: readonly ErrorConstructorType[] | null;
  readonly abortOn: readonly ErrorConstructorType[] | null;

  constructor(options: RetryPolicyOptionsInterface = {}) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.strategy = options.strategy ?? BackoffStrategy.EXPONENTIAL;
    this.baseDelay = options.baseDelay ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelay = options.maxDelay ?? DEFAULT_MAX_DELAY_MS;
    this.multiplier = options.multiplier ?? DEFAULT_MULTIPLIER;
    this.jitterFactor = options.jitterFactor ?? DEFAULT_JITTER_FACTOR;
    this.retryOn = options.retryOn ?? null;
    this.abortOn = options.abortOn ?? null;
  }

  /**
   * Materialise a complete `RetryPolicy` from a partial options object.
   * All `DEFAULT_*` defaulting lives here; callers that supply a
   * `RetryPolicyOptionsInterface` from external config should prefer this
   * factory over `new RetryPolicy(options)` so the defaults are visible and
   * centrally maintained.
   */
  static from(partial: RetryPolicyOptionsInterface): RetryPolicy {
    const opts: RetryPolicyOptionsInterface = {
      'maxAttempts': partial.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      'strategy': partial.strategy ?? BackoffStrategy.EXPONENTIAL,
      'baseDelay': partial.baseDelay ?? DEFAULT_BASE_DELAY_MS,
      'maxDelay': partial.maxDelay ?? DEFAULT_MAX_DELAY_MS,
      'multiplier': partial.multiplier ?? DEFAULT_MULTIPLIER,
      'jitterFactor': partial.jitterFactor ?? DEFAULT_JITTER_FACTOR,
      ...(partial.retryOn !== undefined && { 'retryOn': partial.retryOn }),
      ...(partial.abortOn !== undefined && { 'abortOn': partial.abortOn }),
    };
    return new RetryPolicy(opts);
  }

  /**
   * Compute the backoff delay (ms) for the given attempt number (1-based).
   * Override for custom backoff. The base implementation honors the
   * configured strategy + jitter.
   */
  getDelay(attempt: number, options?: { error?: Error | null }): number {
    void options; // reserved for subclass overrides; base implementation ignores error
    const computer = BACKOFF_COMPUTERS[this.strategy];
    if (computer === undefined) {
      throw new DAGError(`Unknown backoff strategy: ${this.strategy as string}`);
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

    if (this.abortOn !== null) {
      for (const ErrorType of this.abortOn) {
        if (error instanceof ErrorType) {
          return false;
        }
      }
    }

    if (this.retryOn !== null) {
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
  async run<T>(task: (attempt: number) => Promise<T> | T, options?: { signal?: AbortSignal }): Promise<T> {
    const signal = options?.signal;
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < this.maxAttempts) {
      if (signal?.aborted) {
        throw ExecutionError.fromSignal(signal);
      }
      attempt++;

      try {
        return await task(attempt);
      } catch (error) {
        lastError = error instanceof Error ? error : new ExecutionError(String(error));

        if (!this.shouldRetry(lastError, attempt)) {
          throw lastError;
        }

        const delay = this.getDelay(attempt, { 'error': lastError });
        await RetryPolicy.sleep(delay, signal !== undefined ? { signal } : undefined);
      }
    }

    throw lastError ?? new ExecutionError('Retry attempts exhausted');
  }

  /**
   * Sleep `ms` via the installed `Scheduler`. Resolves early if
   * `options.signal` aborts during the wait.
   */
  private static async sleep(ms: number, options?: { signal?: AbortSignal }): Promise<void> {
    if (ms <= 0) return;
    const signal = options?.signal;
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
