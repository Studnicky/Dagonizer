import type { TransientNodeStateResponseStateType, TransientNodeStateSelectionType } from '../entities/executor/TransientNodeState.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { Timeout } from '../entities/Timeout.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export type DagTaskType = {
  dagName: string;
  placementPath: string[];
  correlationId: string;
  timeout: Timeout;
  state: NodeStateInterface;
  inputState: TransientNodeStateSelectionType;
  responseState: TransientNodeStateResponseStateType;
  context: NodeContextType;
};
