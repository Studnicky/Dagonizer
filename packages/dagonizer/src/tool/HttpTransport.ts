/**
 * HttpTransport: shared fetch wrapper for tool packages.
 *
 * Every HTTP-backed tool (OpenLibrary, Google Books, Wikipedia, …) needs the
 * same boilerplate: abort propagation, per-request timeout, retry on transient
 * errors (network, 5xx, 429), optional rate/circuit protection, JSON parsing,
 * classification of failures into `ToolError`. Consolidating that here keeps
 * every tool class thin: a concrete tool's `execute()` method is roughly:
 * build the URL, hand off to `HttpTransport.getJson(...)`, map the response.
 *
 * Static class per project standards (`noun.verb()`). No constructor,
 * no instance state.
 *
 * The parsed JSON body crosses a foreign boundary as `unknown` and is
 * narrowed by a caller-supplied schema-backed `EntityValidatorInterface` before it
 * is returned. Because the framework uses forced tool-calling, every
 * caller's expected shape is known at the call site, so the validator is
 * required — there is no unchecked-cast path. A shape mismatch throws a
 * non-retryable `ToolError(PARSE_ERROR)`.
 */

import type { CircuitBreaker, TokenBucket } from '@studnicky/resilience';
import { MaxRetriesExceededError, NonRetryableError, Retry } from '@studnicky/retry';
import type { ErrorClassificationType, RetryContextType } from '@studnicky/retry';
import { BackoffStrategy } from '@studnicky/retry/backoff';
import { Signal } from '@studnicky/signal';

import { Scheduler } from '../runtime/Scheduler.js';
import type { EntityValidatorInterface } from '../validation/Validator.js';

import { OpenApiGuard } from './OpenApiGuard.js';
import { ToolError, type ToolErrorReasonType } from './ToolError.js';

/** Named return type for HTTP status classification. */
export type HttpStatusClassificationType = {
  reason: ToolErrorReasonType;
  retryable: boolean;
}

export type HttpRequestOptionsType = {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Per-request deadline in ms. */
  timeoutMs: number;
  /** Maximum retry attempts on transient errors (3 total tries at default 2). */
  maxRetries: number;
  /** Base exponential backoff delay in ms between transient retry attempts. */
  baseBackoffMs: number;
  /** Ceiling for retry backoff delay in ms. */
  maxBackoffMs: number;
  /**
   * Optional logical-request circuit breaker. Wraps the whole retry run once,
   * so open-circuit rejection does not burn retry budget.
   */
  circuitBreaker?: CircuitBreaker | null;
  /**
   * Optional logical-request token bucket. Consumes/waits for one token before
   * the retry run starts, so retries do not multiply quota consumption.
   */
  tokenBucket?: TokenBucket | null;
}

const DEFAULT_TIMEOUT_MS  = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const BASE_BACKOFF_MS     = 400;
const MAX_BACKOFF_MS      = 5_000;

/** Canonical defaults for defaultable fields of `HttpRequestOptionsType`. */
const HTTP_REQUEST_DEFAULTS = {
  'timeoutMs':      DEFAULT_TIMEOUT_MS,
  'maxRetries':     DEFAULT_MAX_RETRIES,
  'baseBackoffMs':  BASE_BACKOFF_MS,
  'maxBackoffMs':   MAX_BACKOFF_MS,
  'circuitBreaker': null,
  'tokenBucket':    null,
} as const;

/** Abort-signal helpers shared by the retry policy and transport core. */
class HttpAbortSignals {
  private constructor() { /* static class */ }

  static errorFromSignal(signal: AbortSignal): ToolError {
    const reason = HttpAbortSignals.isTimeoutSignal(signal) ? 'TIMEOUT' : 'ABORTED';
    return new ToolError(
      reason === 'TIMEOUT' ? 'request timeout' : 'request aborted',
      { reason, 'retryable': false, 'status': null, 'cause': signal.reason },
    );
  }

  static isTimeoutSignal(signal: AbortSignal): boolean {
    const reason = signal.reason;
    return reason instanceof DOMException && reason.name === 'TimeoutError';
  }

  static waitForRetryDelay(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    if (signal.aborted) return Promise.reject(HttpAbortSignals.errorFromSignal(signal));
    return Scheduler.current().after(ms, { signal }).catch((error: unknown) => {
      if (signal.aborted) {
        throw HttpAbortSignals.errorFromSignal(signal);
      }
      throw error;
    });
  }
}

