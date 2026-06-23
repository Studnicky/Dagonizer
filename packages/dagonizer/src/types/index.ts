/**
 * `@studnicky/dagonizer/types`: type-only barrel.
 *
 * Every public type and interface re-exported from one place so consumers
 * can import the type surface without pulling the runtime classes. Three
 * tiers of interface live here:
 *
 *   1. Class-shape interfaces: colocated with their class. Describe the
 *      public face of a single class (`DagonizerInterface`,
 *      `NodeStateInterface`, `DAGErrorInterface`).
 *   2. Adapter contracts: live in `src/contracts/`, single source of truth.
 *      What consumers implement to swap a backend (`ClockProviderInterface`,
 *      `SchedulerProviderInterface`, `NodeInterface`).
 *   3. Entity-narrowing interfaces: colocated with the entity in
 *      `src/entities/<group>/`. Pair with a JSON Schema and its derived
 *      `FromSchema` type (`NodeContextType`, `NodeOutputType`,
 *      `NodeResultType`, `ExecutionResultType`,
 *      `SingleNodePlacementType`, `NodeErrorType`).
 */

// ---------------------------------------------------------------------------
// Class-shape interfaces
// ---------------------------------------------------------------------------

export type { DagonizerInterface } from '../Dagonizer.js';
export type { NodeStateInterface, StateFieldType, StateFieldsType } from '../NodeStateBase.js';
export type { DAGErrorInterface } from '../errors/DAGError.js';

// ---------------------------------------------------------------------------
// Adapter contracts
// ---------------------------------------------------------------------------

export type { CheckpointRestoreAdapterInterface } from '../contracts/CheckpointRestoreAdapterInterface.js';
export type { CheckpointStoreInterface } from '../contracts/CheckpointStoreInterface.js';
export type { ClockProviderInterface } from '../contracts/ClockProviderInterface.js';
export type { DagContainerInterface } from '../contracts/DagContainerInterface.js';
export type { EmbedderInterface } from '../contracts/EmbedderInterface.js';
export type { HandoffChannelInterface } from '../contracts/HandoffChannelInterface.js';
export type { DagOutcomeType } from '../contracts/DagOutcomeType.js';
export type { DagTaskInterface } from '../contracts/DagTaskInterface.js';
export type { ErrorConstructorType } from '../contracts/ErrorConstructorType.js';
export type { ExecuteOptionsType } from '../contracts/ExecuteOptionsType.js';
export type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
export type { NodeInterface } from '../contracts/NodeInterface.js';
export type { RegistryBundleInterface } from '../contracts/RegistryBundleInterface.js';
export type { RegistryModuleInterface } from '../contracts/RegistryModuleInterface.js';
export type { RetryPolicyOptionsType } from '../contracts/RetryPolicyOptionsType.js';
export type { LlmAdapterInterface } from '../contracts/LlmAdapterInterface.js';
export type { LlmClientInterface } from '../contracts/LlmClientInterface.js';
export type { NodeInvokerInterface } from '../contracts/NodeInvokerInterface.js';
export type { SchedulerProviderInterface } from '../contracts/SchedulerProviderInterface.js';
export type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
export type { SystemInfoInterface } from '../contracts/SystemInfoInterface.js';
export type { RemoteStoreInterface } from '../contracts/RemoteStoreInterface.js';
export type { RemoteStoreEndpointType } from '../contracts/RemoteStoreEndpoint.js';
export type { RemoteStoreLeaseType } from '../contracts/RemoteStoreLease.js';
export type { SnapshottableInterface, StoreSnapshotType, StoreSnapshotEntryType } from '../contracts/SnapshottableInterface.js';
export type { StoreInterface } from '../contracts/StoreInterface.js';
export type { BindingType, QuadType, SlotPatternType, TermType, TripleStoreInterface } from '../contracts/TripleStoreInterface.js';

// ---------------------------------------------------------------------------
// Entity-narrowing interfaces
// ---------------------------------------------------------------------------

export type { NodeContextType } from '../entities/node/NodeContext.js';
export type { NodeErrorType } from '../entities/node/NodeError.js';
export type { NodeOutputType } from '../entities/node/NodeOutput.js';
export type { NodeResultType } from '../entities/node/NodeResult.js';
export type { ExecutionResultType, InterruptionInfoType } from '../entities/execution/ExecutionResult.js';
export type { ParkedType } from '../entities/execution/Parked.js';
export type { SingleNodePlacementType } from '../entities/dag/SingleNode.js';

// ---------------------------------------------------------------------------
// Entity-derived types (FromSchema-derived TypeScript shapes)
// ---------------------------------------------------------------------------

export type { LlmModelType } from '../entities/adapter/LlmModel.js';
export type { DAGType } from '../entities/dag/DAG.js';
export type { GatherConfigType } from '../entities/dag/GatherConfig.js';
export type { DAGNodeType } from '../entities/dag/Placement.js';
export type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
export type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
export type { SingleNodeType } from '../entities/dag/SingleNode.js';


