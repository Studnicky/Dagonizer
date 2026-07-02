import { ModuleError } from '@studnicky/errors';

/** Empty context object: the canonical "no context" sentinel for `DAGError`. */
const EMPTY_CONTEXT: Record<string, unknown> = {};

/** Module-level defaults for `DAGError` options. `cause`/`statusCode` are not defaulted — genuine optional sentinels. */
const DAG_ERROR_DEFAULTS = {
  'code':      'DAG_ERROR',
  'context':   EMPTY_CONTEXT,
  'retryable': false,
} as const;

/**
 * Error thrown by the DAG dispatcher for configuration, execution,
 * validation, not-found, and node-timeout conditions alike.
 *
 * Extends `@studnicky/errors`'s `ModuleError`, gaining cause-chain
 * traversal (`findCauseOfType`, `getCauseChain`, `hasCauseOfType`) and a
 * `retryable` classification for free. `ModuleError`'s own constructor is
 * `protected`; `DAGError` exists to make it callable, with the same
 * option shape (`code`, `context`, `cause`, `retryable`, `statusCode`).
 *
 * Dagonizer's error taxonomy is ONE class distinguished by `.code`, not a
 * class hierarchy: every throw site uses `DAGError` with a `code` string
 * (`CONFIGURATION_ERROR`, `EXECUTION_ERROR`, `NOT_FOUND_ERROR`,
 * `VALIDATION_ERROR`, `NODE_TIMEOUT`); callers distinguish by `error.code`,
 * not `instanceof` on a subclass. Structured per-error data (e.g. a
 * timed-out node's name and budget) lives in `context`, not bespoke fields.
 *
 * `context` narrows `ModuleError`'s `Record<string, unknown> | undefined`
 * to a required `Record<string, unknown>` — `DAGError` always resolves a
 * context object, defaulting to `{}` (this repo does not carry optional/
 * undefined fields past a construction boundary).
 */
export class DAGError extends ModuleError {
  override readonly 'context': Record<string, unknown> = EMPTY_CONTEXT;

  constructor(
    message: string,
    options: {
      code?: string;
      context?: Record<string, unknown>;
      cause?: Error;
      retryable?: boolean;
      statusCode?: number;
    } = {}
  ) {
    const { cause, statusCode, ...rest } = options;
    const resolved = { ...DAG_ERROR_DEFAULTS, ...rest };
    super(message, {
      'cause':      cause,
      'code':       resolved.code,
      'context':    resolved.context,
      'retryable':  resolved.retryable,
      'statusCode': statusCode,
    });
    this.name = 'DAGError';
    this.context = resolved.context;
  }

  /**
   * Extract the abort reason from a signal, wrapping non-Error reasons in
   * `DAGError` (code `EXECUTION_ERROR`). Used by scheduler and retry
   * implementations that must normalise `AbortSignal.reason` into a typed
   * error.
   */
  static ofSignal(signal?: AbortSignal): Error {
    const reason = signal?.reason;
    if (reason instanceof Error) return reason;
    return new DAGError(typeof reason === 'string' ? reason : 'aborted', { 'code': 'EXECUTION_ERROR' });
  }

  /**
   * Normalise an unknown catch-clause value into an `Error`, wrapping
   * non-Error causes in `DAGError` (code `EXECUTION_ERROR`).
   */
  static coerce(cause: unknown): Error {
    if (cause instanceof Error) return cause;
    return new DAGError(String(cause), { 'code': 'EXECUTION_ERROR' });
  }

  /**
   * Extract a message string from an unknown catch-clause value: the
   * `Error`'s own message, or the value's string coercion.
   */
  static messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * True when `reason` is an `Error` named `TimeoutError` — the shape
   * produced by `AbortSignal.timeout()` rejections.
   */
  static isTimeout(reason: unknown): boolean {
    return reason instanceof Error && reason.name === 'TimeoutError';
  }
}
