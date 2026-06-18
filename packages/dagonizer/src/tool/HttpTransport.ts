/**
 * HttpTransport: shared fetch wrapper for tool packages.
 *
 * Every HTTP-backed tool (OpenLibrary, Google Books, Wikipedia, …)
 * needs the same boilerplate: abort propagation, per-request timeout,
 * retry on transient errors (network, 5xx, 429), JSON parsing,
 * classification of failures into `ToolError`. Consolidating that here
 * keeps every tool class thin: a concrete tool's `execute()` method is
 * roughly: build the URL, hand off to `HttpTransport.getJson(...)`,
 * map the response.
 *
 * Static class per project standards (`noun.verb()`). No constructor,
 * no instance state.
 *
 * The parsed JSON body crosses a foreign boundary as `unknown` and is
 * narrowed by a caller-supplied schema-backed `EntityValidator` before it
 * is returned. Because the framework uses forced tool-calling, every
 * caller's expected shape is known at the call site, so the validator is
 * required — there is no unchecked-cast path. A shape mismatch throws a
 * non-retryable `ToolError(PARSE_ERROR)`.
 */

import type { EntityValidator } from '../validation/Validator.js';

import { OpenApiGuard } from './OpenApiGuard.js';
import { ToolError, type ToolErrorReason } from './ToolError.js';

/** Named return type for HTTP status classification. */
export interface HttpStatusClassification {
  reason: ToolErrorReason;
  retryable: boolean;
}

export interface HttpRequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Per-request deadline in ms. */
  timeoutMs: number;
  /** Maximum retry attempts on transient errors (3 total tries at default 2). */
  maxRetries: number;
}

const DEFAULT_TIMEOUT_MS  = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const BASE_BACKOFF_MS     = 400;

/** Canonical defaults for the two defaultable fields of `HttpRequestOptions`. */
const HTTP_REQUEST_DEFAULTS = {
  'timeoutMs':  DEFAULT_TIMEOUT_MS,
  'maxRetries': DEFAULT_MAX_RETRIES,
} as const;

export class HttpTransport {
  private constructor() { /* static class */ }

  /**
   * GET → JSON body narrowed by `validator`. Throws `ToolError` on
   * transport failure or on a schema mismatch (`PARSE_ERROR`).
   */
  static async getJson<TResponse>(
    url: string,
    validator: EntityValidator<TResponse>,
    options: Partial<HttpRequestOptions> = {},
  ): Promise<TResponse> {
    const resolved = HttpTransport.resolveOptions(options);
    const response = await HttpTransport.request(url, { 'method': 'GET' }, resolved);
    return HttpTransport.parseJson<TResponse>(response, validator);
  }

  /**
   * POST a JSON body → JSON body narrowed by `validator`. Throws
   * `ToolError` on transport failure or on a schema mismatch (`PARSE_ERROR`).
   */
  static async postJson<TResponse>(
    url: string,
    body: unknown,
    validator: EntityValidator<TResponse>,
    options: Partial<HttpRequestOptions> = {},
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
    return HttpTransport.parseJson<TResponse>(response, validator);
  }

  /** Merge caller-supplied partial options with the module defaults. */
  private static resolveOptions(options: Partial<HttpRequestOptions>): HttpRequestOptions {
    const merged = { ...HTTP_REQUEST_DEFAULTS, ...options };
    return {
      'timeoutMs':  merged.timeoutMs,
      'maxRetries': merged.maxRetries,
      ...(options.signal  !== undefined ? { 'signal':  options.signal }  : {}),
      ...(options.headers !== undefined ? { 'headers': options.headers } : {}),
    };
  }

  /**
   * Core request loop: applies timeout, honours caller abort, retries
   * transient failures with exponential backoff. Returns the raw
   * `Response` for callers that need the body unparsed.
   */
  static async request(url: string, init: RequestInit, options: Partial<HttpRequestOptions> = {}): Promise<Response> {
    const resolved = HttpTransport.resolveOptions(options);
    const timeoutMs  = resolved.timeoutMs;
    const maxRetries = resolved.maxRetries;

    let attempt = 0;
    let lastError: ToolError | null = null;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(new ToolError('timeout', { 'reason': 'TIMEOUT', 'retryable': true, 'status': null })), timeoutMs);
      const signal = AbortSignal.any([controller.signal, ...(resolved.signal !== undefined ? [resolved.signal] : [])]);

