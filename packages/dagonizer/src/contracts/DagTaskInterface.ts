/**
 * DagTaskInterface: engine-side descriptor of a contained DAG execution.
 *
 * Carries a LIVE seeded child clone (`state`) so the in-process path can
 * execute against it directly. Isolating containers (worker threads, forks,
 * spawned processes) call `toRequest()` to snapshot the clone into a
 * wire-safe `ExecutionRequest`.
 *
 * `dagName`       — name of the registered DAG to run.
 * `placementPath` — nesting path of embedded-DAG placement names leading to
 *                   this execution (for instrumentation/observability).
 * `requestId`     — dispatcher-monotonic correlation id; no randomness.
 * `timeoutMs`     — timeout budget forwarded to the container; `null` = no limit.
 * `state`         — live seeded child clone (TState).
 * `context`       — composed NodeContext including the abort signal.
 */

import type { ExecutionRequest } from '../entities/executor/ExecutionRequest.js';
import type { NodeContextInterface } from '../entities/node/NodeContext.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export interface DagTaskInterface<
  TState extends NodeStateInterface = NodeStateInterface,
  TServices = undefined,
> {
  readonly dagName: string;
  readonly placementPath: readonly string[];
  readonly requestId: string;
  readonly timeoutMs: number | null;
  readonly state: TState;
  readonly context: NodeContextInterface<TServices>;
  /**
   * Materialise the wire form by snapshotting the live clone. Isolating
   * containers call this to obtain the `ExecutionRequest` they send across
   * the transport boundary. In-process containers ignore it and execute
   * against `state` directly.
   */
  toRequest(): ExecutionRequest;
}
