/**
 * DagTask: engine-side task object implementing `DagTaskInterface`.
 *
 * Carries the live seeded child clone (`state: NodeStateInterface`) so the
 * in-process path can execute against it directly. Isolating containers call
 * `toRequest()` to snapshot the clone into a wire-safe `ExecutionRequest`.
 *
 * `TServices` parameterises the services bag on the composed `NodeContext`.
 *
 * Constructor args are required positional in declaration order (V8 shape
 * stability). All fields are readonly and initialized in the constructor.
 */

import type { DagTaskInterface } from '../contracts/DagTaskInterface.js';
import type { ExecutionRequestType } from '../entities/executor/ExecutionRequest.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { Timeout } from '../entities/Timeout.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export type { DagTaskInterface };

export class DagTask<TServices = undefined>
  implements DagTaskInterface<TServices>
{
  readonly dagName: string;
  readonly placementPath: string[];
  readonly correlationId: string;
  readonly timeout: Timeout;
  readonly state: NodeStateInterface;
  readonly context: NodeContextType<TServices>;

  constructor(
    dagName: string,
    placementPath: readonly string[],
    correlationId: string,
    timeout: Timeout,
    state: NodeStateInterface,
    context: NodeContextType<TServices>,
  ) {
    this.dagName = dagName;
    this.placementPath = [...placementPath];
    this.correlationId = correlationId;
    this.timeout = timeout;
    this.state = state;
    this.context = context;
  }

  /**
   * Materialise the wire form by snapshotting the live clone. Called by
   * isolating containers before sending the task across the transport boundary.
   * Produces a single-item request (N=1); multi-item batch requests are
   * built by `DagContainerBase.runDagBatch` directly.
   */
  toRequest(): ExecutionRequestType {
    return {
      'dagName':       this.dagName,
      'placementPath': [...this.placementPath],
      'items':         [{ 'id': this.correlationId, 'snapshot': this.state.snapshot() }],
      'timeoutMs':     this.timeout.toWire(),
      'correlationId': this.correlationId,
    };
  }
}
