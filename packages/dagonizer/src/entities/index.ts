/**
 * Entity registry — JSON Schema + derived TS type per shape.
 *
 * Layout mirrors the nocturne `entities/` convention so the package can swap
 * in `@noocodex/jsontology` without restructuring:
 *
 *   dag/             — DAG and its node-entry sub-shapes
 *   state-machines/  — DAGLifecycleState wire shape
 *   node/            — Node, NodeContext, NodeOutput, NodeError, NodeWarning, NodeResult, NodeStateData
 *   execution/       — ExecutionResult
 *   validation/      — ValidationResult
 *   errors/          — DAGErrorJSON
 *   constants/       — FanInStrategyName, FanOutOutput, MetadataKey, Output, ParallelCombine, NodeType
 *   runtime/         — BackoffStrategy
 *   primitives/      — JsonSchema (draft-2020-12 TS model)
 *
 * When jsontology lands, replace each `FromSchema<typeof FooSchema>` derived
 * type with `EntityType<typeof FooSchema['$id']>` and register every Schema
 * value in a sibling `jt.ts`. The schema bodies and `$id`s do not change.
 */

// ---------------------------------------------------------------------------
// dag
// ---------------------------------------------------------------------------

export { FanInConfigSchema } from './dag/FanInConfig.js';
export type { FanInConfig } from './dag/FanInConfig.js';

export { SingleNodeSchema } from './dag/SingleNode.js';
export type { SingleNode } from './dag/SingleNode.js';

export { ParallelNodeSchema } from './dag/ParallelNode.js';
export type { ParallelNode } from './dag/ParallelNode.js';

export { FanOutNodeSchema } from './dag/FanOutNode.js';
export type { FanOutNode } from './dag/FanOutNode.js';

export { DeepDAGNodeSchema } from './dag/DeepDAGNode.js';
export type { DeepDAGNode } from './dag/DeepDAGNode.js';

export { TerminalNodeSchema } from './dag/TerminalNode.js';
export type { TerminalNode } from './dag/TerminalNode.js';

export { DAGSchema, DAG_CONTEXT } from './dag/DAG.js';
export type { DAG } from './dag/DAG.js';

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

// ---------------------------------------------------------------------------
// node
// ---------------------------------------------------------------------------

export { NodeSchema } from './node/Node.js';
export type { Node } from './node/Node.js';

export { NodeContextSchema } from './node/NodeContext.js';
export type { NodeContext } from './node/NodeContext.js';

export { NodeErrorSchema } from './node/NodeError.js';
export type { NodeError } from './node/NodeError.js';

export { NodeWarningSchema } from './node/NodeWarning.js';
export type { NodeWarning } from './node/NodeWarning.js';

export { NodeOutputSchema } from './node/NodeOutput.js';
export type { NodeOutput } from './node/NodeOutput.js';

export { NodeResultSchema } from './node/NodeResult.js';
export type { NodeResult } from './node/NodeResult.js';

export { NodeStateDataSchema } from './node/NodeStateData.js';
export type { NodeStateData } from './node/NodeStateData.js';

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------

export { ExecutionResultSchema } from './execution/ExecutionResult.js';
export type { ExecutionResult } from './execution/ExecutionResult.js';

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

export { FanInStrategySchema, FanInStrategyName } from './constants/FanInStrategy.js';
export { FanOutOutputSchema, FanOutOutput } from './constants/FanOutOutput.js';
export { MetadataKeySchema, MetadataKey } from './constants/MetadataKey.js';
export { OutputSchema, Output } from './constants/Output.js';
export { ParallelCombineSchema, ParallelCombine } from './constants/ParallelCombine.js';
export { NodeTypeSchema, NodeType } from './constants/NodeType.js';

// ---------------------------------------------------------------------------
// runtime
// ---------------------------------------------------------------------------

export { BackoffStrategySchema, BackoffStrategy } from './runtime/BackoffStrategy.js';
export type { BackoffStrategyValue } from './runtime/BackoffStrategy.js';

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
