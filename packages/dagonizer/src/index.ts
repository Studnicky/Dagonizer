// =============================================================================
// CLASSES
// =============================================================================

export { NodeStateBase } from './NodeStateBase.js';
export { MetadataGetter } from './MetadataGetter.js';

// =============================================================================
// LOGGER
// =============================================================================


// =============================================================================
// OBSERVABILITY
// =============================================================================

export { ObservedDag } from './ObservedDag.js';
export type { DagLoggerInterface } from './ObservedDag.js';

// =============================================================================
// CONSTANTS
// =============================================================================

export {
  GatherStrategyNames,
  ScatterOutputNames,
  MetadataKeys,
  OutputNames,
  NodeTypes,
} from './entities/index.js';
export type {
  GatherStrategyNameType,
  ScatterOutputType,
  MetadataKeyType,
  OutputType,
  NodeType,
} from './entities/index.js';

// =============================================================================
// ERRORS
// =============================================================================

export {
  ConfigurationError,
  DAGError,
  ExecutionError,
  NodeTimeoutError,
  NotFoundError,
  ValidationError,
} from './errors/index.js';

// =============================================================================
// LIFECYCLE
// =============================================================================

export { DAGLifecycleMachine } from './lifecycle/DAGLifecycleMachine.js';
export type {
  DAGLifecycleEventType,
  DAGLifecycleStateType,
} from './lifecycle/DAGLifecycleState.js';

// =============================================================================
// BUILDER
// =============================================================================

export { DAGBuilder } from './builder/index.js';
export type {
  PathType,
  ScatterOptionsType,
  TypedEmbeddedDAGOptionsType,
} from './builder/index.js';

// =============================================================================
// VALIDATION
// =============================================================================

export {
  Validator,
} from './validation/index.js';
export type { EntityValidatorInterface } from './validation/index.js';

// =============================================================================
// ENTITIES (schemas + derived types)
// =============================================================================

// `DAGDocument` is engine-coupled (it validates against the compiled
// `Validator`), so it lives at `src/dag/` and ships through `./dag`. It is
// re-exported on the root barrel so the existing root-barrel `DAGDocument`
// export resolves unchanged.
export { DAGDocument } from './dag/index.js';
export type { DAGDocumentLoadOptionsType } from './dag/index.js';
export {
  Placement,
  NodeErrorBuilder,
  NodeOutputBuilder,
  ScatterNodeSchema,
  EmbeddedDAGNodeSchema,
  GatherConfigSchema,
  DAGSchema,
  DAGLifecycleStateSchema,
  SingleNodeSchema,
  TerminalNodeSchema,
  PhaseNodeSchema,
  NodeSchema,
  NodeContextSchema,
  NodeErrorSchema,
  NodeWarningSchema,
  NodeOutputSchema,
  NodeResultSchema,
  NodeStateDataSchema,
  ExecutionResultSchema,
  ParkedSchema,
  ValidationResultSchema,
  DAGErrorJSONSchema,
  GatherStrategySchema,
  ScatterOutputSchema,
  MetadataKeySchema,
  OutputSchema,
  NodeTypeSchema,
  BackoffStrategySchema,
  BackoffStrategyNames,
  DAG_CONTEXT,
  ExecutorIntermediateSchema,
  ExecutionRequestSchema,
  ExecutionResponseSchema,
  DAGHandoffSchema,
  JsonValue,
  ChatStreamChunkBuilder,
  ChatStreamChunkSchema,
  RoutedChatStreamChunkBuilder,
  RoutedChatStreamChunkSchema,
  ReasoningStepBuilder,
  ReasoningStepSchema,
  ReasoningTraceItemBuilder,
  ReasoningTraceItemSchema,
} from './entities/index.js';
export type {
  BackoffStrategyType,
  DAGNodeType,
  ScatterNodeType,
  EmbeddedDAGNodeType,
  GatherConfigType,
  DAGType,
  DAGLifecycleStateDataType,
  SingleNodeType,
  TerminalNodeType,
  PhaseNodeType,
  NodeUnionType,
  NodeContextWireType,
  NodeContextType,
  NodeErrorWireType,
  NodeErrorType,
  NodeWarningType,
  NodeOutputWireType,
  NodeOutputType,
  NodeResultWireType,
  NodeResultType,
  NodeStateDataType,
  ExecutionResultWireType,
  ExecutionResultType,
  InterruptionInfoType,
  ParkedType,
  ValidationResultType,
  DAGErrorJSONType,
  JsonSchemaType,
  JsonSchemaObjectType,
  JsonSchemaTypeNameType,
  ExecutorIntermediateType,
  ExecutionRequestType,
  ExecutionResponseType,
  ChatStreamChunkType,
  RoutedChatStreamChunkType,
  ReasoningStepType,
  ReasoningTraceItemType,
} from './entities/index.js';
export {
  BridgeMessageSchema,
  RecommendedWorkerCountConfigSchema,
  RecommendedWorkerCountConfigDefault,
  RECOMMENDED_WORKER_COUNT_MAIN_THREAD_RESERVATION,
  RECOMMENDED_WORKER_COUNT_FALLBACK,
  RECOMMENDED_WORKER_COUNT_MEMORY_PER_WORKER_BYTES,
  SystemInfo,
} from './entities/index.js';
export type {
  BridgeMessageType,
  RecommendedWorkerCountConfigType,
  DAGHandoffType,
  SystemInfoProbesType,
} from './entities/index.js';

