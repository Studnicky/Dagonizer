/**
 * Validator: unified Ajv-backed entity validator.
 *
 * Compiled once at module load (schemas are compile-time invariants).
 * Static class; namespaced sub-validators per entity:
 *
 *   Validator.dag.is(x):       type predicate
 *   Validator.dag.validate(x): narrow or throw ValidationError
 *   Validator.dag.errors(x):   formatted error strings or null
 *
 * Every top-level entity schema in `entities/` ships with a
 * sub-validator on this class. Consumers call them as
 * `Validator.<entityCamel>.<verb>(value)`.
 */

import type { ErrorObject, ValidateFunction } from 'ajv';

import type { OpenAiResponseBody } from '../adapter/OpenAiResponseBody.js';
import { OpenAiResponseBodySchema } from '../adapter/OpenAiResponseBody.js';
import { CheckpointDataSchema } from '../entities/checkpoint/CheckpointData.js';
import type { CheckpointData } from '../entities/checkpoint/CheckpointData.js';
import { GatherStrategySchema } from '../entities/constants/GatherStrategy.js';
import type { GatherStrategyName } from '../entities/constants/GatherStrategy.js';
import { MetadataKeySchema } from '../entities/constants/MetadataKey.js';
import type { MetadataKey } from '../entities/constants/MetadataKey.js';
import { NodeTypeSchema } from '../entities/constants/NodeType.js';
import type { NodeType } from '../entities/constants/NodeType.js';
import { OutputSchema } from '../entities/constants/Output.js';
import type { Output } from '../entities/constants/Output.js';
import { ScatterOutputSchema } from '../entities/constants/ScatterOutput.js';
import type { ScatterOutput } from '../entities/constants/ScatterOutput.js';
import type { DAG } from '../entities/dag/DAG.js';
import { DAGSchema } from '../entities/dag/DAG.js';
import { EmbeddedDAGNodeSchema } from '../entities/dag/EmbeddedDAGNode.js';
import type { EmbeddedDAGNode } from '../entities/dag/EmbeddedDAGNode.js';
import { GatherConfigSchema } from '../entities/dag/GatherConfig.js';
import type { GatherConfig } from '../entities/dag/GatherConfig.js';
import type { PhaseNode } from '../entities/dag/PhaseNode.js';
import { PhaseNodeSchema } from '../entities/dag/PhaseNode.js';
import { ScatterNodeSchema } from '../entities/dag/ScatterNode.js';
import type { ScatterNode } from '../entities/dag/ScatterNode.js';
import type { SingleNode } from '../entities/dag/SingleNode.js';
import { SingleNodeSchema } from '../entities/dag/SingleNode.js';
import type { TerminalNode } from '../entities/dag/TerminalNode.js';
import { TerminalNodeSchema } from '../entities/dag/TerminalNode.js';
import { DAGErrorJSONSchema } from '../entities/errors/DAGErrorJSON.js';
import type { DAGErrorJSON } from '../entities/errors/DAGErrorJSON.js';
import { ExecutionResultSchema, InterruptionInfoSchema } from '../entities/execution/ExecutionResult.js';
import type { ExecutionResult, InterruptionInfo } from '../entities/execution/ExecutionResult.js';
import type { BridgeMessage } from '../entities/executor/BridgeMessage.js';
import { BridgeMessageSchema } from '../entities/executor/BridgeMessage.js';
import { ExecutionRequestSchema } from '../entities/executor/ExecutionRequest.js';
import type { ExecutionRequest } from '../entities/executor/ExecutionRequest.js';
import { ExecutionResponseSchema } from '../entities/executor/ExecutionResponse.js';
import type { ExecutionResponse } from '../entities/executor/ExecutionResponse.js';
import { ExecutorIntermediateSchema } from '../entities/executor/ExecutorIntermediate.js';
import type { ExecutorIntermediate } from '../entities/executor/ExecutorIntermediate.js';
import { RecommendedWorkerCountConfigSchema } from '../entities/executor/RecommendedWorkerCountConfig.js';
import type { RecommendedWorkerCountConfig } from '../entities/executor/RecommendedWorkerCountConfig.js';
import type { DAGHandoff } from '../entities/handoff/DAGHandoff.js';
import { DAGHandoffSchema } from '../entities/handoff/DAGHandoff.js';
import { NodeSchema } from '../entities/node/Node.js';
import type { Node } from '../entities/node/Node.js';
import { NodeContextSchema } from '../entities/node/NodeContext.js';
import type { NodeContext } from '../entities/node/NodeContext.js';
import { NodeErrorSchema } from '../entities/node/NodeError.js';
import type { NodeError } from '../entities/node/NodeError.js';
import { NodeOutputSchema } from '../entities/node/NodeOutput.js';
import type { NodeOutput } from '../entities/node/NodeOutput.js';
import { NodeResultSchema } from '../entities/node/NodeResult.js';
import type { NodeResult } from '../entities/node/NodeResult.js';
import { NodeStateDataSchema } from '../entities/node/NodeStateData.js';
import type { NodeStateData } from '../entities/node/NodeStateData.js';
import { NodeWarningSchema } from '../entities/node/NodeWarning.js';
import type { NodeWarning } from '../entities/node/NodeWarning.js';
import type { BackoffStrategy } from '../entities/runtime/BackoffStrategy.js';
import { BackoffStrategySchema } from '../entities/runtime/BackoffStrategy.js';
import type {
  ScatterAckedResult,
  ScatterInboxItem,
  ScatterProgress,
  StoredScatterProgress,
} from '../entities/scatter/ScatterProgress.js';
import {
  ScatterAckedResultSchema,
  ScatterInboxItemSchema,
  ScatterProgressSchema,
  StoredScatterProgressSchema,
} from '../entities/scatter/ScatterProgress.js';
import { DAGLifecycleStateSchema } from '../entities/state-machines/DAGLifecycleState.js';
import type { DAGLifecycleStateData } from '../entities/state-machines/DAGLifecycleState.js';
import { ValidationResultSchema } from '../entities/validation/ValidationResult.js';
import type { ValidationResult } from '../entities/validation/ValidationResult.js';
import { ValidationError } from '../errors/DAGError.js';

