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
 *
 * `BatchRunResult` is the per-item result returned by `DagContainerBase.runDagBatch`.
 * Each entry carries the item `id` alongside the full `DagOutcomeInterface` for
 * that item, including its `terminalOutput`, `errors`, `stateSnapshot`, and
 * `intermediates`.
 */

import type { DagOutcomeInterface } from '../contracts/DagOutcomeInterface.js';
import { NodeErrorBuilder } from '../entities/node/NodeError.js';
import type { NodeError } from '../entities/node/NodeError.js';

import { DAG_CONTAINER_TRANSPORT } from './TransportErrorCode.js';

export type { DagOutcomeInterface };

/**
 * Per-item result from a batch DAG execution (`runDagBatch`).
 * Carries the item `id` so callers can correlate results back to input items.
 */
export interface BatchRunResult extends DagOutcomeInterface {
  readonly id: string;
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
    const error: NodeError = NodeErrorBuilder.from(
      code,
      message,
      'runDag',
      false,
      new Date().toISOString(),
    );
    return {
      'terminalOutput': 'failed',
      'errors': [error],
      'stateSnapshot': null,
      'intermediates': [],
    };
  }

  /**
   * Build a transport-error `BatchRunResult` for a single item. Used when the
   * batch transport fails before the host can process the item.
   */
  static batchItemTransportError(
    id: string,
    correlationId: string,
    options: { code?: string; message?: string } = {},
  ): BatchRunResult {
    const outcome = DagOutcome.transportError(correlationId, options);
    return {
      'id': id,
      'terminalOutput': outcome.terminalOutput,
      'errors': outcome.errors,
      'stateSnapshot': outcome.stateSnapshot,
      'intermediates': outcome.intermediates,
    };
  }
}

// Re-export DAG_CONTAINER_TRANSPORT so callers can pass a custom code without
// importing TransportErrorCode separately.
export { DAG_CONTAINER_TRANSPORT };