// =============================================================================
// RUNTIME
// =============================================================================

export {
  Clock,
  RealTimeScheduler,
  RetryPolicy,
  Scheduler,
  Timeout,
} from './runtime/index.js';
export type {
  ClockProviderInterface,
  ErrorConstructorType,
  RetryPolicyOptionsType,
  SchedulerProviderInterface,
} from './runtime/index.js';

// =============================================================================
// CHANNELS
// =============================================================================

export { InMemoryChannel } from './channels/index.js';
export type { InMemoryChannelOptionsType } from './channels/index.js';
export { StreamChannel, StreamCursor } from './channels/index.js';
export type { StreamChannelInterface, StreamChannelOptionsType, StreamCursorOptionsType } from './channels/index.js';
export type { StreamSinkInterface, StreamProducerInterface, ResumableStreamProducerInterface } from './contracts/index.js';
export { NullStreamSink } from './contracts/index.js';

// =============================================================================
// CONTAINER
// =============================================================================

export { DagTask } from './container/DagTask.js';
export { DagHost } from './container/DagHost.js';
export type { DagHostOptionsType } from './container/DagHost.js';
export { DagContainerBase, DAG_CONTAINER_DEFAULTS } from './container/DagContainerBase.js';
export type { DagContainerOptionsType } from './container/DagContainerBase.js';

// =============================================================================
// FUNCTIONS
// =============================================================================

export { Dagonizer } from './Dagonizer.js';
export { SCATTER_PROGRESS_KEY, WORKSET_PROGRESS_KEY } from './entities/constants/ProgressKey.js';
export type { DagonizerOptionsType, DispatcherObserverType, ScatterAckedResultType, ScatterInboxItemType, ScatterProgressType, StoredScatterProgressType } from './Dagonizer.js';
export { Execution } from './Execution.js';

// =============================================================================
// CORE: pluggable execution primitives
// =============================================================================

export {
  GatherStrategies,
  GatherStrategy,
} from './core/GatherStrategies.js';
export type { GatherExecutionType, GatherRecordType } from './contracts/GatherExecution.js';
export {
  OutcomeReducers,
  OutcomeReducer,
} from './core/OutcomeReducers.js';
export type { OutcomeRecordType } from './contracts/OutcomeRecord.js';
export { Batch } from './entities/batch/Batch.js';
export type { ItemType, ItemIdType } from './entities/batch/Item.js';
export { RoutedBatchBuilder } from './entities/batch/RoutedBatchType.js';
export type { RoutedBatchType } from './entities/batch/RoutedBatchType.js';
export { MonadicNode } from './core/MonadicNode.js';
export { PlaceholderNode } from './core/PlaceholderNode.js';
export { ScalarNode } from './core/ScalarNode.js';
export { NodeRunner } from './core/NodeRunner.js';

