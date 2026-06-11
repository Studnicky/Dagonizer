/**
 * ToolError: narrow error class for tool-execution failures.
 *
 * Tools throw `ToolError` so the dispatcher can route to the
 * appropriate output port without losing the failure classification.
 * The `reason` field mirrors the LLM-side classification taxonomy in
 * `@noocodex/dagonizer/adapter`'s `LlmError` so downstream observability
 * sees a consistent vocabulary regardless of whether the failure was
 * model-side or tool-side.
 */

export type ToolErrorReason =
  | 'NETWORK'
  | 'HTTP_4XX'
  | 'HTTP_5XX'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'INVALID_INPUT'
  | 'UNKNOWN';

export interface ToolErrorOptions {
  reason: ToolErrorReason;
  retryable: boolean;
  /** HTTP status code. Omit (or null) when no HTTP status applies; defaults to null. */
  status?: number | null;
  /** Cause chain: original error if wrapped. */
  cause?: unknown;
}

export class ToolError extends Error {
  readonly reason: ToolErrorReason;
  readonly retryable: boolean;
  // Always initialised (null = no HTTP status) so every ToolError instance
  // shares one stable V8 hidden class; declaration order matches assignment.
  readonly status: number | null;

  constructor(message: string, options: ToolErrorOptions) {
    const opts: ErrorOptions = {};
    if (options.cause !== undefined) opts.cause = options.cause;
    super(message, opts);
    this.name = 'ToolError';
    this.reason = options.reason;
    this.retryable = options.retryable;
    this.status = options.status ?? null;
  }
}
