/**
 * TransportErrorCode: canonical NodeError.code values for container
 * infrastructure failures.
 *
 * These codes mark a `DagOutcomeInterface` whose DAG never ran to a terminal
 * because the transport itself failed — a closed channel, a send failure, an
 * unroutable message, or a worker/child that died without sending a result.
 * They are the discriminator the parent uses to tell an INFRASTRUCTURE failure
 * (retryable: leave the scatter item un-acked for resume) apart from a
 * LEGITIMATE body-error outcome (the DAG ran and routed to its `error` output;
 * ack it as completed).
 *
 *   DAG_CONTAINER_TRANSPORT   — generic transport loss (closed channel, send
 *                               failure, unroutable error message).
 *   DAG_CONTAINER_WORKER_DIED — a pooled worker/child died with an in-flight
 *                               request (terminate, OOM, segfault, exit,
 *                               killed tab) and sent no result/error.
 *
 * `TransportErrorCode.isInfrastructureFailure(code)` is the single membership
 * test; the scatter and embedded-DAG branches use it to decide retry vs ack.
 */

export const DAG_CONTAINER_TRANSPORT = 'DAG_CONTAINER_TRANSPORT';
export const DAG_CONTAINER_WORKER_DIED = 'DAG_CONTAINER_WORKER_DIED';

/**
 * Membership test for container infrastructure-failure codes.
 *
 * A static class (noun.verb) so the predicate has one canonical call site:
 * `TransportErrorCode.isInfrastructureFailure(code)`.
 */
export class TransportErrorCode {
  private constructor() { /* static class */ }

  /** True when `code` marks a transport/infrastructure failure (retryable). */
  static isInfrastructureFailure(code: string): boolean {
    return code === DAG_CONTAINER_TRANSPORT || code === DAG_CONTAINER_WORKER_DIED;
  }
}
