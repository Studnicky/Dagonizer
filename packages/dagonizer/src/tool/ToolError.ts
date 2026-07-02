/**
 * ToolError: narrow error class for tool-execution failures.
 *
 * Tools throw `ToolError` so the dispatcher can route to the
 * appropriate output port without losing the failure classification.
 * The `reason` field mirrors the LLM-side classification taxonomy in
 * `@studnicky/dagonizer/adapter`'s `LlmError` so downstream observability
 * sees a consistent vocabulary regardless of whether the failure was
 * model-side or tool-side.
 *
 * Extends `DAGError` (code `'TOOL_ERROR'`) so `instanceof DAGError` holds for
 * every tool failure and the dispatcher's framework-error guards classify it
 * uniformly alongside `StoreError` and every other `DAGError`-coded failure.
 */

import { DAGError } from '../errors/DAGError.js';

export type ToolErrorReasonType =
  | 'NETWORK'
  | 'HTTP_4XX'
  | 'HTTP_5XX'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'INVALID_INPUT'
  | 'ABORTED'
  | 'UNKNOWN';

export type ToolErrorOptionsType = {
  reason: ToolErrorReasonType;
  retryable: boolean;
  /** HTTP status code. Omit (or null) when no HTTP status applies; defaults to null. */
  status?: number | null;
  /** Cause chain: original error if wrapped. */
  cause?: unknown;
}

export class ToolError extends DAGError {
  readonly reason: ToolErrorReasonType;
  // Always initialised (null = no HTTP status) so every ToolError instance
  // shares one stable V8 hidden class; declaration order matches assignment.
  readonly status: number | null;

  constructor(message: string, options: ToolErrorOptionsType) {
    super(message, {
      'code': 'TOOL_ERROR',
      'retryable': options.retryable,
      ...(options.cause instanceof Error && { 'cause': options.cause }),
    });
    this.name = 'ToolError';
    this.reason = options.reason;
    this.status = options.status ?? null;
  }
}
