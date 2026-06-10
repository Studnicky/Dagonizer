/**
 * DagTask: engine-side task object implementing `DagTaskInterface`.
 *
 * Carries the live seeded child clone so the in-process path can execute
 * against it directly. Isolating containers call `toRequest()` to snapshot
 * the clone into a wire-safe `ExecutionRequest`.
 *
 * Constructor args are required positional in declaration order (V8 shape
 * stability). All fields are readonly and initialized in the constructor.
 */

import type { ExecutionRequest } from '../entities/executor/ExecutionRequest.js';
import type { NodeContextInterface } from '../entities/node/NodeContext.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

// ---------------------------------------------------------------------------
// DagTaskInterface (class-shape interface, lives in the same file as DagTask)
// ---------------------------------------------------------------------------

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
 * `correlationId` — dispatcher-monotonic correlation id; no randomness.
 * `timeoutMs`     — timeout budget forwarded to the container; `null` = no limit.
 * `state`         — live seeded child clone (TState).
 * `context`       — composed NodeContext including the abort signal.
 */
export interface DagTaskInterface<
  TState extends NodeStateInterface = NodeStateInterface,
  TServices = undefined,
> {
  readonly dagName: string;
  readonly placementPath: readonly string[];
  readonly correlationId: string;
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

export class DagTask<
  TState extends NodeStateInterface = NodeStateInterface,
  TServices = undefined,
> implements DagTaskInterface<TState, TServices> {
  readonly dagName: string;
  readonly placementPath: readonly string[];
  readonly correlationId: string;
  readonly timeoutMs: number | null;
  readonly state: TState;
  readonly context: NodeContextInterface<TServices>;

  constructor(
    dagName: string,
    placementPath: readonly string[],
    correlationId: string,
    timeoutMs: number | null,
    state: TState,
    context: NodeContextInterface<TServices>,
  ) {
    this.dagName = dagName;
    this.placementPath = placementPath;
    this.correlationId = correlationId;
    this.timeoutMs = timeoutMs;
    this.state = state;
    this.context = context;
  }

  /**
   * Materialise the wire form by snapshotting the live clone. Called by
   * isolating containers before sending the task across the transport boundary.
   */
  toRequest(): ExecutionRequest {
    return {
      'dagName':       this.dagName,
      'placementPath': [...this.placementPath],
      'stateSnapshot': this.state.snapshot(),
      'timeoutMs':     this.timeoutMs,
      'correlationId': this.correlationId,
    };
  }
}