export type { NodeUnionType } from '../entities/node/Node.js';
export type { NodeContextWireType } from '../entities/node/NodeContext.js';
export type { NodeErrorWireType } from '../entities/node/NodeError.js';
export type { NodeOutputWireType } from '../entities/node/NodeOutput.js';
export type { NodeResultWireType } from '../entities/node/NodeResult.js';
export type { NodeStateDataType } from '../entities/node/NodeStateData.js';
export type { NodeWarningType } from '../entities/node/NodeWarning.js';

export type { ExecutionResultWireType } from '../entities/execution/ExecutionResult.js';
export type { ValidationResultType } from '../entities/validation/ValidationResult.js';
export type { DAGErrorJSONType } from '../entities/errors/DAGErrorJSON.js';
export type { DAGHandoffType } from '../entities/handoff/DAGHandoff.js';
export type { BridgeMessageType } from '../entities/executor/BridgeMessage.js';
export type { ExecutionRequestType } from '../entities/executor/ExecutionRequest.js';
export type { ExecutionResponseType } from '../entities/executor/ExecutionResponse.js';
export type { ExecutorIntermediateType } from '../entities/executor/ExecutorIntermediate.js';
export type { RecommendedWorkerCountConfigType } from '../entities/executor/RecommendedWorkerCountConfig.js';
export type { CheckpointDataType } from '../entities/checkpoint/CheckpointData.js';
export type { DAGLifecycleStateDataType } from '../entities/state-machines/DAGLifecycleState.js';
export type { BackoffStrategyType } from '../entities/runtime/BackoffStrategy.js';

// ---------------------------------------------------------------------------
// Lifecycle FSM types
// ---------------------------------------------------------------------------

export type {
  DAGLifecycleEventType,
  DAGLifecycleStateType,
} from '../lifecycle/DAGLifecycleState.js';

// ---------------------------------------------------------------------------
// Builder option interfaces
// ---------------------------------------------------------------------------

export type { ScatterOptionsType, TypedEmbeddedDAGOptionsType } from '../builder/DAGBuilder.js';

// ---------------------------------------------------------------------------
// Core dispatcher option types
// ---------------------------------------------------------------------------

export type { Execution } from '../Execution.js';
export type { DagonizerOptionsType, DispatcherObserverType } from '../Dagonizer.js';
export type { GatherExecutionType, GatherRecordType } from '../contracts/GatherExecution.js';
export type { GatherStrategy } from '../core/GatherStrategies.js';
export type { OutcomeRecordType } from '../contracts/OutcomeRecord.js';
export type { OutcomeReducer } from '../core/OutcomeReducers.js';
export type { DagJsonLdDocumentType, JsonLdGraphEntryType } from '../viz/JsonLdRenderer.js';
export type {
  CytoscapeElementType,
  CytoscapeNodeElementType,
  CytoscapeEdgeElementType,
} from '../viz/CytoscapeRenderer.js';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type { EntityValidatorInterface } from '../validation/Validator.js';

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

export type { RecalledCheckpointType } from '../checkpoint/Checkpoint.js';

// ---------------------------------------------------------------------------
// JSON primitives
// ---------------------------------------------------------------------------

export type {
  JsonArrayType,
  JsonObjectType,
  JsonPrimitiveType,
  JsonValueType,
} from '../entities/json.js';

export type {
  JsonSchemaType,
  JsonSchemaObjectType,
  JsonSchemaTypeNameType,
} from '../entities/primitives/JsonSchema.js';

// ---------------------------------------------------------------------------
// Scatter / resume internals (public surface for consumers building resumable DAGs)
// ---------------------------------------------------------------------------

export type {
  ScatterAckedResultType,
  ScatterInboxItemType,
  ScatterProgressType,
  StoredScatterProgressType,
} from '../entities/scatter/ScatterProgress.js';

export type { DispatcherBundleType } from '../contracts/DispatcherBundle.js';
export type { ObserverRelayInterface } from '../contracts/ObserverRelayInterface.js';
export type { PluginInterface, PluginReceiverType } from '../contracts/PluginInterface.js';

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

export type { CaptureOptionsType } from '../checkpoint/Checkpoint.js';

// ---------------------------------------------------------------------------
// Container options
// ---------------------------------------------------------------------------

export type { DagContainerOptionsType } from '../container/DagContainerBase.js';
export type { DagHostOptionsType } from '../container/DagHost.js';

// ---------------------------------------------------------------------------
// Channel options
// ---------------------------------------------------------------------------

export type { InMemoryChannelOptionsType } from '../channels/InMemoryChannel.js';

// ---------------------------------------------------------------------------
// StoreInterface options + contracts
// ---------------------------------------------------------------------------

export type { BaseStoreOptionsType } from '../store/BaseStore.js';
export type { StoreErrorClassificationType } from '../store/StoreError.js';

// ---------------------------------------------------------------------------
// Plural-native batch types + contracts
// ---------------------------------------------------------------------------

export type { ItemType, ItemIdType } from '../entities/batch/Item.js';
export type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