import { sharedAjv } from './sharedAjv.js';

/** Per-entity validator interface returned by every `Validator.<entity>` field. */
export interface EntityValidator<T> {
  /** Type predicate. Returns true when value satisfies the schema. */
  is(value: unknown): value is T;
  /** Throws ValidationError if invalid; returns value narrowed to T on success. */
  validate(value: unknown): T;
  /** Returns formatted error strings, or null if valid. */
  errors(value: unknown): string[] | null;
}

/**
 * Unified Ajv-backed validator. Access per-entity sub-validators via
 * static fields. Every top-level entity schema in `entities/` has a
 * sub-validator here.
 */
export class Validator {
  private constructor() { /* static class */ }

  /**
   * Format an Ajv error list into human-readable strings keyed by
   * instance path. Used internally by every per-entity validator's
   * `validate` / `errors` method.
   */
  private static formatErrors(errors: readonly ErrorObject[]): string[] {
    return errors.map((error) => {
      const path = error.instancePath.length > 0 ? error.instancePath : '<root>';
      return `${path}: ${error.message ?? 'invalid'}`;
    });
  }

  /**
   * Compile a schema into a typed `EntityValidator<T>`. Schemas
   * embedded in others (e.g. `GatherConfigSchema` inlined in
   * `DAGSchema`) already register their `$id` when the parent
   * compiles; this method looks the already-registered validator up
   * before compiling fresh.
   */
  private static compile<T>(name: string, schema: { readonly $id?: string }): EntityValidator<T> {
    const id = schema.$id;
    let compiled: ValidateFunction | undefined;
    if (id !== undefined) {
      const cached = sharedAjv.getSchema(id);
      if (typeof cached === 'function') {
        compiled = cached;
      }
    }
    if (compiled === undefined) {
      compiled = sharedAjv.compile(schema);
    }
    const validator = compiled;
    return {
      is(value): value is T {
        return validator(value) === true;
      },
      validate(value): T {
        if (validator(value) === true) return value as T;
        const ajvErrors: readonly ErrorObject[] = validator.errors ?? [];
        throw new ValidationError(
          `Invalid ${name}:\n  - ${Validator.formatErrors(ajvErrors).join('\n  - ')}`,
          { 'context': { ajvErrors } },
        );
      },
      errors(value): string[] | null {
        if (validator(value) === true) return null;
        return Validator.formatErrors(validator.errors ?? []);
      },
    };
  }

  // Bridge protocol
  static readonly bridgeMessage: EntityValidator<BridgeMessage> = Validator.compile('BridgeMessage', BridgeMessageSchema);

  // DAG: top-level definition
  static readonly dag:             EntityValidator<DAG>             = Validator.compile('DAG',             DAGSchema);
  static readonly singleNode:      EntityValidator<SingleNode>      = Validator.compile('SingleNode',      SingleNodeSchema);
  static readonly scatterNode:     EntityValidator<ScatterNode>     = Validator.compile('ScatterNode',     ScatterNodeSchema);
  static readonly embeddedDAGNode: EntityValidator<EmbeddedDAGNode> = Validator.compile('EmbeddedDAGNode', EmbeddedDAGNodeSchema);
  static readonly terminalNode: EntityValidator<TerminalNode>  = Validator.compile('TerminalNode', TerminalNodeSchema);
  static readonly phaseNode:    EntityValidator<PhaseNode>     = Validator.compile('PhaseNode',    PhaseNodeSchema);

