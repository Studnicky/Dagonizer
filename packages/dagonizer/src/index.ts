// =============================================================================
// CLASSES
// =============================================================================

export { NodeStateBase } from './NodeStateBase.js';
export { MetadataGetter } from './MetadataGetter.js';
export { BatchItemExecutor } from './execution/BatchItemExecutor.js';
export type { BatchExecutionOptionsType, BatchExecutionThrottleOptionsType } from './types/BatchExecutionOptions.js';

// =============================================================================
// LOGGER
// =============================================================================


// =============================================================================
// OBSERVABILITY
// =============================================================================

export { ObservedDag } from './ObservedDag.js';
export type { DagLoggerInterface, ObservedDagOptionsType } from './ObservedDag.js';

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
  DAGError,
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
  DynamicDAGReferenceInputType,
  EmbeddableDAGType,
  ItemDAGReferenceInputType,
  PathType,
  SchemaRouteTypes,
  ScatterDAGBodyType,
  ScatterOptionsType,
  StateDAGReferenceInputType,
  TypedEmbeddedDAGOptionsType,
} from './builder/index.js';

// =============================================================================
// GRAPH
// =============================================================================

export { DagGraphProjector, DagGraphQueries, DagGraphTerms, DagReferenceGraph, GraphDatasetRevision, GraphRetentionManager, GraphRetentionQueryService, GraphStateJsonLdCodec, GraphStateQueryService, GraphStateTerms, GraphStateTransferCodec, InMemoryGraphDataset, InMemoryGraphDatasetProvider, InMemoryGraphStateTransferStore, InMemoryTopologyStore, N3GraphDatasetProvider, Rdf12JsonLdCodec } from './graph/index.js';
export type { GraphStateFieldDefinitionType, GraphStateNestedFieldDefinitionType } from './contracts/GraphStateFieldDefinition.js';
export type { GraphRetentionPolicyType } from './contracts/GraphRetentionPolicy.js';
export { DEFAULT_GRAPH_RETENTION_POLICY } from './contracts/GraphRetentionPolicy.js';
export type { GraphRetentionPlanType, GraphRetentionReportType } from './contracts/index.js';
export type { DagReferenceEdgeType } from './graph/index.js';
export type { GraphDatasetInterface, GraphDatasetProviderInterface, GraphScopeType, GraphStateDeltaInterface, GraphStateJsonLdDocumentType, GraphStateJsonLdGraphType, GraphStateJsonLdNodeType, GraphStateJsonLdValueType, GraphStateLifecycleInterface, GraphStateSnapshotReferenceType, GraphStateSnapshotInterface, GraphStateTransferIdentityType, GraphStateTransferLeaseType, GraphStateTransferMetadataType, GraphStateTransferStoreInterface, GraphStateTransferType } from './contracts/index.js';

// =============================================================================
// SCHEMA
// =============================================================================

export { JsonSchemaCompatibility, SchemaIdentity, SchemaRegistry, StableSchemaHash } from './schema/index.js';
export type { SchemaCompatibilityResultType } from './schema/index.js';

// =============================================================================
// VALIDATION
// =============================================================================

export {
  Validator,
  WellFormedValidator,
} from './validation/index.js';
export type { EntityValidatorInterface } from './validation/index.js';

// =============================================================================
// ENTITIES (schemas + derived types)
// =============================================================================

export {
  Placement,
  NodeError,
  NodeOutput,
  DagReference,
  DagReferenceSchema,
  GatherNodeSchema,
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
  GatherProgressSchema,
  GatherRecordProgressSchema,
  GatherStrategySchema,
  ScatterOutputSchema,
  MetadataKeySchema,
  OutputSchema,
  NodeTypeSchema,
  BackoffStrategySchema,
  BackoffStrategyNames,
  DAG_CONTEXT,
  DAGEntrypoints,
  DAGIdentity,
  ExecutorIntermediateSchema,
  ExecutionRequestSchema,
  ExecutionResponseSchema,
  DAGHandoffSchema,
  JsonValue,
  ChatStreamChunk,
  ChatStreamChunkSchema,
  RoutedChatStreamChunk,
  RoutedChatStreamChunkSchema,
  ReasoningStep,
  ReasoningStepSchema,
  ReasoningTraceItem,
  ReasoningTraceItemSchema,
} from './entities/index.js';
export { DagonizerContexts } from './context/index.js';
export type {
  BackoffStrategyType,
  DAGNodeType,
  DagReferenceType,
  DynamicDagReferenceType,
  ScatterNodeType,
  EmbeddedDAGNodeType,
  GatherNodeType,
  GatherPolicyType,
  GatherConfigType,
  GatherProgressType,
  GatherRecordProgressType,
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
  RECOMMENDED_WORKER_COUNT_MINIMUM,
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
  ErrorMatcherType,
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
export { GATHER_PROGRESS_KEY, SCATTER_PROGRESS_KEY, WORKSET_PROGRESS_KEY } from './entities/constants/ProgressKey.js';
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
export { RoutedBatch } from './entities/batch/RoutedBatchType.js';
export type { RoutedBatchType } from './entities/batch/RoutedBatchType.js';
export { MonadicNode } from './core/MonadicNode.js';
export { PlaceholderNode } from './core/PlaceholderNode.js';
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

export { Checkpoint, CheckpointRestoreAdapter, GatherCheckpoint, MemoryCheckpointStore } from './checkpoint/index.js';
export type { CaptureOptionsType, RecalledCheckpointType, RestoreStoresOptionsType } from './checkpoint/index.js';

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
export type { NodeStateInterface } from './NodeStateBase.js';

// Child-state factory: class with clone-parent default.
export { ChildStateFactory } from './runtime/ChildStateFactory.js';
export type { ChildStateFactoryType } from './contracts/ChildStateFactoryType.js';

// =============================================================================
// CONTRACTS (adapter-pattern interfaces)
// =============================================================================

export type { HandoffChannelInterface } from './contracts/HandoffChannelInterface.js';
export type { DagContainerInterface } from './contracts/DagContainerInterface.js';
export type { PluginInterface, PluginReceiverType } from './contracts/PluginInterface.js';
export { PluginDiscovery } from './plugin/PluginDiscovery.js';
export { PluginLoader } from './plugin/PluginLoader.js';
export { defineDagonizerPlugin } from './plugin/defineDagonizerPlugin.js';
export type {
  DagonizerPluginDefinitionType,
  DefinedDagonizerPluginType,
} from './plugin/defineDagonizerPlugin.js';
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
