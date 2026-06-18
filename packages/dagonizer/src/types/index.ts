/**
 * `@noocodex/dagonizer/types`: type-only barrel.
 *
 * Every public type and interface re-exported from one place so consumers
 * can import the type surface without pulling the runtime classes. Three
 * tiers of interface live here:
 *
 *   1. Class-shape interfaces: colocated with their class. Describe the
 *      public face of a single class (`DagonizerInterface`,
 *      `NodeStateInterface`, `DAGErrorInterface`).
 *   2. Adapter contracts: live in `src/contracts/`, single source of truth.
 *      What consumers implement to swap a backend (`ClockProvider`,
 *      `SchedulerProvider`, `NodeInterface`).
 *   3. Entity-narrowing interfaces: colocated with the entity in
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

export type { CheckpointRestoreAdapter } from '../contracts/CheckpointRestoreAdapter.js';
export type { CheckpointStore } from '../contracts/CheckpointStore.js';
export type { ClockProvider } from '../contracts/ClockProvider.js';
export type { DagContainerInterface } from '../contracts/DagContainerInterface.js';
export type { Embedder } from '../contracts/Embedder.js';
export type { HandoffChannelInterface } from '../contracts/HandoffChannelInterface.js';
export type { DagOutcomeInterface } from '../contracts/DagOutcomeInterface.js';
export type { DagTaskInterface } from '../contracts/DagTaskInterface.js';
export type { ErrorConstructorType } from '../contracts/ErrorConstructorType.js';
export type { ExecuteOptionsInterface } from '../contracts/ExecuteOptionsInterface.js';
export type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
export type { Chainable } from '../contracts/Chainable.js';
export type { NodeInterface } from '../contracts/NodeInterface.js';
export type { OperationContract } from '../contracts/OperationContract.js';
export type { OperationContractFragment } from '../contracts/OperationContractFragment.js';
export type { RegistryBundleInterface, RegistryModuleInterface } from '../contracts/RegistryModuleInterface.js';
export type { RetryPolicyOptionsInterface } from '../contracts/RetryPolicyOptionsInterface.js';
export type { LlmAdapter } from '../contracts/LlmAdapter.js';
export type { LlmClient } from '../contracts/LlmClient.js';
export type { NodeInvoker } from '../contracts/NodeInvoker.js';
export type { SchedulerProvider } from '../contracts/SchedulerProvider.js';
export type { StateAccessor } from '../contracts/StateAccessor.js';
export type { SystemInfoInterface } from '../contracts/SystemInfoInterface.js';
export type { RemoteStore, RemoteStoreEndpoint, RemoteStoreLease } from '../contracts/RemoteStore.js';
export type { Snapshottable, StoreSnapshot, StoreSnapshotEntry } from '../contracts/Snapshottable.js';
export type { Store } from '../contracts/Store.js';
export type { Binding, Quad, SlotPattern, Term, TripleStore } from '../contracts/TripleStore.js';
export type { WarningEmitter } from '../contracts/WarningEmitter.js';

// ---------------------------------------------------------------------------
// Entity-narrowing interfaces
// ---------------------------------------------------------------------------

export type { NodeContextInterface } from '../entities/node/NodeContext.js';
export type { NodeErrorInterface } from '../entities/node/NodeError.js';
export type { NodeOutputInterface } from '../entities/node/NodeOutput.js';
export type { NodeResultInterface } from '../entities/node/NodeResult.js';
export type { ExecutionResultInterface, InterruptionInfo } from '../entities/execution/ExecutionResult.js';
export type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';

// ---------------------------------------------------------------------------
// Entity-derived types (FromSchema-derived TypeScript shapes)
// ---------------------------------------------------------------------------

export type { DAG } from '../entities/dag/DAG.js';
export type { GatherConfig } from '../entities/dag/GatherConfig.js';
export type { DAGNodeType } from '../entities/dag/Placement.js';
export type { ScatterNode } from '../entities/dag/ScatterNode.js';
export type { EmbeddedDAGNode } from '../entities/dag/EmbeddedDAGNode.js';
export type { SingleNode } from '../entities/dag/SingleNode.js';


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
export type { DAGHandoff } from '../entities/handoff/DAGHandoff.js';
export type { BridgeMessage } from '../entities/executor/BridgeMessage.js';
export type { ExecutionRequest } from '../entities/executor/ExecutionRequest.js';
export type { ExecutionResponse } from '../entities/executor/ExecutionResponse.js';
export type { ExecutorIntermediate } from '../entities/executor/ExecutorIntermediate.js';
export type { RecommendedWorkerCountConfig } from '../entities/executor/RecommendedWorkerCountConfig.js';
export type { CheckpointData } from '../entities/checkpoint/CheckpointData.js';
export type { DAGLifecycleStateData } from '../entities/state-machines/DAGLifecycleState.js';
export type { BackoffStrategy } from '../entities/runtime/BackoffStrategy.js';

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

export type { ScatterOptionsInterface, TypedEmbeddedDAGOptionsInterface } from '../builder/DAGBuilder.js';

// ---------------------------------------------------------------------------
// Core dispatcher option types
// ---------------------------------------------------------------------------

export type { Execution } from '../Execution.js';
export type { DagonizerOptionsInterface } from '../Dagonizer.js';
export type { GatherExecution, GatherRecord } from '../contracts/GatherExecution.js';
export type { GatherStrategy } from '../core/GatherStrategies.js';
export type { OutcomeRecord } from '../contracts/OutcomeRecord.js';
export type { OutcomeReducer } from '../core/OutcomeReducers.js';
export type { DAGDeriverOptions } from '../derive/DAGDeriver.js';
export type { DAGDeriverAnnotations, DAGDeriverEmitTerminal, DAGDeriverEmbeddedDAG, DAGDeriverScatter, DAGDeriverTerminal } from '../derive/DAGDeriverAnnotations.js';
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

export type { RecalledCheckpoint } from '../checkpoint/Checkpoint.js';

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

// ---------------------------------------------------------------------------
// Scatter / resume internals (public surface for consumers building resumable DAGs)
// ---------------------------------------------------------------------------

export type {
  ScatterAckedResult,
  ScatterInboxItem,
  ScatterProgress,
  StoredScatterProgress,
} from '../entities/scatter/ScatterProgress.js';

export type { DispatcherBundle } from '../Dagonizer.js';

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

export type { CaptureOptionsInterface } from '../checkpoint/Checkpoint.js';

// ---------------------------------------------------------------------------
// Container options
// ---------------------------------------------------------------------------

export type { DagContainerOptions } from '../container/DagContainerBase.js';
export type { DagHostOptions } from '../container/DagHost.js';

// ---------------------------------------------------------------------------
// Channel options
// ---------------------------------------------------------------------------

export type { InMemoryChannelOptions } from '../channels/InMemoryChannel.js';

// ---------------------------------------------------------------------------
// Store options + contracts
// ---------------------------------------------------------------------------

export type { BaseStoreOptions } from '../store/BaseStore.js';
export type { StoreErrorClassification } from '../store/StoreError.js';

// ---------------------------------------------------------------------------
// Plural-native batch types + contracts
// ---------------------------------------------------------------------------

export type { Item, ItemId } from '../core/batch/Item.js';
export type { RoutedBatch } from '../core/batch/RoutedBatch.js';