// =============================================================================
// BASE LLM SERVICE
// =============================================================================

export { BaseLlmService } from './adapter/BaseLlmService.js';

// =============================================================================
// PATTERNS
// =============================================================================

export {
  AgentTraceProducer,
  AppendAssistantNode,
  BuildChatRequestNode,
  BuildToolWorksetsNode,
  CallModelNode,
  CollectToolResultsNode,
  DagStreamProducer,
  DecodeTextToolCallsNode,
  NormalizeResponseNode,
  NormalizeToolCallsNode,
} from './patterns/index.js';
export type {
  ToolCallScatterItemType,
} from './patterns/index.js';

// =============================================================================
// CHECKPOINT
// =============================================================================

export { Checkpoint, CheckpointRestoreAdapter, MemoryCheckpointStore } from './checkpoint/index.js';
export type { CaptureOptionsType, RecalledCheckpointType } from './checkpoint/index.js';

// =============================================================================
// STORE
// =============================================================================

export { BaseStore, MemoryStore, StoreError, TypedStore } from './store/index.js';
export type { BaseStoreOptionsType, StoreErrorClassificationType } from './store/index.js';

// =============================================================================
// PROGRESS (EventBus bridge)
// =============================================================================

export { BusObserver } from './progress/BusObserver.js';
export type { DagLifecycleEventType } from './progress/BusObserver.js';

// =============================================================================
// CLASS-SHAPE INTERFACES (colocated with their class)
// =============================================================================

export type { DagonizerInterface } from './Dagonizer.js';
export type { DispatcherBundleType } from './contracts/DispatcherBundle.js';
export type { NodeStateInterface, StateFieldType, StateFieldsType } from './NodeStateBase.js';
export type { DAGErrorInterface } from './errors/DAGError.js';

// Child-state factory: class with clone-parent default.
export { ChildStateFactory } from './runtime/ChildStateFactory.js';
export type { ChildStateFactoryType } from './contracts/ChildStateFactoryType.js';

// =============================================================================
// CONTRACTS (adapter-pattern interfaces)
// =============================================================================

export type { HandoffChannelInterface } from './contracts/HandoffChannelInterface.js';
export type { DagContainerInterface } from './contracts/DagContainerInterface.js';
export type { PluginInterface, PluginReceiverType } from './contracts/PluginInterface.js';
export { PluginLoader } from './plugin/PluginLoader.js';
export { PluginSpecifier } from './plugin/PluginSpecifier.js';
export type { DagOutcomeType } from './contracts/DagOutcomeType.js';
export type { DagTaskInterface } from './contracts/DagTaskInterface.js';
export type { ExecuteOptionsType } from './contracts/ExecuteOptionsType.js';
export type { NodeInterface, SchemaObjectType } from './contracts/NodeInterface.js';
export type { RemoteStoreInterface } from './contracts/RemoteStoreInterface.js';
export type { RemoteStoreEndpointType } from './contracts/RemoteStoreEndpoint.js';
export type { RemoteStoreLeaseType } from './contracts/RemoteStoreLease.js';
export type { SnapshottableInterface, StoreSnapshotType, StoreSnapshotEntryType } from './contracts/SnapshottableInterface.js';
export type { StoreInterface } from './contracts/StoreInterface.js';

// Adapter infrastructure ships exclusively via @studnicky/dagonizer/adapter.
// See: AdapterDescriptor, BaseAdapter, BaseEmbedder, Classifications,
//      EmbedderCascade, EmbedderRegistry, LlmAdapterCascade,
//      LlmAdapterRegistry, LlmError (and their types).
// Breaking change in 0.18.0 — migrate root-barrel imports to the subpath.

// =============================================================================
// ENTITY-NARROWING INTERFACES (colocated with entity)
// =============================================================================

export type { SingleNodePlacementType } from './entities/dag/SingleNode.js';
