/**
 * RetryPolicy: configurable retry-with-backoff policy, built on
 * `@studnicky/retry`'s `Retry`.
 *
 * `Retry` supplies the attempt-lifecycle FSM, request statistics
 * (`getStats()`/`resetStats()`), and observability hooks (`onAttempt`,
 * `onSuccess`, `onRetryableError`, `onRetryScheduled`, `onGiveUp`).
 * `RetryPolicy` extends it (class extension is the canonical extension
 * point in this repo) and adds exactly the DAG-specific surface substrate
 * doesn't have:
 *
 *   - a declarative `strategy` enum (`constant`/`linear`/`exponential`/
 *     `decorrelated-jitter`) plus `baseDelay`/`maxDelay`/`multiplier`/
 *     `jitterFactor`, computed by `getDelay()` and applied via the
 *     `onRetryScheduled` hook (substrate's own backoff helpers are
 *     function-typed, not schema-serializable — see `BackoffStrategy.ts`
 *     for why the enum stays);
 *   - `retryOn`/`abortOn` error-constructor filters, evaluated by
 *     `shouldRetry()` and wired into substrate's `classifyError()` seam;
 *   - `AbortSignal` cancellation on `run()`, racing the underlying
 *     `execute()` call so an abort resolves the caller immediately.
 *
 * `run()` unwraps substrate's `MaxRetriesExceededError`/`NonRetryableError`
 * wrapper types back to the original task error, preserving this class's
 * pre-existing "throws the last raw error" contract for callers.
 *
 * Class extension is the canonical extension point: subclass `RetryPolicy`
 * and override `shouldRetry` / `getDelay` for custom behavior. No callbacks.
 *
 * Use `RetryPolicy.from(partial)` to construct from a
 * `RetryPolicyOptionsType` partial; defaults are materialised once here.
 */

import type { ErrorClassificationType, RetryContextType } from '@studnicky/retry';
import { MaxRetriesExceededError, NonRetryableError, Retry } from '@studnicky/retry';

import type { AbortableOptionsType } from '../contracts/AbortableOptionsType.js';
import type { ErrorMatcherType } from '../contracts/ErrorMatcherType.js';
import type { RetryPolicyOptionsType } from '../contracts/RetryPolicyOptionsType.js';
import { BackoffStrategyNames } from '../entities/runtime/BackoffStrategy.js';
import type { BackoffStrategyType } from '../entities/runtime/BackoffStrategy.js';
import { DAGError } from '../errors/DAGError.js';

const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_MULTIPLIER = 2;
const DEFAULT_JITTER_FACTOR = 0.1;
const DEFAULT_MAX_ATTEMPTS = 3;
const DECORRELATED_JITTER_MULTIPLIER = 3;
const FIRST_ATTEMPT = 1;

/** Empty error-matcher list: the canonical "no filter" sentinel. */
const EMPTY_ERROR_MATCHERS: readonly ErrorMatcherType[] = [];

/** Canonical defaults for `RetryPolicyOptionsType` numeric/strategy fields. */
const RETRY_POLICY_DEFAULTS = {
  'maxAttempts':  DEFAULT_MAX_ATTEMPTS,
  'strategy':     BackoffStrategyNames.EXPONENTIAL satisfies BackoffStrategyType,
  'baseDelay':    DEFAULT_BASE_DELAY_MS,
  'maxDelay':     DEFAULT_MAX_DELAY_MS,
  'multiplier':   DEFAULT_MULTIPLIER,
  'jitterFactor': DEFAULT_JITTER_FACTOR,
  'retryOn':      EMPTY_ERROR_MATCHERS,
  'abortOn':      EMPTY_ERROR_MATCHERS,
} as const;

