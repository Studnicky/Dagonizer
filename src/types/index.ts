/**
 * `@noocodex/dagonizer/types` — type-only barrel.
 *
 * Every public type and interface re-exported from one place so consumers
 * can import the type surface without pulling the runtime classes. Three
 * tiers of interface live here:
 *
 *   1. Class-shape interfaces — colocated with their class. Describe the
 *      public face of a single class (`DagonizerInterface`,
 *      `NodeStateInterface`, `DAGErrorInterface`).
 *   2. Adapter contracts — live in `src/contracts/`, single source of truth.
 *      What consumers implement to swap a backend (`ClockProvider`,
 *      `SchedulerProvider`, `NodeInterface`).
 *   3. Entity-narrowing interfaces — colocated with the entity in
 *      `src/entities/<group>/`. Pair with a JSON Schema and its derived
 *      `FromSchema` type (`NodeContextInterface`, `NodeOutputInterface`,
 *      `NodeResultInterface`, `ExecutionResultInterface`,
 *      `SingleNodePlacementInterface`, `NodeErrorInterface`).
 */

// ---------------------------------------------------------------------------
// Class-shape interfaces
// ---------------------------------------------------------------------------

export type { DagonizerInterface } from '../Dagonizer.js';
export type { NodeStateInterface } from '../NodeStateBase.js';
export type { DAGErrorInterface } from '../errors/DAGError.js';

// ---------------------------------------------------------------------------
// Adapter contracts
// ---------------------------------------------------------------------------

export type { CheckpointStore } from '../contracts/CheckpointStore.js';
export type { ClockProvider } from '../contracts/ClockProvider.js';
export type { ErrorConstructorType } from '../contracts/ErrorConstructorType.js';
export type { ExecuteOptionsInterface } from '../contracts/ExecuteOptionsInterface.js';
export type { NodeInterface } from '../contracts/NodeInterface.js';
export type { OperationContract } from '../contracts/OperationContract.js';
export type { RetryPolicyOptionsInterface } from '../contracts/RetryPolicyOptionsInterface.js';
export type { SchedulerHandle } from '../contracts/SchedulerHandle.js';
export type { SchedulerProvider } from '../contracts/SchedulerProvider.js';
export type { StateAccessor } from '../contracts/StateAccessor.js';

// ---------------------------------------------------------------------------
// Entity-narrowing interfaces
// ---------------------------------------------------------------------------

export type { NodeContextInterface } from '../entities/node/NodeContext.js';
export type { NodeErrorInterface } from '../entities/node/NodeError.js';
export type { NodeOutputInterface } from '../entities/node/NodeOutput.js';
export type { NodeResultInterface } from '../entities/node/NodeResult.js';
export type { ExecutionResultInterface } from '../entities/execution/ExecutionResult.js';
export type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';

// ---------------------------------------------------------------------------
// Entity-derived types (FromSchema-derived TypeScript shapes)
// ---------------------------------------------------------------------------

export type { DAG } from '../entities/dag/DAG.js';
export type { FanInConfig } from '../entities/dag/FanInConfig.js';
export type { FanOutNode } from '../entities/dag/FanOutNode.js';
export type { ParallelNode } from '../entities/dag/ParallelNode.js';
export type { SingleNode } from '../entities/dag/SingleNode.js';
export type { DeepDAGNode } from '../entities/dag/DeepDAGNode.js';

export type { Node } from '../entities/node/Node.js';
export type { NodeContext } from '../entities/node/NodeContext.js';
export type { NodeError } from '../entities/node/NodeError.js';
export type { NodeOutput } from '../entities/node/NodeOutput.js';
export type { NodeResult } from '../entities/node/NodeResult.js';
export type { NodeStateData } from '../entities/node/NodeStateData.js';
export type { NodeWarning } from '../entities/node/NodeWarning.js';

export type { ExecutionResult } from '../entities/execution/ExecutionResult.js';
export type { ValidationResult } from '../entities/validation/ValidationResult.js';
export type { DAGErrorJSON } from '../entities/errors/DAGErrorJSON.js';
export type { CheckpointData } from '../entities/checkpoint/CheckpointData.js';
export type { DAGLifecycleStateData } from '../entities/state-machines/DAGLifecycleState.js';
export type { BackoffStrategyValue } from '../entities/runtime/BackoffStrategy.js';

// ---------------------------------------------------------------------------
// Lifecycle FSM types
// ---------------------------------------------------------------------------

export type {
  DAGLifecycleEvent,
  DAGLifecycleState,
} from '../lifecycle/DAGLifecycleState.js';

// ---------------------------------------------------------------------------
// Builder option interfaces
// ---------------------------------------------------------------------------

export type {
  FanOutOptionsInterface,
  DeepDAGOptionsInterface,
} from '../builder/DAGBuilder.js';

// ---------------------------------------------------------------------------
// Core dispatcher option types
// ---------------------------------------------------------------------------

export type { Execution } from '../Execution.js';
export type { DagonizerOptionsInterface } from '../Dagonizer.js';
export type { ParallelResult, ParallelCombiner } from '../core/ParallelCombiners.js';
export type { FanInExecution, FanInStrategy } from '../core/FanInStrategies.js';
export type { FlowDeriverOptions } from '../derive/FlowDeriver.js';
export type { FlowAnnotations, FlowDeepDAG, FlowFanOut, FlowTerminal } from '../derive/FlowAnnotations.js';
export type { DagJsonLdDocument, JsonLdGraphEntry } from '../viz/JsonLdRenderer.js';
export type {
  CytoscapeElement,
  CytoscapeNodeElement,
  CytoscapeEdgeElement,
} from '../viz/CytoscapeRenderer.js';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type { EntityValidator } from '../validation/Validator.js';

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

export type { RecalledCheckpoint, StateRestoreFnType } from '../checkpoint/Checkpoint.js';

// ---------------------------------------------------------------------------
// JSON primitives
// ---------------------------------------------------------------------------

export type {
  JsonArray,
  JsonObject,
  JsonPrimitive,
  JsonValue,
} from '../entities/json.js';

export type {
  JsonSchema,
  JsonSchemaObject,
  JsonSchemaTypeName,
} from '../entities/primitives/JsonSchema.js';