/** Retry policy for tool HTTP attempts, backed by `@studnicky/retry`. */
class HttpRetryPolicy extends Retry {
  readonly #baseBackoffMs: number;
  readonly #maxBackoffMs: number;
  readonly #signal: AbortSignal;

  private constructor(options: HttpRequestOptionsType, signal: AbortSignal) {
    super({ 'maxRetries': options.maxRetries });
    this.#baseBackoffMs = options.baseBackoffMs;
    this.#maxBackoffMs = options.maxBackoffMs;
    this.#signal = signal;
  }

  static of(options: HttpRequestOptionsType, signal: AbortSignal): HttpRetryPolicy {
    return new HttpRetryPolicy(options, signal);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#signal.aborted) {
      throw HttpAbortSignals.errorFromSignal(this.#signal);
    }

    const execution = this.execute(task).catch((error: unknown) => {
      throw HttpRetryPolicy.unwrap(error);
    });

    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        reject(HttpAbortSignals.errorFromSignal(this.#signal));
      };
      this.#signal.addEventListener('abort', onAbort, { 'once': true });
      execution.then(
        (value) => {
          this.#signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          this.#signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  protected override classifyError(error: Error): ErrorClassificationType {
    if (error instanceof ToolError) {
      return { 'retryable': error.retryable, 'reason': error.reason };
    }
    return { 'retryable': true, 'reason': 'NETWORK' };
  }

  protected override async onRetryScheduled(context: RetryContextType): Promise<void> {
    const strategy = BackoffStrategy.withCeiling(BackoffStrategy.exponential, this.#maxBackoffMs);
    const delayMs = strategy(context.attemptNumber, this.#baseBackoffMs);
    context.delayMs = 0;
    await HttpAbortSignals.waitForRetryDelay(delayMs, this.#signal);
  }

  private static unwrap(error: unknown): Error {
    if (error instanceof NonRetryableError) {
      return error.originalError;
    }
    if (error instanceof MaxRetriesExceededError) {
      return error.errors.at(-1) ?? error;
    }
    if (error instanceof Error) {
      return error;
    }
    return new ToolError(String(error), { 'reason': 'UNKNOWN', 'retryable': false, 'status': null });
  }
}

export class HttpTransport {
  private constructor() { /* static class */ }

  /**
   * GET → JSON body narrowed by `validator`. Throws `ToolError` on
   * transport failure or on a schema mismatch (`PARSE_ERROR`).
   */
  static async getJson<TResponse>(
    url: string,
    validator: EntityValidatorInterface<TResponse>,
    options: Partial<HttpRequestOptionsType> = {},
  ): Promise<TResponse> {
    const resolved = HttpTransport.resolveOptions(options);
    const response = await HttpTransport.request(url, { 'method': 'GET' }, resolved);
    return HttpTransport.decodeJson<TResponse>(response, validator);
  }

  /**
   * POST a JSON body → JSON body narrowed by `validator`. Throws
   * `ToolError` on transport failure or on a schema mismatch (`PARSE_ERROR`).
   */
  static async postJson<TResponse>(
    url: string,
    body: unknown,
    validator: EntityValidatorInterface<TResponse>,
    options: Partial<HttpRequestOptionsType> = {},
  ): Promise<TResponse> {
    const resolved = HttpTransport.resolveOptions(options);
    const response = await HttpTransport.request(
      url,
      {
        'method':  'POST',
        'body':    JSON.stringify(body),
        'headers': { 'content-type': 'application/json' },
      },
      resolved,
    );
    return HttpTransport.decodeJson<TResponse>(response, validator);
  }

  /** Merge caller-supplied partial options with the module defaults. */
  private static resolveOptions(options: Partial<HttpRequestOptionsType>): HttpRequestOptionsType {
    const merged = { ...HTTP_REQUEST_DEFAULTS, ...options };
    return {
      'timeoutMs':     merged.timeoutMs,
      'maxRetries':    merged.maxRetries,
      'baseBackoffMs': merged.baseBackoffMs,
      'maxBackoffMs':  merged.maxBackoffMs,
      ...(options.signal  !== undefined ? { 'signal':  options.signal }  : {}),
      ...(options.headers !== undefined ? { 'headers': options.headers } : {}),
      'circuitBreaker': merged.circuitBreaker,
      'tokenBucket':    merged.tokenBucket,
    };
  }

  /**
   * Core request path: applies timeout, honours caller abort, retries
   * transient failures with exponential backoff through substrate `Retry`,
   * and optionally gates the logical request through substrate resilience
   * primitives. Returns the raw `Response` for callers that need the body
   * unparsed.
   */
  static async request(url: string, init: RequestInit, options: Partial<HttpRequestOptionsType> = {}): Promise<Response> {
    const resolved = HttpTransport.resolveOptions(options);
    const signal = Signal.compose({
      'deadlineMs': resolved.timeoutMs,
      ...(resolved.signal !== undefined ? { 'signal': resolved.signal } : {}),
    });
    const headers = HttpTransport.headersFor(init.headers, resolved.headers);
    const retry = HttpRetryPolicy.of(resolved, signal);

    const run = async (): Promise<Response> => {
      if (resolved.tokenBucket !== null && resolved.tokenBucket !== undefined) {
        await resolved.tokenBucket.waitForToken({ signal });
      }
      return retry.run(() => HttpTransport.fetchOnce(url, init, headers, signal, resolved.signal));
    };

    if (resolved.circuitBreaker !== null && resolved.circuitBreaker !== undefined) {
      return resolved.circuitBreaker.execute(run);
    }

    return run();
  }

  private static async decodeJson<TResponse>(
    response: Response,
    validator: EntityValidatorInterface<TResponse>,
  ): Promise<TResponse> {
    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      throw new ToolError('failed to parse JSON response', { 'reason': 'PARSE_ERROR', 'retryable': false, 'status': null, 'cause': err });
    }
    return OpenApiGuard.assertShape(body, validator, `HTTP body from ${response.url}`);
  }

  private static classifyStatus(status: number): HttpStatusClassificationType {
    if (status === 429) return { 'reason': 'RATE_LIMIT', 'retryable': true };
    if (status >= 500)  return { 'reason': 'HTTP_5XX',   'retryable': true };
    if (status >= 400)  return { 'reason': 'HTTP_4XX',   'retryable': false };
    return { 'reason': 'UNKNOWN', 'retryable': false };
  }

  private static async fetchOnce(
    url: string,
    init: RequestInit,
    headers: Record<string, string>,
    signal: AbortSignal,
    callerSignal: AbortSignal | undefined,
  ): Promise<Response> {
    if (signal.aborted) {
      throw HttpAbortSignals.errorFromSignal(signal);
    }

    try {
      const response = await fetch(url, { ...init, signal, headers });

      if (response.ok) return response;

      const classification = HttpTransport.classifyStatus(response.status);
      throw new ToolError(
        `HTTP ${String(response.status)} ${response.statusText} on ${url}`,
        { 'reason': classification.reason, 'retryable': classification.retryable, 'status': response.status },
      );
    } catch (err) {
      throw HttpTransport.transportError(url, err, signal, callerSignal);
    }
  }

  private static headersFor(initHeaders: RequestInit['headers'], optionHeaders: Record<string, string> | undefined): Record<string, string> {
    const headers: Record<string, string> = {};
    if (initHeaders !== undefined) {
      new Headers(initHeaders).forEach((value, key) => {
        headers[key] = value;
      });
    }
    if (optionHeaders !== undefined) {
      for (const [key, value] of Object.entries(optionHeaders)) headers[key] = value;
    }
    return headers;
  }

  private static transportError(
    url: string,
    err: unknown,
    signal: AbortSignal,
    callerSignal: AbortSignal | undefined,
  ): Error {
    if (err instanceof ToolError) return err;
    if (callerSignal?.aborted === true) {
      return new ToolError(`aborted fetching ${url}`, { 'reason': 'ABORTED', 'retryable': false, 'status': null, 'cause': err });
    }
    if (signal.aborted) {
      const reason: ToolErrorReasonType = HttpAbortSignals.isTimeoutSignal(signal) ? 'TIMEOUT' : 'ABORTED';
      return new ToolError(`${reason.toLowerCase()} fetching ${url}`, { reason, 'retryable': false, 'status': null, 'cause': err });
    }
    const isAbort  = (err instanceof DOMException && err.name === 'AbortError')
      || (err instanceof Error && err.name === 'AbortError');
    const reason: ToolErrorReasonType = isAbort ? 'TIMEOUT' : 'NETWORK';
    return new ToolError(`${reason.toLowerCase()} fetching ${url}`, { reason, 'retryable': true, 'status': null, 'cause': err });
  }

}
