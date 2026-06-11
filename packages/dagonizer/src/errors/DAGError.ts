import type { DAGErrorJSON } from '../entities/errors/DAGErrorJSON.js';

/**
 * Interface for DAGError class.
 *
 * Describes the runtime `DAGError` instance. The `toJSON()` method returns
 * `DAGErrorJSON`: the persistence/transport shape with an ISO-8601 string
 * timestamp. The class itself carries a `Date` timestamp and an Error-typed
 * `cause`, neither of which are JSON-expressible.
 */
export interface DAGErrorInterface extends Error {
  readonly 'code': string;
  readonly 'context': Record<string, unknown>;
  readonly 'timestamp': Date;
  readonly 'cause'?: Error;

  /**
   * Serialize to JSON. Returns the `DAGErrorJSON` wire shape.
   */
  toJSON(): DAGErrorJSON;
}

/** Module-level defaults for `DAGError` options. `cause` is not defaulted — it is a genuine optional sentinel. */
const DAG_ERROR_DEFAULTS = {
  'code':    'DAG_ERROR',
  'context': {} as Record<string, unknown>,
} as const;

/**
 * Error thrown by the DAG dispatcher for configuration or execution problems.
 */
export class DAGError extends Error implements DAGErrorInterface {
  readonly 'code': string;
  readonly 'context': Record<string, unknown>;
  readonly 'timestamp': Date;
  /** Narrowed from the base `Error.cause: unknown`; the dispatcher only ever chains `Error` causes. */
  declare readonly 'cause'?: Error;

  constructor(
    message: string,
    options: { code?: string; context?: Record<string, unknown>; cause?: Error } = {}
  ) {
    const { cause, ...rest } = options;
    const resolved = { ...DAG_ERROR_DEFAULTS, ...rest };
    super(message, cause !== undefined ? { 'cause': cause } : {});
    this.name = 'DAGError';
    this.code = resolved.code;
    this.context = resolved.context;
    this.timestamp = new Date();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): DAGErrorJSON {
    // Stable shape: all keys always present, `null` when absent.
    // Every serialized DAGError has the same hidden class for V8 stability.
    return {
      'cause': this.cause !== undefined
        ? {
            'message': this.cause.message,
            'name':    this.cause.name,
            'stack':   this.cause.stack ?? null,
          }
        : null,
      'code':      this.code,
      'context':   this.context,
      'message':   this.message,
      'name':      this.name,
      'stack':     this.stack ?? null,
      'timestamp': this.timestamp.toISOString(),
    };
  }
}

/**
 * Error thrown when flow or node configuration is invalid.
 */
export class ConfigurationError extends DAGError {
  constructor(message: string, options: { 'context'?: Record<string, unknown>; 'cause'?: Error } = {}) {
    super(message, { ...options, 'code': 'CONFIGURATION_ERROR' });
    this.name = 'ConfigurationError';
  }
}

/**
 * Error thrown during flow execution.
 */
export class ExecutionError extends DAGError {
  constructor(message: string, options: { 'context'?: Record<string, unknown>; 'cause'?: Error } = {}) {
    super(message, { ...options, 'code': 'EXECUTION_ERROR' });
    this.name = 'ExecutionError';
  }

  /**
   * Extract the abort reason from a signal, wrapping non-Error reasons in
   * `ExecutionError`. Used by scheduler and retry implementations that must
   * normalise AbortSignal.reason into a typed error.
   */
  static fromSignal(signal?: AbortSignal): Error {
    const reason = signal?.reason;
    if (reason instanceof Error) return reason;
    return new ExecutionError(typeof reason === 'string' ? reason : 'aborted');
  }
}

/**
 * Error thrown when a referenced node or flow is not found.
 */
export class NotFoundError extends DAGError {
  constructor(message: string, options: { 'context'?: Record<string, unknown>; 'cause'?: Error } = {}) {
    super(message, { ...options, 'code': 'NOT_FOUND_ERROR' });
    this.name = 'NotFoundError';
  }
}

/**
 * Error thrown when validation fails.
 */
export class ValidationError extends DAGError {
  constructor(message: string, options: { 'context'?: Record<string, unknown>; 'cause'?: Error } = {}) {
    super(message, { ...options, 'code': 'VALIDATION_ERROR' });
    this.name = 'ValidationError';
  }
}

/**
 * Error thrown when a node's per-node `timeoutMs` budget expires.
 *
 * Carries the node name and the budget that elapsed so callers can
 * distinguish node-level timeouts from run-level deadline exhaustion.
 */
export class NodeTimeoutError extends DAGError {
  readonly 'nodeName': string;
  readonly 'timeoutMs': number;

  constructor(nodeName: string, timeoutMs: number, options: { 'cause'?: Error } = {}) {
    super(
      `Node "${nodeName}" exceeded its ${String(timeoutMs)} ms timeout`,
      { 'code': 'NODE_TIMEOUT', 'context': { nodeName, timeoutMs }, ...options }
    );
    this.name = 'NodeTimeoutError';
    this.nodeName = nodeName;
    this.timeoutMs = timeoutMs;
  }
}
