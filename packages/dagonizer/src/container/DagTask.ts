/**
 * DagTask: engine-side task object implementing `DagTaskType`.
 *
 * Carries the live seeded child clone (`state: NodeStateInterface`) so the
 * in-process path can execute against it directly. Isolating containers compose
 * one wire request from the task identity and supplied batch.
 *
 * Constructor args are required positional in declaration order (V8 shape
 * stability). All fields are readonly and initialized in the constructor.
 */

import type { TransientNodeStateResponseStateType, TransientNodeStateSelectionType } from '../entities/executor/TransientNodeState.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { Timeout } from '../entities/Timeout.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import type { DagTaskType } from '../types/DagTask.js';

export class DagTask
  implements DagTaskType
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

}
