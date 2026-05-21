import type { DAGErrorJSON } from '../entities/errors/DAGErrorJSON.js';

/**
 * Interface for DAGError class.
 *
 * Describes the runtime `DAGError` instance. The `toJSON()` method returns
 * `DAGErrorJSON` — the persistence/transport shape with an ISO-8601 string
 * timestamp. The class itself carries a `Date` timestamp and an Error-typed
 * `cause`, neither of which are JSON-expressible.
 */
export interface DAGErrorInterface extends Error {
  readonly 'code': string;
  readonly 'context'?: Record<string, unknown>;
  readonly 'timestamp': Date;

  /**
   * Serialize to JSON. Returns the `DAGErrorJSON` wire shape.
   */
  toJSON(): DAGErrorJSON;
}

/**
 * Error thrown by the DAG dispatcher for configuration or execution problems.
 */
export class DAGError extends Error implements DAGErrorInterface {
  readonly 'code': string;
  readonly 'context'?: Record<string, unknown>;
  readonly 'timestamp': Date;

  constructor(
    message: string,
    code = 'DAG_ERROR',
    context?: Record<string, unknown>,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'DAGError';
    this.code = code;
    this.timestamp = new Date();
    if (context !== undefined) {
      this.context = context;
    }
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): DAGErrorJSON {
    return {
      ...(this.cause !== undefined && {
        'cause': this.cause instanceof Error
          ? {
            'message': this.cause.message,
            'name': this.cause.name,
            'stack': this.cause.stack
          }
          : this.cause
      }),
      'code': this.code,
      ...(this.context !== undefined && { 'context': this.context }),
      'message': this.message,
      'name': this.name,
      ...(this.stack !== undefined && { 'stack': this.stack }),
      'timestamp': this.timestamp.toISOString()
    };
  }
}

/**
 * Error thrown when flow or node configuration is invalid.
 */
export class ConfigurationError extends DAGError {
  constructor(message: string, context?: Record<string, unknown>, options?: ErrorOptions) {
    super(message, 'CONFIGURATION_ERROR', context, options);
    this.name = 'ConfigurationError';
  }
}

/**
 * Error thrown during flow execution.
 */
export class ExecutionError extends DAGError {
  constructor(message: string, context?: Record<string, unknown>, options?: ErrorOptions) {
    super(message, 'EXECUTION_ERROR', context, options);
    this.name = 'ExecutionError';
  }
}

/**
 * Error thrown when a referenced node or flow is not found.
 */
export class NotFoundError extends DAGError {
  constructor(message: string, context?: Record<string, unknown>, options?: ErrorOptions) {
    super(message, 'NOT_FOUND_ERROR', context, options);
    this.name = 'NotFoundError';
  }
}

/**
 * Error thrown when validation fails.
 */
export class ValidationError extends DAGError {
  constructor(message: string, context?: Record<string, unknown>, options?: ErrorOptions) {
    super(message, 'VALIDATION_ERROR', context, options);
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

  constructor(nodeName: string, timeoutMs: number, options?: ErrorOptions) {
    super(
      `Node "${nodeName}" exceeded its ${String(timeoutMs)} ms timeout`,
      'NODE_TIMEOUT',
      { nodeName, timeoutMs },
      options,
    );
    this.name = 'NodeTimeoutError';
    this.nodeName = nodeName;
    this.timeoutMs = timeoutMs;
  }
}
