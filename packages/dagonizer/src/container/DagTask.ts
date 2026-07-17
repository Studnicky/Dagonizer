/**
 * DagTask: engine-side task object implementing `DagTaskInterface`.
 *
 * Carries the live seeded child clone (`state: NodeStateInterface`) so the
 * in-process path can execute against it directly. Isolating containers call
 * `toRequest()` to snapshot the clone into a wire-safe `ExecutionRequest`.
 *
 * Constructor args are required positional in declaration order (V8 shape
 * stability). All fields are readonly and initialized in the constructor.
 */

import type { DagTaskInterface } from '../contracts/DagTaskInterface.js';
import type { ExecutionRequestType } from '../entities/executor/ExecutionRequest.js';
import type { TransientNodeStateResponseStateType, TransientNodeStateSelectionType } from '../entities/executor/TransientNodeState.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { Timeout } from '../entities/Timeout.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export type { DagTaskInterface };

export class DagTask
  implements DagTaskInterface
{
  readonly dagName: string;
  readonly placementPath: string[];
  readonly correlationId: string;
  readonly timeout: Timeout;
  readonly state: NodeStateInterface;
  readonly inputState: TransientNodeStateSelectionType;
  readonly responseState: TransientNodeStateResponseStateType;
  readonly context: NodeContextType;

  constructor(
    dagName: string,
    placementPath: readonly string[],
    correlationId: string,
    timeout: Timeout,
    state: NodeStateInterface,
    inputState: TransientNodeStateSelectionType,
    responseState: TransientNodeStateResponseStateType,
    context: NodeContextType,
  ) {
    this.dagName = dagName;
    this.placementPath = [...placementPath];
    this.correlationId = correlationId;
    this.timeout = timeout;
    this.state = state;
    this.inputState = inputState;
    this.responseState = responseState;
    this.context = context;
  }

  /**
   * Materialise the wire form from the live graph clone. Called by
   * isolating containers before sending the task across the transport boundary.
   * Produces a single-item request (a batch of one); multi-item batch requests
   * are built by `DagContainerBase.runDag` directly.
   *
   * The `graphState` here is a single-item transient-state placeholder,
   * snapshotted through `this.inputState`. The real batch payload is rebuilt
   * by `DagContainerBase` from the live item states before dispatch.
   */
  toRequest(): ExecutionRequestType {
    return {
      'dagName':       this.dagName,
      'placementPath': [...this.placementPath],
      'graphState':    { 'states': [{ 'id': this.correlationId, 'state': this.state.snapshotTransientStateSelection(this.inputState) }] },
      'items':         [{ 'id': this.correlationId, 'runIri': this.state.runIri }],
      'timeoutMs':     this.timeout.toWire(),
      'correlationId': this.correlationId,
      'responseState': this.responseState,
    };
  }
}
