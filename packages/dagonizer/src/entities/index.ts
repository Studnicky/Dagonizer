/**
 * Entity registry: JSON Schema + derived TS type per shape.
 *
 * Entities are grouped by domain so each schema and its derived type live
 * together:
 *
 *   dag/: DAG and its node-entry sub-shapes
 *   state-machines/: DAGLifecycleState wire shape
 *   node/: Node, NodeContext, NodeOutput, NodeError, NodeWarning, NodeResult, NodeStateData
 *   execution/: ExecutionResult
 *   validation/: ValidationResult
 *   errors/: DAGErrorJSON
 *   constants/: GatherStrategyName, ScatterOutput, MetadataKey, Output, NodeType
 *   runtime/: BackoffStrategy
 *   primitives/: JsonSchema (draft-2020-12 TS model)
 *
 * When jsontology lands, replace each `FromSchema<typeof FooSchema>` derived
 * type with `EntityType<typeof FooSchema['$id']>` and register every Schema
 * value in a sibling `jt.ts`. The schema bodies and `$id`s do not change.
 */

// ---------------------------------------------------------------------------
// dag
// ---------------------------------------------------------------------------

export { SingleNodeSchema } from './dag/SingleNode.js';
export type { SingleNode, SingleNodePlacementInterface } from './dag/SingleNode.js';

export { TerminalNodeSchema } from './dag/TerminalNode.js';
export type { TerminalNode } from './dag/TerminalNode.js';

export { PhaseNodeSchema } from './dag/PhaseNode.js';
export type { PhaseNode } from './dag/PhaseNode.js';

export { GatherConfigSchema } from './dag/GatherConfig.js';
export type { GatherConfig } from './dag/GatherConfig.js';

export { ScatterNodeSchema, ScatterNodeDefaults } from './dag/ScatterNode.js';
export type { ScatterNode } from './dag/ScatterNode.js';

export { EmbeddedDAGNodeSchema, EmbeddedDAGNodeDefaults } from './dag/EmbeddedDAGNode.js';
export type { EmbeddedDAGNode } from './dag/EmbeddedDAGNode.js';

export { DAGSchema, DAG_CONTEXT, DAG } from './dag/DAG.js';

export { Placement } from './dag/Placement.js';
export type { DAGNodeType } from './dag/Placement.js';

// ---------------------------------------------------------------------------
// state-machines
// ---------------------------------------------------------------------------

export { DAGLifecycleStateSchema } from './state-machines/DAGLifecycleState.js';
export type { DAGLifecycleStateData } from './state-machines/DAGLifecycleState.js';

// ---------------------------------------------------------------------------
// checkpoint
// ---------------------------------------------------------------------------

export {
  CHECKPOINT_DATA_VERSION,
  CheckpointDataSchema,
} from './checkpoint/CheckpointData.js';
export type { CheckpointData } from './checkpoint/CheckpointData.js';

export { StoreSnapshotEntrySchema, StoreSnapshotSchema } from './checkpoint/StoreSnapshot.js';
export type { StoreSnapshotEntry, StoreSnapshot } from './checkpoint/StoreSnapshot.js';

// ---------------------------------------------------------------------------
// node
// ---------------------------------------------------------------------------

export { NodeSchema } from './node/Node.js';
export type { Node } from './node/Node.js';

export { NodeContextSchema } from './node/NodeContext.js';
export type { NodeContext, NodeContextInterface } from './node/NodeContext.js';

export { NodeErrorBuilder, NodeErrorProperties, NodeErrorSchema } from './node/NodeError.js';
export type { NodeError, NodeErrorInterface } from './node/NodeError.js';

export { NodeWarningProperties, NodeWarningSchema } from './node/NodeWarning.js';
export type { NodeWarning } from './node/NodeWarning.js';

export { NodeOutputSchema, NodeOutputBuilder } from './node/NodeOutput.js';
export type { NodeOutput, NodeOutputInterface } from './node/NodeOutput.js';

export { NodeResultSchema } from './node/NodeResult.js';
export type { NodeResult, NodeResultInterface } from './node/NodeResult.js';

export { NodeStateDataSchema } from './node/NodeStateData.js';
export type { NodeStateData } from './node/NodeStateData.js';

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------

export { ExecutionResultSchema, InterruptionInfoSchema } from './execution/ExecutionResult.js';
export type { ExecutionResult, ExecutionResultInterface, InterruptionInfo } from './execution/ExecutionResult.js';

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

export { ValidationResultSchema } from './validation/ValidationResult.js';
export type { ValidationResult } from './validation/ValidationResult.js';

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