      const headers: Record<string, string> = {};
      if (init.headers !== undefined) {
        for (const [k, v] of Object.entries(init.headers)) headers[k] = String(v);
      }
      if (resolved.headers !== undefined) {
        for (const [k, v] of Object.entries(resolved.headers)) headers[k] = v;
      }

      try {
        const response = await fetch(url, { ...init, signal, headers });
        clearTimeout(timeoutId);

        if (response.ok) return response;

        const classification = HttpTransport.classifyStatus(response.status);
        lastError = new ToolError(
          `HTTP ${String(response.status)} ${response.statusText} on ${url}`,
          { 'reason': classification.reason, 'retryable': classification.retryable, 'status': response.status },
        );
        if (!classification.retryable || attempt === maxRetries) throw lastError;
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof ToolError) {
          lastError = err;
          if (!err.retryable || attempt === maxRetries) throw err;
        } else {
          const isAbort  = (err instanceof DOMException && err.name === 'AbortError')
            || (err instanceof Error && err.name === 'AbortError');
          const callerAbort = resolved.signal?.aborted === true;
          const reason: ToolErrorReason = callerAbort ? 'ABORTED' : isAbort ? 'TIMEOUT' : 'NETWORK';
          const retryable = !callerAbort && reason !== 'ABORTED';
          lastError = new ToolError(`${reason.toLowerCase()} fetching ${url}`, { reason, retryable, 'status': null, 'cause': err });
          if (!retryable || attempt === maxRetries) throw lastError;
        }
      }

      // Exponential backoff before next attempt. Abort-aware: if the caller
      // cancels during the sleep, reject immediately rather than hanging.
      const delay = BASE_BACKOFF_MS * 2 ** attempt;
      await HttpTransport.#abortAwareSleep(delay, resolved.signal);
      attempt++;
    }

    // Loop exits via throw; this is unreachable but TypeScript needs it.
    throw lastError ?? new ToolError(`request failed after ${String(maxRetries)} retries: ${url}`, { 'reason': 'UNKNOWN', 'retryable': false, 'status': null });
  }

  private static async parseJson<TResponse>(
    response: Response,
    validator: EntityValidator<TResponse>,
  ): Promise<TResponse> {
    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      throw new ToolError('failed to parse JSON response', { 'reason': 'PARSE_ERROR', 'retryable': false, 'status': null, 'cause': err });
    }
    return OpenApiGuard.assertShape(body, validator, `HTTP body from ${response.url}`);
  }

  private static classifyStatus(status: number): HttpStatusClassification {
    if (status === 429) return { 'reason': 'RATE_LIMIT', 'retryable': true };
    if (status >= 500)  return { 'reason': 'HTTP_5XX',   'retryable': true };
    if (status >= 400)  return { 'reason': 'HTTP_4XX',   'retryable': false };
    return { 'reason': 'UNKNOWN', 'retryable': false };
  }

  /**
   * Sleep for `ms` milliseconds, but abort immediately if `signal` fires.
   * On abort, rejects with a non-retryable `ToolError` so the retry loop
   * does not hang until the timeout expires.
   */
  static async #abortAwareSleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) {
      throw new ToolError('request aborted during backoff', { 'reason': 'ABORTED', 'retryable': false, 'status': null });
    }
    return new Promise<void>((resolve, reject) => {
      const timerId = setTimeout(resolve, ms);
      if (signal === undefined) return;
      const onAbort = (): void => {
        clearTimeout(timerId);
        signal.removeEventListener('abort', onAbort);
        reject(new ToolError('request aborted during backoff', { 'reason': 'ABORTED', 'retryable': false, 'status': null }));
      };
      signal.addEventListener('abort', onAbort, { 'once': true });
    });
  }
}
