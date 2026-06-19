/**
 * LlmError: error taxonomy + classifier helpers.
 *
 * Defines the set of reasons an LLM invocation can fail and provides
 * static helpers for classifying HTTP errors and network failures.
 * Every adapter classifies its provider-native error into one of these
 * reasons; the shared retry wrapper then decides whether to retry based
 * on the `retryable` flag.
 */

export type LlmErrorReasonType =
  | 'AUTH_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'QUOTA_EXHAUSTED'
  | 'CREDIT_EXHAUSTED'
  | 'TIMEOUT'
  | 'SCHEMA_VIOLATION'
  | 'NETWORK'
  | 'CONFIGURATION'
  | 'NO_ADAPTER_AVAILABLE'
  | 'UNKNOWN';

/**
 * Classification of an LLM error. Discriminated union on `retryable`:
 *   - Retryable classifications carry `retryAfterMs: number | null`
 *     (`null` means no provider hint; the caller uses its own backoff).
 *   - Non-retryable classifications omit `retryAfterMs` entirely so
 *     call sites never need to coalesce a value that has no meaning.
 */
export type ErrorClassificationType =
  | { readonly reason: LlmErrorReasonType; readonly retryable: true;  readonly retryAfterMs: number | null }
  | { readonly reason: LlmErrorReasonType; readonly retryable: false };

/**
 * Cap on how long a `QUOTA_EXHAUSTED` `Retry-After` hint is honored. Past this,
 * the adapter gives up immediately rather than blocking the caller. Shared by
 * `BaseAdapter` and `BaseEmbedder`.
 */
export const MAX_QUOTA_WAIT_MS = 10_000;

/** Canonical classification constants. Retryable entries carry `retryAfterMs: null` (no provider hint). */
export const Classifications: Readonly<Record<LlmErrorReasonType, ErrorClassificationType>> = {
  'AUTH_FAILED':          { 'reason': 'AUTH_FAILED',          'retryable': false },
  'MODEL_NOT_FOUND':      { 'reason': 'MODEL_NOT_FOUND',      'retryable': false },
  'QUOTA_EXHAUSTED':      { 'reason': 'QUOTA_EXHAUSTED',      'retryable': true,  'retryAfterMs': null },
  'CREDIT_EXHAUSTED':     { 'reason': 'CREDIT_EXHAUSTED',     'retryable': false },
  'TIMEOUT':              { 'reason': 'TIMEOUT',              'retryable': true,  'retryAfterMs': null },
  'SCHEMA_VIOLATION':     { 'reason': 'SCHEMA_VIOLATION',     'retryable': false },
  'NETWORK':              { 'reason': 'NETWORK',              'retryable': true,  'retryAfterMs': null },
  'CONFIGURATION':        { 'reason': 'CONFIGURATION',        'retryable': false },
  'NO_ADAPTER_AVAILABLE': { 'reason': 'NO_ADAPTER_AVAILABLE', 'retryable': false },
  'UNKNOWN':              { 'reason': 'UNKNOWN',              'retryable': false },
};

export class LlmError extends Error {
  readonly classification: ErrorClassificationType;

  constructor(message: string, classification: ErrorClassificationType, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { 'cause': options.cause } : undefined);
    this.name = 'LlmError';
    this.classification = classification;
  }

  /**
   * Classify an HTTP-shaped error from status + body. Most provider
   * adapters can lean on this and only override the cases their wire
   * format complicates.
   */
  static classifyHttp(status: number, options?: { body?: string }): ErrorClassificationType {
    if (status === 401 || status === 403) return Classifications['AUTH_FAILED'];
    if (status === 404) return Classifications['MODEL_NOT_FOUND'];
    if (status === 402) return Classifications['CREDIT_EXHAUSTED'];
    if (status === 408 || status === 504) return Classifications['TIMEOUT'];
    if (status === 422) return Classifications['SCHEMA_VIOLATION'];
    if (status === 429) {
      const body = options?.body;
      const retryAfter = body !== undefined ? LlmError.#extractRetryAfterSeconds(body) : undefined;
      if (retryAfter !== undefined) {
        return { 'reason': 'QUOTA_EXHAUSTED', 'retryable': true, 'retryAfterMs': retryAfter * 1000 };
      }
      return Classifications['QUOTA_EXHAUSTED']; // retryAfterMs: null (no hint)
    }
    if (status >= 500 && status < 600) return Classifications['NETWORK'];
    return Classifications['UNKNOWN'];
  }

  /** Wrap a `fetch()` rejection in an `LlmError` with NETWORK classification. */
  static ofNetworkError(err: unknown): LlmError {
    const message = err instanceof Error ? err.message : String(err);
    return new LlmError(`network: ${message}`, Classifications['NETWORK'], { 'cause': err });
  }

  /** Extract a human-readable message from any thrown value. */
  static messageFrom(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  static #extractRetryAfterSeconds(body: string): number | undefined {
    const m = /"retry[-_]?after[^"]*"\s*:\s*"?(\d+(?:\.\d+)?)"?/iu.exec(body);
    if (m === null || m[1] === undefined) return undefined;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : undefined;
  }
}
