/**
 * Entity registry: JSON Schema + derived TS type per shape.
 *
 * Entities are grouped by domain so each schema and its derived type live
 * together:
 *
 *   adapter/: LLM chat wire shapes (ChatMessageType, ChatResponseType, ChatStreamChunkType, …)
 *   agent/: ReasoningStepType, ReasoningTraceItemType (agent reasoning-trace steps)
 *   dag/: DAGType and its node-entry sub-shapes
 *   state-machines/: DAGLifecycleStateType wire shape
 *   node/: NodeUnionType, NodeContextType, NodeOutputType, NodeErrorType, NodeWarningType, NodeResultType, NodeStateDataType
 *   execution/: ExecutionResultType
 *   validation/: ValidationResultType
 *   constants/: GatherStrategyNames, ScatterOutputNames, MetadataKeys, OutputNames, NodeTypes
 *   runtime/: BackoffStrategyNames
 *   primitives/: JsonSchemaType (draft-2020-12 TS model)
 *
 * Every `FromSchema`-derived entity type carries a `Type` suffix; the schema
 * value keeps its `*Schema` name; narrowing types (runtime extensions) take
 * over the `*Type` name with `*WireType` reserved for the raw wire shape.
 *
 * When jsontology lands, replace each `FromSchema<typeof FooSchema>` derived
 * type with `EntityType<typeof FooSchema['$id']>` and register every Schema
 * value in a sibling `jt.ts`. The schema bodies and `$id`s do not change.
 */

// ---------------------------------------------------------------------------
// dag
// ---------------------------------------------------------------------------

export { SingleNodeSchema } from './dag/SingleNode.js';
export type { SingleNodeType, SingleNodePlacementType } from './dag/SingleNode.js';

export { TerminalNodeSchema } from './dag/TerminalNode.js';
export type { TerminalNodeType } from './dag/TerminalNode.js';

export { PhaseNodeSchema } from './dag/PhaseNode.js';
export type { PhaseNodeType } from './dag/PhaseNode.js';

export { GatherConfigSchema } from './dag/GatherConfig.js';
export type { GatherConfigType } from './dag/GatherConfig.js';

export { ScatterNodeSchema, ScatterNodeDefaults } from './dag/ScatterNode.js';
export type { ScatterNodeType, ScatterThrottleOptionsType, ScatterExecutionOptionsType, ScatterExecutionPolicyType } from './dag/ScatterNode.js';

export { EmbeddedDAGNodeSchema, EmbeddedDAGNodeDefaults } from './dag/EmbeddedDAGNode.js';
export type { EmbeddedDAGNodeType } from './dag/EmbeddedDAGNode.js';

export { DAGSchema, DAG_CONTEXT, DAGIdentity } from './dag/DAG.js';
export type { DAGType } from './dag/DAG.js';

export { Placement } from './dag/Placement.js';
export type { DAGNodeType } from './dag/Placement.js';

// ---------------------------------------------------------------------------
// state-machines
// ---------------------------------------------------------------------------

export { DAGLifecycleStateSchema } from './state-machines/DAGLifecycleState.js';
export type { DAGLifecycleStateDataType } from './state-machines/DAGLifecycleState.js';

// ---------------------------------------------------------------------------
// checkpoint
// ---------------------------------------------------------------------------

export {
  CheckpointDataSchema,
} from './checkpoint/CheckpointData.js';
export type { CheckpointDataType } from './checkpoint/CheckpointData.js';

export { StoreSnapshotEntrySchema, StoreSnapshotSchema } from './checkpoint/StoreSnapshot.js';
export type { StoreSnapshotEntryWireType, StoreSnapshotWireType } from './checkpoint/StoreSnapshot.js';

// ---------------------------------------------------------------------------
// node
// ---------------------------------------------------------------------------

export { NodeSchema } from './node/Node.js';
export type { NodeUnionType } from './node/Node.js';

export { NodeContextSchema, NodeContext } from './node/NodeContext.js';
export type { NodeContextWireType, NodeContextType } from './node/NodeContext.js';

