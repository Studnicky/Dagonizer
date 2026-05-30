// =============================================================================
// CLASSES
// =============================================================================

export { NodeStateBase } from './NodeStateBase.js';

// =============================================================================
// CONSTANTS
// =============================================================================

export {
  GatherStrategyName,
  ScatterOutput,
  MetadataKey,
  Output,
  ParallelCombine,
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
  DAGLifecycleEvent,
  DAGLifecycleState,
} from './lifecycle/DAGLifecycleState.js';

// =============================================================================
// BUILDER
// =============================================================================

export { DAGBuilder } from './builder/index.js';
export type {
  ScatterOptionsInterface,
  TypedEmbeddedDAGOptionsInterface,
} from './builder/index.js';

// =============================================================================
// VALIDATION
// =============================================================================

export {
  Validator,
} from './validation/index.js';
export type { EntityValidator } from './validation/index.js';

// =============================================================================
// ENTITIES (schemas + derived types)
// =============================================================================

export {
  ScatterNodeSchema,
  EmbeddedDAGNodeSchema,
  GatherConfigSchema,
  DAGSchema,
  DAGLifecycleStateSchema,
  ParallelNodeSchema,
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
  ValidationResultSchema,
  DAGErrorJSONSchema,
  GatherStrategySchema,
  ScatterOutputSchema,
  MetadataKeySchema,
  OutputSchema,
  ParallelCombineSchema,
  NodeTypeSchema,
  BackoffStrategySchema,
  DAG_CONTEXT,
} from './entities/index.js';
export type {
  ScatterNode,
  EmbeddedDAGNode,
  GatherConfig,
  DAG,
  DAGLifecycleStateData,
  ParallelNode,
  SingleNode,
  TerminalNode,
  PhaseNode,
  Node,
  NodeContext,
  NodeError,
  NodeWarning,
  NodeOutput,
  NodeResult,
  NodeStateData,
  ExecutionResult,
  InterruptionInfo,
  ValidationResult,
  DAGErrorJSON,
  JsonSchema,
  JsonSchemaObject,
  JsonSchemaTypeName,
} from './entities/index.js';

// =============================================================================
// RUNTIME
// =============================================================================

export {
  BackoffStrategy,
  Clock,
  NoopInstrumentation,
  RealTimeScheduler,
  RetryPolicy,
  Scheduler,
} from './runtime/index.js';
export type {
  BackoffStrategyValue,
  ClockProvider,
  ErrorConstructorType,
  RetryPolicyOptionsInterface,
  SchedulerHandle,
  SchedulerProvider,
} from './runtime/index.js';

// =============================================================================
// FUNCTIONS
// =============================================================================

export { Dagonizer, SCATTER_PROGRESS_KEY } from './Dagonizer.js';
export type { DagonizerOptionsInterface, ScatterItemResult, ScatterProgress, StoredScatterProgress } from './Dagonizer.js';
export { Execution } from './Execution.js';

// =============================================================================
// CORE: pluggable execution primitives
// =============================================================================

export {
  ParallelCombiner,
  ParallelCombiners,
} from './core/ParallelCombiners.js';
export type { ParallelResult } from './core/ParallelCombiners.js';
export {
  GatherStrategies,
  GatherStrategy,
} from './core/GatherStrategies.js';
export type { GatherExecution, GatherRecord } from './core/GatherStrategies.js';
export {
  OutcomeReducers,
  OutcomeReducer,
} from './core/OutcomeReducers.js';
export type { OutcomeRecord } from './core/OutcomeReducers.js';

// =============================================================================
// CHECKPOINT
// =============================================================================

export { Checkpoint, MemoryCheckpointStore } from './checkpoint/index.js';
export type { CaptureOptionsInterface, RecalledCheckpoint, StateRestoreFnType } from './checkpoint/index.js';

// =============================================================================
// STORE
// =============================================================================

export { BaseStore, MemoryStore, StoreError, TypedStore } from './store/index.js';
export type { BaseStoreOptions, StoreErrorClassification } from './store/index.js';

// =============================================================================
// CLASS-SHAPE INTERFACES (colocated with their class)
// =============================================================================

export type { DagonizerInterface, DispatcherBundle } from './Dagonizer.js';
export type { NodeStateInterface } from './NodeStateBase.js';

// =============================================================================
// CONTRACTS (adapter-pattern interfaces)
// =============================================================================

export type { ExecuteOptionsInterface } from './contracts/ExecuteOptionsInterface.js';
export type { Instrumentation } from './contracts/Instrumentation.js';
export type { Chainable, NodeInterface } from './contracts/NodeInterface.js';
export type { OperationContractFragment } from './contracts/OperationContractFragment.js';
export type { RemoteStore, RemoteStoreEndpoint, RemoteStoreLease } from './contracts/RemoteStore.js';
export type { Snapshottable, StoreSnapshot, StoreSnapshotEntry } from './contracts/Snapshottable.js';
export type { Store } from './contracts/Store.js';

// =============================================================================
// ADAPTER: LLM adapter contract, registry, and cascade selector
// =============================================================================

export {
  AdapterDescriptor,
  BaseEmbedder,
  Classifications,
  EmbedderCascade,
  EmbedderRegistry,
  LlmAdapterCascade,
  LlmAdapterRegistry,
  LlmError,
} from './adapter/index.js';
export type {
  AdapterDescriptorShape,
  AdapterFactory,
  BaseEmbedderOptions,
  CascadePreference,
  Embedder,
  EmbedderCascadePreference,
  EmbedderFactory,
  ErrorClassification,
  LlmErrorReason,
} from './adapter/index.js';

// =============================================================================
// ENTITY-NARROWING INTERFACES (colocated with entity)
// =============================================================================

export type { NodeContextInterface } from './entities/node/NodeContext.js';
export type { NodeErrorInterface } from './entities/node/NodeError.js';
export type { NodeOutputInterface } from './entities/node/NodeOutput.js';
export type { NodeResultInterface } from './entities/node/NodeResult.js';
export type { ExecutionResultInterface } from './entities/execution/ExecutionResult.js';
export type { SingleNodePlacementInterface } from './entities/dag/SingleNode.js';
export type { TerminalNodePlacementInterface } from './entities/dag/TerminalNode.js';
export type { PhaseNodePlacementInterface } from './entities/dag/PhaseNode.js';
