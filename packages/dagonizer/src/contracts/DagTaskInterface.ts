/**
 * DagTaskInterface: adapter contract for the engine-side descriptor of a
 * contained DAG execution.
 *
 * Carries a LIVE seeded child clone (`state`) so the in-process path can
 * execute against it directly. Isolating containers (worker threads, forks,
 * spawned processes) call `toRequest()` to snapshot the clone into a
 * wire-safe `ExecutionRequest`.
 *
 * `dagName`       — name of the registered DAG to run.
 * `placementPath` — nesting path of embedded-DAG placement names leading to
 *                   this execution (for instrumentation/observability).
 * `correlationId` — dispatcher-monotonic correlation id; no randomness.
 * `timeout`       — per-task execution budget; `Timeout.none()` = no limit.
 * `state`         — live seeded child clone.
 * `context`       — composed NodeContext including the abort signal.
 */

import type { ExecutionRequestType } from '../entities/executor/ExecutionRequest.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { Timeout } from '../entities/Timeout.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export interface DagTaskInterface<TServices = undefined> {
  /** Name of the registered DAG to run. */
  dagName: string;
  /** Nesting path of embedded-DAG placement names leading to this execution, for observability. */
  placementPath: string[];
  /** Dispatcher-monotonic correlation id; no randomness. Matches the corresponding `ExecutionRequest.correlationId`. */
  correlationId: string;
  /** Per-task execution budget. `Timeout.none()` means no per-task limit. */
  timeout: Timeout;
  /** Live seeded child clone. In-process containers execute against this directly. */
  state: NodeStateInterface;
  /** Composed `NodeContext` carrying the abort signal and services record for this task. */
  context: NodeContextType<TServices>;
  /**
   * Materialise the wire form by snapshotting the live clone. Isolating
   * containers call this to obtain the `ExecutionRequest` they send across
   * the transport boundary. In-process containers ignore it and execute
   * against `state` directly.
   */
  toRequest(): ExecutionRequestType;
}