export { NodeError, NodeErrorProperties, NodeErrorSchema } from './node/NodeError.js';
export type { NodeErrorWireType, NodeErrorType } from './node/NodeError.js';

export { NodeWarningProperties, NodeWarningSchema } from './node/NodeWarning.js';
export type { NodeWarningType } from './node/NodeWarning.js';

export { NodeOutputSchema, NodeOutput } from './node/NodeOutput.js';
export type { NodeOutputWireType, NodeOutputType } from './node/NodeOutput.js';

export { NodeResultSchema } from './node/NodeResult.js';
export type { NodeResultWireType, NodeResultType } from './node/NodeResult.js';

export { NodeStateDataSchema } from './node/NodeStateData.js';
export type { NodeStateDataType } from './node/NodeStateData.js';

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------

export { ExecutionResultSchema, InterruptionInfoSchema } from './execution/ExecutionResult.js';
export type { ExecutionResultWireType, ExecutionResultType, InterruptionInfoType } from './execution/ExecutionResult.js';

export { ParkedSchema } from './execution/Parked.js';
export type { ParkedType } from './execution/Parked.js';

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

export { ValidationResultSchema } from './validation/ValidationResult.js';
export type { ValidationResultType } from './validation/ValidationResult.js';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

// Each constant exports a value (the named-keys frozen record, distinct
// plural name) and a type (the union of permitted string literals, `Type`
// suffix). The value and type carry distinct names: `GatherStrategyNames`
// the value, `GatherStrategyNameType` the type.

export { GatherStrategySchema, GatherStrategyNames } from './constants/GatherStrategy.js';
export type { GatherStrategyNameType } from './constants/GatherStrategy.js';
export { ScatterOutputSchema, ScatterOutputNames } from './constants/ScatterOutput.js';
export type { ScatterOutputType } from './constants/ScatterOutput.js';
export { MetadataKeySchema, MetadataKeys } from './constants/MetadataKey.js';
export type { MetadataKeyType } from './constants/MetadataKey.js';
export { OutputSchema, OutputNames } from './constants/Output.js';
export type { OutputType } from './constants/Output.js';
export { NodeTypeSchema, NodeTypes } from './constants/NodeType.js';
export type { NodeType } from './constants/NodeType.js';

// ---------------------------------------------------------------------------
// runtime
// ---------------------------------------------------------------------------

export { BackoffStrategySchema, BackoffStrategyNames } from './runtime/BackoffStrategy.js';
export type { BackoffStrategyType } from './runtime/BackoffStrategy.js';

// ---------------------------------------------------------------------------
// executor (container wire shapes)
// ---------------------------------------------------------------------------

export { ExecutorIntermediateSchema } from './executor/ExecutorIntermediate.js';
export type { ExecutorIntermediateType } from './executor/ExecutorIntermediate.js';

export { ExecutionRequestSchema } from './executor/ExecutionRequest.js';
export type { ExecutionRequestType } from './executor/ExecutionRequest.js';

export { ExecutionResponseSchema } from './executor/ExecutionResponse.js';
export type { ExecutionResponseType } from './executor/ExecutionResponse.js';

export { BridgeMessage, BridgeMessageSchema } from './executor/BridgeMessage.js';
export type { BridgeMessageType } from './executor/BridgeMessage.js';

export {
  RecommendedWorkerCountConfigSchema,
  RecommendedWorkerCountConfigDefault,
  RECOMMENDED_WORKER_COUNT_MAIN_THREAD_RESERVATION,
  RECOMMENDED_WORKER_COUNT_FALLBACK,
  RECOMMENDED_WORKER_COUNT_MEMORY_PER_WORKER_BYTES,
} from './executor/RecommendedWorkerCountConfig.js';
export type { RecommendedWorkerCountConfigType } from './executor/RecommendedWorkerCountConfig.js';

export { SystemInfo } from './executor/SystemInfo.js';
export type { SystemInfoProbesType } from './executor/SystemInfo.js';

// ---------------------------------------------------------------------------
// handoff
// ---------------------------------------------------------------------------

export { DAGHandoffSchema } from './handoff/DAGHandoff.js';
export type { DAGHandoffType } from './handoff/DAGHandoff.js';

