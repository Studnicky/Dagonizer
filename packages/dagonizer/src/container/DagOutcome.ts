/**
 * DagOutcome: factory for `DagOutcomeInterface` values.
 *
 * A static class (`noun.verb()`) so outcome construction has one canonical
 * call site. `DagOutcome.transportError(correlationId, options?)` builds the
 * collected-error outcome the transport layer returns when a DAG never ran to a
 * terminal — a closed channel, a send failure, an unroutable error message, or
 * a worker/child that died without sending a result.
 *
 * The default `code` is `DAG_CONTAINER_TRANSPORT` (generic transport loss); the
 * default `message` interpolates `correlationId`. The returned outcome carries an
 * unrecoverable `NodeError` keyed to the `runDag` operation so the parent routes
 * the placement to its `error` output (embedded-DAG) or leaves the scatter item
 * un-acked for resume (the `TransportErrorCode.isInfrastructureFailure` path).
 */

import type { ExecutorIntermediate } from '../entities/executor/ExecutorIntermediate.js';
import type { JsonObject } from '../entities/json.js';
import type { NodeError } from '../entities/node/NodeError.js';

import { DAG_CONTAINER_TRANSPORT } from './TransportErrorCode.js';

// ---------------------------------------------------------------------------
// DagOutcomeInterface (entity-narrowing interface, lives in the same file as DagOutcome)
// ---------------------------------------------------------------------------

/**
 * DagOutcomeInterface: result returned by a `DagContainerInterface.runDag()`
 * call after an embedded DAG completes in an isolate.
 *
 * `terminalOutput`  — the routing output the child DAG resolved to (e.g. `'success'` | `'error'`).
 * `errors`          — collected errors from the child run (never thrown; always collected).
 * `stateSnapshot`   — terminal child state snapshot; `null` when the container cannot
 *                     produce a snapshot (e.g. transport failure). Parent calls
 *                     `cloneState.applySnapshot(stateSnapshot)` when non-null.
 * `intermediates`   — per-node results from the child DAG, forwarded to the parent
 *                     execution stream as intermediate yields.
 */
export interface DagOutcomeInterface {
  readonly terminalOutput: string;
  readonly errors: readonly NodeError[];
  readonly stateSnapshot: JsonObject | null;
  readonly intermediates: readonly ExecutorIntermediate[];
}

export class DagOutcome {
  private constructor() { /* static class */ }

  /**
   * Build a transport-error `DagOutcomeInterface`: `terminalOutput: 'failed'`
   * with a single unrecoverable `NodeError` carrying `code` and `message`.
   *
   * SC-12: required positional `correlationId`; optional trailing options bag
   * for `code` and `message` overrides.
   */
  static transportError(
    correlationId: string,
    options: { code?: string; message?: string } = {},
  ): DagOutcomeInterface {
    const code = options.code ?? DAG_CONTAINER_TRANSPORT;
    const message = options.message ?? `Transport failure for request ${correlationId}`;
    const error: NodeError = {
      'code': code,
      'message': message,
      'operation': 'runDag',
      'recoverable': false,
      'timestamp': new Date().toISOString(),
    };
    return {
      'terminalOutput': 'failed',
      'errors': [error],
      'stateSnapshot': null,
      'intermediates': [],
    };
  }
}

// Re-export DAG_CONTAINER_TRANSPORT so callers can pass a custom code without
// importing TransportErrorCode separately.
export { DAG_CONTAINER_TRANSPORT };
