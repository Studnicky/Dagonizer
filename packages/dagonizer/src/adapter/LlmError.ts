/**
 * LlmError — error taxonomy + classifier helpers.
 *
 * Mirrors nocturne's `LLMInvocationError` (`adapters/llm/...
 * LLMInvocationError.ts:30–146`) trimmed to the categories the
 * Archivist's adapters surface. Every adapter classifies its
 * provider-native error into one of these reasons; the shared retry
 * wrapper then decides whether to retry based on the `retryable` flag.
 */

export type LlmErrorReason =
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

export interface ErrorClassification {
  readonly reason: LlmErrorReason;
  readonly retryable: boolean;
  /** Suggested next attempt delay in ms (provider may surface Retry-After). */
  readonly retryAfterMs?: number;
}

export class LlmError extends Error {
  readonly classification: ErrorClassification;

  constructor(message: string, classification: ErrorClassification, cause?: unknown) {
    super(message);
    this.name = 'LlmError';
    this.classification = classification;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * Cap on how long a `QUOTA_EXHAUSTED` `Retry-After` hint is honored. Past this,
 * the adapter gives up immediately rather than blocking the caller. Shared by
 * `BaseAdapter` and `BaseEmbedder`.
 */
export const MAX_QUOTA_WAIT_MS = 10_000;

/** Mark a fact-of-life classification. Used by adapters that already know. */
export const Classifications: Readonly<Record<LlmErrorReason, ErrorClassification>> = {
  'AUTH_FAILED':       { 'reason': 'AUTH_FAILED',       'retryable': false },
  'MODEL_NOT_FOUND':   { 'reason': 'MODEL_NOT_FOUND',   'retryable': false },
  'QUOTA_EXHAUSTED':   { 'reason': 'QUOTA_EXHAUSTED',   'retryable': true  },
  'CREDIT_EXHAUSTED':  { 'reason': 'CREDIT_EXHAUSTED',  'retryable': false },
  'TIMEOUT':           { 'reason': 'TIMEOUT',           'retryable': true  },
  'SCHEMA_VIOLATION':  { 'reason': 'SCHEMA_VIOLATION',  'retryable': true  },
  'NETWORK':              { 'reason': 'NETWORK',              'retryable': true  },
  'CONFIGURATION':        { 'reason': 'CONFIGURATION',        'retryable': false },
  'NO_ADAPTER_AVAILABLE': { 'reason': 'NO_ADAPTER_AVAILABLE', 'retryable': false },
  'UNKNOWN':              { 'reason': 'UNKNOWN',              'retryable': false },
};

/**
 * Classify an HTTP-shaped error from status + body. Most provider
 * adapters can lean on this and only override the cases their wire
 * format complicates.
 */
export function classifyHttp(status: number, body?: string): ErrorClassification {
  if (status === 401 || status === 403) return Classifications['AUTH_FAILED'];
  if (status === 404) return Classifications['MODEL_NOT_FOUND'];
  if (status === 402) return Classifications['CREDIT_EXHAUSTED'];
  if (status === 408 || status === 504) return Classifications['TIMEOUT'];
  if (status === 422) return Classifications['SCHEMA_VIOLATION'];
  if (status === 429) {
    const retryAfter = body !== undefined ? extractRetryAfterSeconds(body) : undefined;
    if (retryAfter !== undefined) {
      return { 'reason': 'QUOTA_EXHAUSTED', 'retryable': true, 'retryAfterMs': retryAfter * 1000 };
    }
    return Classifications['QUOTA_EXHAUSTED'];
  }
  if (status >= 500 && status < 600) return Classifications['NETWORK'];
  return Classifications['UNKNOWN'];
}

function extractRetryAfterSeconds(body: string): number | undefined {
  const m = /"retry[-_]?after[^"]*"\s*:\s*"?(\d+(?:\.\d+)?)"?/iu.exec(body);
  if (m === null || m[1] === undefined) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** Convenience: rethrow a `fetch()` error wrapped in an LlmError. */
export function asNetworkError(err: unknown): LlmError {
  const message = err instanceof Error ? err.message : String(err);
  return new LlmError(`network: ${message}`, Classifications['NETWORK'], err);
}