export { DAGErrorJSONSchema } from './errors/DAGErrorJSON.js';
export type { DAGErrorJSON } from './errors/DAGErrorJSON.js';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

// Each constant exports a value (the named-keys frozen record) and a type
// (the union of permitted string literals) under the same identifier.
// `export { X }` re-exports both halves.

export { GatherStrategySchema, GatherStrategyName } from './constants/GatherStrategy.js';
export { ScatterOutputSchema, ScatterOutput } from './constants/ScatterOutput.js';
export { MetadataKeySchema, MetadataKey } from './constants/MetadataKey.js';
export { OutputSchema, Output } from './constants/Output.js';
export { NodeTypeSchema, NodeType } from './constants/NodeType.js';

// ---------------------------------------------------------------------------
// runtime
// ---------------------------------------------------------------------------

export { BackoffStrategySchema, BackoffStrategy } from './runtime/BackoffStrategy.js';

// ---------------------------------------------------------------------------
// executor (container wire shapes)
// ---------------------------------------------------------------------------

export { ExecutorIntermediateSchema } from './executor/ExecutorIntermediate.js';
export type { ExecutorIntermediate } from './executor/ExecutorIntermediate.js';

export { ExecutionRequestSchema } from './executor/ExecutionRequest.js';
export type { ExecutionRequest } from './executor/ExecutionRequest.js';

export { ExecutionResponseSchema } from './executor/ExecutionResponse.js';
export type { ExecutionResponse } from './executor/ExecutionResponse.js';

export { BridgeMessageBuilder, BridgeMessageSchema } from './executor/BridgeMessage.js';
export type { BridgeMessage } from './executor/BridgeMessage.js';

export {
  RecommendedWorkerCountConfigSchema,
  RecommendedWorkerCountConfigDefault,
  RECOMMENDED_WORKER_COUNT_MAIN_THREAD_RESERVATION,
  RECOMMENDED_WORKER_COUNT_FALLBACK,
  RECOMMENDED_WORKER_COUNT_MEMORY_PER_WORKER_BYTES,
} from './executor/RecommendedWorkerCountConfig.js';
export type { RecommendedWorkerCountConfig } from './executor/RecommendedWorkerCountConfig.js';

export { SystemInfo } from './executor/SystemInfo.js';
export type { SystemInfoProbes } from './executor/SystemInfo.js';

// ---------------------------------------------------------------------------
// handoff
// ---------------------------------------------------------------------------

export { DAGHandoffSchema } from './handoff/DAGHandoff.js';
export type { DAGHandoff } from './handoff/DAGHandoff.js';

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
  ScatterInboxItem,
  ScatterAckedResult,
  ScatterProgress,
  StoredScatterProgress,
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
  WorkSetItem,
  WorkSetEntry,
  WorkSetProgress,
} from './workset/WorkSetProgress.js';

// ---------------------------------------------------------------------------
// adapter (LLM chat wire shapes)
// ---------------------------------------------------------------------------

export type { AdapterCapabilities } from './adapter/AdapterCapabilities.js';

export { ChatMessageSchema } from './adapter/ChatMessage.js';
export type { ChatMessage } from './adapter/ChatMessage.js';

export type { ChatRequest, LlmOutputSchema, PartialChatRequest, ToolChoice } from './adapter/ChatRequest.js';

export { ChatResponseSchema } from './adapter/ChatResponse.js';
export type { ChatResponse } from './adapter/ChatResponse.js';

export { ChatResponseMessageSchema } from './adapter/ChatResponseMessage.js';
export type { ChatResponseMessage } from './adapter/ChatResponseMessage.js';

export { TextChannelToolCallEnvelopeSchema } from './adapter/TextChannelToolCallEnvelope.js';
export type { TextChannelToolCallEnvelope } from './adapter/TextChannelToolCallEnvelope.js';

export { TokenUsageSchema } from './adapter/TokenUsage.js';
export type { TokenUsage } from './adapter/TokenUsage.js';

export { ToolCallSchema } from './adapter/ToolCall.js';
export type { ToolCall } from './adapter/ToolCall.js';

export { ToolDefinitionSchema } from './adapter/ToolDefinition.js';
export type { ToolDefinition } from './adapter/ToolDefinition.js';

// ---------------------------------------------------------------------------
// json primitives
// ---------------------------------------------------------------------------

export type {
  JsonArray,
  JsonObject,
  JsonPrimitive,
  JsonValue,
} from './json.js';

export type {
  JsonSchema,
  JsonSchemaObject,
  JsonSchemaTypeName,
} from './primitives/JsonSchema.js';
