/**
 * DagOutcome: factory for `DagOutcomeInterface` values.
 *
 * A static class (`noun.verb()`) so outcome construction has one canonical
 * call site. `DagOutcome.transportError(requestId, code?, message?)` builds the
 * collected-error outcome the transport layer returns when a DAG never ran to a
 * terminal — a closed channel, a send failure, an unroutable error message, or
 * a worker/child that died without sending a result.
 *
 * The default `code` is `DAG_CONTAINER_TRANSPORT` (generic transport loss); the
 * default `message` interpolates `requestId`. The returned outcome carries an
 * unrecoverable `NodeError` keyed to the `runDag` operation so the parent routes
 * the placement to its `error` output (embedded-DAG) or leaves the scatter item
 * un-acked for resume (the `TransportErrorCode.isInfrastructureFailure` path).
 */

import type { DagOutcomeInterface } from '../contracts/DagOutcomeInterface.js';
import type { NodeError } from '../entities/node/NodeError.js';

import { DAG_CONTAINER_TRANSPORT } from './TransportErrorCode.js';

export class DagOutcome {
  private constructor() { /* static class */ }

  /**
   * Build a transport-error `DagOutcomeInterface`: `terminalOutput: 'failed'`
   * with a single unrecoverable `NodeError` carrying `code` and `message`.
   */
  static transportError(
    requestId: string,
    code: string = DAG_CONTAINER_TRANSPORT,
    message: string = `Transport failure for request ${requestId}`,
  ): DagOutcomeInterface {
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
