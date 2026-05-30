/**
 * RetryPolicy: configurable retry-with-backoff policy.
 *
 * Strategy enum: constant, linear, exponential, decorrelated-jitter.
 * Filtering: `retryOn` + `abortOn` lists of Error constructors. When neither
 * is provided, every error is retried up to `maxAttempts`.
 *
 * Delay is scheduled via `Scheduler.current()` so tests can install a
 * `VirtualScheduler` and step through retries deterministically. Cancellation
 * is honored via `AbortSignal`; `run(task, signal)` aborts mid-wait when the
 * signal fires.
 *
 * Class extension is the canonical extension point: subclass `RetryPolicy`
 * and override `shouldRetry` / `getDelay` for custom behavior. No callbacks.
 */

import type { ErrorConstructorType } from '../contracts/ErrorConstructorType.js';
import type { RetryPolicyOptionsInterface } from '../contracts/RetryPolicyOptionsInterface.js';
import {
  BackoffStrategy,
  type BackoffStrategyValue,
} from '../entities/runtime/BackoffStrategy.js';
import { DAGError } from '../errors/DAGError.js';

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
 * a `run(task, signal)` execution loop.
 *
 * Delay waits are scheduled via `Scheduler.current()`; install
 * `VirtualScheduler` in tests to advance time deterministically.
 *
 * @example
 * ```ts
 * const policy = new RetryPolicy({
 *   maxAttempts: 3,
 *   strategy: BackoffStrategy.EXPONENTIAL,
 *   retryOn: [NetworkError],
 *   abortOn: [AuthError],
 * });
 *
 * // Inside a node's execute():
 * const data = await policy.run(
 *   () => fetchRemote(url),
 *   context.signal,
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
   * Compute the backoff delay (ms) for the given attempt number (1-based).
   * Override for custom backoff. The base implementation honors the
   * configured strategy + jitter.
   */
  getDelay(attempt: number, _error: Error | null = null): number {
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
   * throws the last error after attempts are exhausted. Aborts when `signal`
   * fires; the abort takes effect at the next decision point (after the
   * current attempt or during the next wait).
   */
  async run<T>(task: (attempt: number) => Promise<T> | T, signal?: AbortSignal): Promise<T> {
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < this.maxAttempts) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error(typeof signal.reason === 'string' ? signal.reason : 'aborted');
      }
      attempt++;

      try {
        return await task(attempt);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!this.shouldRetry(lastError, attempt)) {
          throw lastError;
        }

        const delay = this.getDelay(attempt, lastError);
        await RetryPolicy.sleep(delay, signal);
      }
    }

    throw lastError ?? new Error('Retry attempts exhausted');
  }

  /**
   * Sleep `ms` via the installed `Scheduler`. Resolves early if `signal`
   * aborts during the wait.
   */
  private static async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return;
    try {
      await Scheduler.current().after(ms, signal);
    } catch (err) {
      // Re-throw abort errors as the signal's reason for consistent error shape.
      if (signal?.aborted === true) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error(typeof signal.reason === 'string' ? signal.reason : 'aborted');
      }
      throw err;
    }
  }
}
