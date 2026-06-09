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

import type { DagTaskInterface } from '../contracts/DagTaskInterface.js';
import type { ExecutionRequest } from '../entities/executor/ExecutionRequest.js';
import type { NodeContextInterface } from '../entities/node/NodeContext.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export class DagTask<
  TState extends NodeStateInterface = NodeStateInterface,
  TServices = undefined,
> implements DagTaskInterface<TState, TServices> {
  readonly dagName: string;
  readonly placementPath: readonly string[];
  readonly requestId: string;
  readonly timeoutMs: number | null;
  readonly state: TState;
  readonly context: NodeContextInterface<TServices>;

  constructor(
    dagName: string,
    placementPath: readonly string[],
    requestId: string,
    timeoutMs: number | null,
    state: TState,
    context: NodeContextInterface<TServices>,
  ) {
    this.dagName = dagName;
    this.placementPath = placementPath;
    this.requestId = requestId;
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
      'requestId':     this.requestId,
    };
  }
}