const BACKOFF_COMPUTERS: Readonly<Record<BackoffStrategyType, (attempt: number, baseDelay: number, multiplier: number) => number>> = {
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
 * a `run(task, options)` execution loop, layered on `@studnicky/retry`'s
 * `Retry`.
 *
 * `retryOn`/`abortOn` accept a mix of arbitrary error constructors (matched
 * via `instanceof`, for a consumer's own error classes) and `DAGError` code
 * strings (matched via `error instanceof DAGError && error.code === ...`,
 * for Dagonizer's own error taxonomy — one class, distinguished by `.code`).
 *
 * @example
 * ```ts
 * const policy = RetryPolicy.from({
 *   maxAttempts: 3,
 *   strategy: BackoffStrategyNames.EXPONENTIAL,
 *   retryOn: [NetworkError, 'EXECUTION_ERROR'],
 *   abortOn: [AuthError, 'VALIDATION_ERROR'],
 * });
 *
 * // Inside a node's execute():
 * const data = await policy.run(
 *   () => fetchRemote(url),
 *   { signal: context.signal },
 * );
 * ```
 */
export class RetryPolicy extends Retry {
  readonly maxAttempts: number;
  readonly strategy: BackoffStrategyType;
  readonly baseDelay: number;
  readonly maxDelay: number;
  readonly multiplier: number;
  readonly jitterFactor: number;
  /**
   * Filter: error matchers (constructors or `DAGError` code strings) that
   * may be retried. Empty array (`[]`) means "no filter — retry any error
   * type". A non-empty array means "retry only errors matched by one of
   * these matchers".
   *
   * Stored as a required field with an `[]` default. No `null` sentinel;
   * `length === 0` is the canonical "no filter" representation.
   */
  readonly retryOn: readonly ErrorMatcherType[];
  /**
   * Filter: error matchers (constructors or `DAGError` code strings) that
   * abort retrying immediately. Empty array (`[]`) means "no abort filter".
   * A non-empty array causes any matched error to be re-thrown without
   * further attempts, regardless of `retryOn`.
   */
  readonly abortOn: readonly ErrorMatcherType[];

  /** Attempt number (1-based) of the in-flight `execute()` call, tracked via `onAttempt`. */
  #currentAttempt: number = FIRST_ATTEMPT;
  /** Abort signal for the in-flight `run()` call, if any. */
  #signal: AbortSignal | undefined;

  /**
   * Single canonical construction path. Use `RetryPolicy.from(partial)` to
   * build an instance; all defaults are applied there. Subclasses may call
   * `super(options)` after materialising their own defaults via their own
   * `from()` override.
   *
   * Constructor is `protected` (not public) to prevent direct `new RetryPolicy()`
   * from external callers. External callers use `RetryPolicy.from(partial)`.
   */
  protected constructor(options: RetryPolicyOptionsType = {}) {
    const resolved = { ...RETRY_POLICY_DEFAULTS, ...options };
    super({ 'maxRetries': Math.max(0, resolved.maxAttempts - 1) });
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
  static from(partial: RetryPolicyOptionsType = {}): RetryPolicy {
    return new RetryPolicy(partial);
  }

  /** Unwrap substrate's `Retry` wrapper errors back to the original task error. */
  private static unwrapError(error: unknown): Error {
    if (error instanceof NonRetryableError) {
      return error.originalError;
    }
    if (error instanceof MaxRetriesExceededError) {
      const last = error.errors.at(-1);
      return last ?? error;
    }
    if (error instanceof Error) {
      return error;
    }
    return new DAGError(String(error), { 'code': 'EXECUTION_ERROR' });
  }

  /**
   * Test whether `error` is matched by `matcher`: an `instanceof` check for
   * an error constructor, or a `DAGError` code-string match for Dagonizer's
   * own error taxonomy.
   */
  private static matches(error: Error, matcher: ErrorMatcherType): boolean {
    if (typeof matcher === 'string') {
      return error instanceof DAGError && error.code === matcher;
    }
    return error instanceof matcher;
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

    if (this.jitterFactor > 0 && this.strategy !== BackoffStrategyNames.DECORRELATED_JITTER) {
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
      for (const matcher of this.abortOn) {
        if (RetryPolicy.matches(error, matcher)) {
          return false;
        }
      }
    }

    // retryOn: non-empty list means "retry only matching error types".
    // Empty list means "retry all error types" (no filter).
    if (this.retryOn.length > 0) {
      for (const matcher of this.retryOn) {
        if (RetryPolicy.matches(error, matcher)) {
          return true;
        }
      }
      return false;
    }

    return true;
  }

  /**
   * Substrate's error-classification seam. Delegates to `shouldRetry()` so
   * `retryOn`/`abortOn` stay the single source of truth for retry-vs-abort
   * decisions, whether reached via `Retry.execute()` or a direct
   * `shouldRetry()` call. `attemptNumber` arrives 0-indexed from substrate;
   * `shouldRetry` expects the 1-based numbering this class has always used.
   */
  protected override classifyError(error: Error, attemptNumber: number): ErrorClassificationType {
    const retryable = this.shouldRetry(error, attemptNumber + 1);
    return retryable ? { 'retryable': true } : { 'retryable': false };
  }

  /** Tracks the 1-based attempt number of the in-flight `execute()` call. */
  protected override onAttempt(attemptNumber: number): void {
    this.#currentAttempt = attemptNumber + 1;
  }

  /**
   * Substrate's retry-scheduling seam. Applies the configured `strategy`
   * backoff via `getDelay()`. When the `run()` signal has already fired,
   * skips the wait — the outer `run()` promise has already settled via the
   * abort race in `run()`, so there is no caller left to observe the delay.
   */
  protected override onRetryScheduled(context: RetryContextType): void {
    context.delayMs = this.#signal?.aborted === true ? 0 : this.getDelay(context.attemptNumber + 1);
  }

  /**
   * Run `task` under this policy. Resolves with the function's result, or
   * throws the last error after attempts are exhausted. Aborts when
   * `options.signal` fires; the abort takes effect at the next decision
   * point (after the current attempt or during the next wait).
   */
  async run<T>(task: (attempt: number) => Promise<T> | T, options: AbortableOptionsType = {}): Promise<T> {
    const signal = options.signal;

    if (signal?.aborted === true) {
      throw DAGError.ofSignal(signal);
    }

    this.#signal = signal;
    this.#currentAttempt = FIRST_ATTEMPT;

    const execution = this.execute(async () => {
      const result = await task(this.#currentAttempt);

      // Detect abort that raced with task completion: if the signal fired
      // while `task` was executing but before `await` returned control here,
      // treat it as an abort rather than a successful result. This is a
      // retry-loop concern only — a single-attempt policy (`maxAttempts === 1`,
      // the NO_RETRY default) has no retry decision to gate, so it honors a
      // completed result even under a raced abort. Callers that route on
      // completion (the node-dispatch FIRE seam) depend on that: a node that
      // finishes and routes its output is a success, and cancellation is a
      // loop-boundary decision made by the caller, not a discarded result.
      if (signal?.aborted === true && this.maxAttempts > 1) {
        throw DAGError.ofSignal(signal);
      }
      return result;
    }).catch((error: unknown) => {
      throw RetryPolicy.unwrapError(error);
    });

    if (signal === undefined) {
      return execution;
    }

    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        reject(DAGError.ofSignal(signal));
      };
      signal.addEventListener('abort', onAbort, { 'once': true });
      execution.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }
}