// ---------------------------------------------------------------------------
// scatter (checkpoint wire shapes)
// ---------------------------------------------------------------------------

export {
  ScatterInboxItemSchema,
  ScatterAckedResultSchema,
  ScatterProgressSchema,
  StoredScatterProgressSchema,
} from './scatter/ScatterProgress.js';
export type {
  ScatterInboxItemType,
  ScatterAckedResultType,
  ScatterProgressType,
  StoredScatterProgressType,
} from './scatter/ScatterProgress.js';

// ---------------------------------------------------------------------------
// workset (checkpoint wire shapes)
// ---------------------------------------------------------------------------

export {
  WorkSetItemSchema,
  WorkSetEntrySchema,
  WorkSetProgressSchema,
} from './workset/WorkSetProgress.js';
export type {
  WorkSetItemType,
  WorkSetEntryType,
  WorkSetProgressType,
} from './workset/WorkSetProgress.js';

// ---------------------------------------------------------------------------
// adapter (LLM chat wire shapes)
// ---------------------------------------------------------------------------

export type { AdapterCapabilitiesType } from './adapter/AdapterCapabilities.js';

export { ChatMessageSchema } from './adapter/ChatMessage.js';
export type { ChatMessageType } from './adapter/ChatMessage.js';

export type { ChatRequestType, LlmOutputSchemaType, PartialChatRequestType, ToolChoiceType } from './adapter/ChatRequest.js';

export { ChatResponseSchema } from './adapter/ChatResponse.js';
export type { ChatResponseType } from './adapter/ChatResponse.js';

export { ChatResponseMessageSchema } from './adapter/ChatResponseMessage.js';
export type { ChatResponseMessageType } from './adapter/ChatResponseMessage.js';

export { ChatStreamChunkSchema, ChatStreamChunk } from './adapter/ChatStreamChunk.js';
export type { ChatStreamChunkType } from './adapter/ChatStreamChunk.js';

export { LlmModelSchema } from './adapter/LlmModel.js';
export type { LlmModelType } from './adapter/LlmModel.js';

export { RoutedChatStreamChunkSchema, RoutedChatStreamChunk } from './adapter/RoutedChatStreamChunk.js';
export type { RoutedChatStreamChunkType } from './adapter/RoutedChatStreamChunk.js';

export { OpenAiModelsResponseSchema } from './adapter/OpenAiModelsResponse.js';
export type { OpenAiModelsResponseType } from './adapter/OpenAiModelsResponse.js';

export { TextChannelToolCallEnvelopeSchema } from './adapter/TextChannelToolCallEnvelope.js';
export type { TextChannelToolCallEnvelopeType } from './adapter/TextChannelToolCallEnvelope.js';

export { TokenUsageSchema } from './adapter/TokenUsage.js';
export type { TokenUsageType } from './adapter/TokenUsage.js';

export { ToolCallSchema } from './adapter/ToolCall.js';
export type { ToolCallType } from './adapter/ToolCall.js';

export { ToolDefinitionSchema } from './adapter/ToolDefinition.js';
export type { ToolDefinitionType } from './adapter/ToolDefinition.js';

// ---------------------------------------------------------------------------
// agent (reasoning-trace wire shapes)
// ---------------------------------------------------------------------------

export { ReasoningStepSchema, ReasoningStep } from './agent/ReasoningStep.js';
export type { ReasoningStepType } from './agent/ReasoningStep.js';
export { ReasoningTraceItemSchema, ReasoningTraceItem } from './agent/ReasoningTraceItem.js';
export type { ReasoningTraceItemType } from './agent/ReasoningTraceItem.js';

// ---------------------------------------------------------------------------
// json primitives
// ---------------------------------------------------------------------------

export type {
  JsonArrayType,
  JsonObjectType,
  JsonPrimitiveType,
  JsonValueType,
} from './json.js';
export { JsonObject } from './json.js';
export { JsonValue } from './JsonValue.js';

export type {
  JsonSchemaType,
  JsonSchemaObjectType,
  JsonSchemaTypeNameType,
} from './primitives/JsonSchema.js';