  // Node runtime shapes
  static readonly node:          EntityValidator<Node>          = Validator.compile('Node',          NodeSchema);
  static readonly nodeContext:   EntityValidator<NodeContext>   = Validator.compile('NodeContext',   NodeContextSchema);
  static readonly nodeOutput:    EntityValidator<NodeOutput>    = Validator.compile('NodeOutput',    NodeOutputSchema);
  static readonly nodeError:     EntityValidator<NodeError>     = Validator.compile('NodeError',     NodeErrorSchema);
  static readonly nodeWarning:   EntityValidator<NodeWarning>   = Validator.compile('NodeWarning',   NodeWarningSchema);
  static readonly nodeResult:    EntityValidator<NodeResult>    = Validator.compile('NodeResult',    NodeResultSchema);
  static readonly nodeStateData: EntityValidator<NodeStateData> = Validator.compile('NodeStateData', NodeStateDataSchema);

  // Execution + lifecycle wire shapes
  static readonly executionResult:   EntityValidator<ExecutionResult>      = Validator.compile('ExecutionResult',   ExecutionResultSchema);
  static readonly interruptionInfo:  EntityValidator<InterruptionInfo>     = Validator.compile('InterruptionInfo',  InterruptionInfoSchema);
  static readonly dagLifecycleState: EntityValidator<DAGLifecycleStateData> = Validator.compile('DAGLifecycleState', DAGLifecycleStateSchema);

  // Persistence + reporting
  static readonly checkpoint:       EntityValidator<CheckpointData>    = Validator.compile('CheckpointData',    CheckpointDataSchema);
  static readonly validationResult: EntityValidator<ValidationResult>  = Validator.compile('ValidationResult',  ValidationResultSchema);
  static readonly dagErrorJson:     EntityValidator<DAGErrorJSON>      = Validator.compile('DAGErrorJSON',      DAGErrorJSONSchema);

  // Hand-off channels
  static readonly dagHandoff: EntityValidator<DAGHandoff> = Validator.compile('DAGHandoff', DAGHandoffSchema);

  // Executor container wire shapes
  static readonly executionRequest:       EntityValidator<ExecutionRequest>        = Validator.compile('ExecutionRequest',        ExecutionRequestSchema);
  static readonly executionResponse:      EntityValidator<ExecutionResponse>       = Validator.compile('ExecutionResponse',       ExecutionResponseSchema);
  static readonly executorIntermediate:   EntityValidator<ExecutorIntermediate>    = Validator.compile('ExecutorIntermediate',    ExecutorIntermediateSchema);
  static readonly recommendedWorkerCount: EntityValidator<RecommendedWorkerCountConfig> = Validator.compile('RecommendedWorkerCountConfig', RecommendedWorkerCountConfigSchema);

  // DAG sub-entities
  static readonly gatherConfig: EntityValidator<GatherConfig> = Validator.compile('GatherConfig', GatherConfigSchema);

  // Adapter wire shapes
  static readonly openAiResponseBody: EntityValidator<OpenAiResponseBody> = Validator.compile('OpenAiResponseBody', OpenAiResponseBodySchema);

  // Constant enum schemas
  static readonly gatherStrategy: EntityValidator<GatherStrategyName> = Validator.compile('GatherStrategy', GatherStrategySchema);
  static readonly scatterOutput:  EntityValidator<ScatterOutput>      = Validator.compile('ScatterOutput',  ScatterOutputSchema);
  static readonly metadataKey:    EntityValidator<MetadataKey>        = Validator.compile('MetadataKey',    MetadataKeySchema);
  static readonly output:         EntityValidator<Output>             = Validator.compile('Output',         OutputSchema);
  static readonly nodeType:       EntityValidator<NodeType>           = Validator.compile('NodeType',       NodeTypeSchema);
  static readonly backoffStrategy: EntityValidator<BackoffStrategy> = Validator.compile('BackoffStrategy', BackoffStrategySchema);

  // Scatter progress checkpoint wire shapes
  static readonly scatterInboxItem:       EntityValidator<ScatterInboxItem>       = Validator.compile('ScatterInboxItem',       ScatterInboxItemSchema);
  static readonly scatterAckedResult:     EntityValidator<ScatterAckedResult>     = Validator.compile('ScatterAckedResult',     ScatterAckedResultSchema);
  static readonly scatterProgress:        EntityValidator<ScatterProgress>        = Validator.compile('ScatterProgress',        ScatterProgressSchema);
  static readonly storedScatterProgress:  EntityValidator<StoredScatterProgress>  = Validator.compile('StoredScatterProgress',  StoredScatterProgressSchema);
}
