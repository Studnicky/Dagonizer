/**
 * HttpTransport: shared fetch wrapper for tool packages.
 *
 * Every HTTP-backed tool (OpenLibrary, Google Books, Wikipedia, …)
 * needs the same boilerplate: abort propagation, per-request timeout,
 * retry on transient errors (network, 5xx, 429), JSON parsing,
 * classification of failures into `ToolError`. Consolidating that here
 * keeps every tool package thin: `OpenLibrarySearchTool.search(...)`
 * is roughly: build the URL, hand off to `HttpTransport.getJson(...)`,
 * map the response.
 *
 * Static class per project standards (`noun.verb()`). No constructor,
 * no instance state.
 */

import { ToolError, type ToolErrorReason } from './ToolError.js';

export interface HttpRequestOptions {
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  /** Per-request deadline. Defaults to 30 seconds. */
  readonly timeoutMs?: number;
  /** Maximum retry attempts on transient errors. Defaults to 2 (3 total tries). */
  readonly maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS  = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const BASE_BACKOFF_MS     = 400;

export class HttpTransport {
  private constructor() { /* static class */ }

  /** GET → parsed JSON. Throws `ToolError` on failure. */
  static async getJson<TResponse>(url: string, options: HttpRequestOptions = {}): Promise<TResponse> {
    const response = await HttpTransport.request(url, { 'method': 'GET' }, options);
    return HttpTransport.parseJson<TResponse>(response);
  }

  /** POST a JSON body → parsed JSON. Throws `ToolError` on failure. */
  static async postJson<TResponse>(
    url: string,
    body: unknown,
    options: HttpRequestOptions = {},
  ): Promise<TResponse> {
    const response = await HttpTransport.request(
      url,
      {
        'method':  'POST',
        'body':    JSON.stringify(body),
        'headers': { 'content-type': 'application/json' },
      },
      options,
    );
    return HttpTransport.parseJson<TResponse>(response);
  }

  /**
   * Core request loop: applies timeout, honours caller abort, retries
   * transient failures with exponential backoff. Returns the raw
   * `Response` for callers that need the body unparsed.
   */
  static async request(url: string, init: RequestInit, options: HttpRequestOptions = {}): Promise<Response> {
    const timeoutMs  = options.timeoutMs  ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

    let attempt = 0;
    let lastError: ToolError | null = null;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(new ToolError('timeout', { 'reason': 'TIMEOUT', 'retryable': true })), timeoutMs);
      const signal = AbortSignal.any([controller.signal, ...(options.signal !== undefined ? [options.signal] : [])]);

      const headers: Record<string, string> = {};
      if (init.headers !== undefined) {
        for (const [k, v] of Object.entries(init.headers)) headers[k] = String(v);
      }
      if (options.headers !== undefined) {
        for (const [k, v] of Object.entries(options.headers)) headers[k] = v;
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
          const callerAbort = options.signal?.aborted === true;
          const reason: ToolErrorReason = callerAbort ? 'UNKNOWN' : isAbort ? 'TIMEOUT' : 'NETWORK';
          const retryable = !callerAbort && reason !== 'UNKNOWN';
          lastError = new ToolError(`${reason.toLowerCase()} fetching ${url}`, { reason, retryable, 'cause': err });
          if (!retryable || attempt === maxRetries) throw lastError;
        }
      }

      // Exponential backoff before next attempt. Abort-aware: if the caller
      // cancels during the sleep, reject immediately rather than hanging.
      const delay = BASE_BACKOFF_MS * 2 ** attempt;
      await HttpTransport.#abortAwareSleep(delay, options.signal);
      attempt++;
    }

    // Loop exits via throw; this is unreachable but TypeScript needs it.
    throw lastError ?? new ToolError(`request failed after ${String(maxRetries)} retries: ${url}`, { 'reason': 'UNKNOWN', 'retryable': false });
  }

  private static async parseJson<TResponse>(response: Response): Promise<TResponse> {
    try {
      return await response.json() as TResponse;
    } catch (err) {
      throw new ToolError('failed to parse JSON response', { 'reason': 'PARSE_ERROR', 'retryable': false, 'cause': err });
    }
  }

  private static classifyStatus(status: number): { reason: ToolErrorReason; retryable: boolean } {
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
      throw new ToolError('request aborted during backoff', { 'reason': 'UNKNOWN', 'retryable': false });
    }
    return new Promise<void>((resolve, reject) => {
      const timerId = setTimeout(resolve, ms);
      if (signal === undefined) return;
      const onAbort = (): void => {
        clearTimeout(timerId);
        signal.removeEventListener('abort', onAbort);
        reject(new ToolError('request aborted during backoff', { 'reason': 'UNKNOWN', 'retryable': false }));
      };
      signal.addEventListener('abort', onAbort, { 'once': true });
    });
  }
}
