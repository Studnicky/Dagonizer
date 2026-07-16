/**
 * DagOutcome: factory for `DagOutcomeType` values.
 *
 * A static class (`noun.verb()`) so outcome construction has one canonical
 * call site. `DagOutcome.transportError(id, correlationId, options?)` builds
 * the collected-error result the transport layer returns when a DAG never ran
 * to a terminal — a closed channel, a send failure, an unroutable error
 * message, or a worker/child that died without sending a result.
 *
 * The default `code` is `DAG_CONTAINER_TRANSPORT` (generic transport loss); the
 * default `message` interpolates `correlationId`. The returned result carries an
 * unrecoverable `NodeError` keyed to the `runDag` operation so the parent routes
 * the placement to its `error` output (embedded-DAG) or leaves the scatter item
 * un-acked for resume (the `TransportErrorCode.isInfrastructureFailure` path).
 *
 * `RunResultType` is the per-item result returned by `DagContainerBase.runDag`.
 * Each entry carries the item `id` alongside the full `DagOutcomeType` for
 * that item, including its `terminalOutput`, `errors`, graph state, and
 * `intermediates`. Every `runDag` call is a batch call — a single item is a
 * batch of one through the identical path, so this is the only result shape.
 */

import type { DagOutcomeType, RunResultType } from '../contracts/DagOutcomeType.js';
import { NodeError } from '../entities/node/NodeError.js';
import type { NodeErrorWireType } from '../entities/node/NodeError.js';

import { DAG_CONTAINER_TRANSPORT } from './TransportErrorCode.js';

export type { DagOutcomeType, RunResultType };

export class DagOutcome {
  private constructor() { /* static class */ }

  /**
   * Build a transport-error `RunResultType`: `terminalOutput: 'failed'`
   * with a single unrecoverable `NodeError` carrying `code` and `message`.
   * Used when the transport fails before the host can process the item.
   *
   * SC-12: required positional `id`, `correlationId`; optional trailing
   * options object for `code` and `message` overrides.
   */
  static transportError(
    id: string,
    correlationId: string,
    options: { code?: string; message?: string } = {},
  ): RunResultType {
    const code = options.code ?? DAG_CONTAINER_TRANSPORT;
    const message = options.message ?? `Transport failure for request ${correlationId}`;
    const error: NodeErrorWireType = NodeError.create(
      code,
      message,
      'runDag',
      false,
      new Date().toISOString(),
    );
    return {
      'id': id,
      'terminalOutput': 'failed',
      'errors': [error],
      'intermediates': [],
    };
  }
}

// Re-export DAG_CONTAINER_TRANSPORT so callers can pass a custom code without
// importing TransportErrorCode separately.
export { DAG_CONTAINER_TRANSPORT };
