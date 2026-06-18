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
import { TextChannelToolCallEnvelopeSchema } from '../entities/adapter/TextChannelToolCallEnvelope.js';
import type { TextChannelToolCallEnvelope } from '../entities/adapter/TextChannelToolCallEnvelope.js';
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
import type {
  WorkSetEntry,
  WorkSetItem,
  WorkSetProgress,
} from '../entities/workset/WorkSetProgress.js';
import {
  WorkSetEntrySchema,
  WorkSetItemSchema,
  WorkSetProgressSchema,
} from '../entities/workset/WorkSetProgress.js';
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
   * Compile a consumer-supplied schema into a typed `EntityValidator<T>`
   * against the package's single shared Ajv instance. Satellite packages
   * (adapters, embedders, tools) validate their own external wire/host
   * shapes through this method; they never instantiate their own Ajv.
   *
   * The validator name surfaced in thrown `ValidationError` messages is
   * derived from the schema's `$id`. Schemas already registered (because
   * they were compiled before, or inlined in a parent that compiled
   * first) are looked up rather than recompiled.
   *
   * @example
   * const isWidget = Validator.compile<Widget>(WidgetSchema);
   * const widget = isWidget.validate(externalJson);
   */
  static compile<T>(schema: { readonly $id?: string }): EntityValidator<T> {
    return Validator.compileNamed<T>(schema.$id ?? '<schema>', schema);
  }

  /**
   * Compile a schema into a typed `EntityValidator<T>` under an explicit
   * name used in error messages. Backs both the public single-arg
   * `compile(schema)` and every internal per-entity field initializer.
   * Schemas embedded in others (e.g. `GatherConfigSchema` inlined in
   * `DAGSchema`) already register their `$id` when the parent compiles;
   * this method looks the already-registered validator up before
   * compiling fresh.
   */
  private static compileNamed<T>(name: string, schema: { readonly $id?: string }): EntityValidator<T> {
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
  static readonly bridgeMessage: EntityValidator<BridgeMessage> = Validator.compileNamed('BridgeMessage', BridgeMessageSchema);

  // DAG: top-level definition
  static readonly dag:             EntityValidator<DAG>             = Validator.compileNamed('DAG',             DAGSchema);
  static readonly singleNode:      EntityValidator<SingleNode>      = Validator.compileNamed('SingleNode',      SingleNodeSchema);
  static readonly scatterNode:     EntityValidator<ScatterNode>     = Validator.compileNamed('ScatterNode',     ScatterNodeSchema);
  static readonly embeddedDAGNode: EntityValidator<EmbeddedDAGNode> = Validator.compileNamed('EmbeddedDAGNode', EmbeddedDAGNodeSchema);
  static readonly terminalNode: EntityValidator<TerminalNode>  = Validator.compileNamed('TerminalNode', TerminalNodeSchema);
  static readonly phaseNode:    EntityValidator<PhaseNode>     = Validator.compileNamed('PhaseNode',    PhaseNodeSchema);

  // Node runtime shapes
  static readonly node:          EntityValidator<Node>          = Validator.compileNamed('Node',          NodeSchema);
  static readonly nodeContext:   EntityValidator<NodeContext>   = Validator.compileNamed('NodeContext',   NodeContextSchema);
  static readonly nodeOutput:    EntityValidator<NodeOutput>    = Validator.compileNamed('NodeOutput',    NodeOutputSchema);
  static readonly nodeError:     EntityValidator<NodeError>     = Validator.compileNamed('NodeError',     NodeErrorSchema);
  static readonly nodeWarning:   EntityValidator<NodeWarning>   = Validator.compileNamed('NodeWarning',   NodeWarningSchema);
  static readonly nodeResult:    EntityValidator<NodeResult>    = Validator.compileNamed('NodeResult',    NodeResultSchema);
  static readonly nodeStateData: EntityValidator<NodeStateData> = Validator.compileNamed('NodeStateData', NodeStateDataSchema);

  // Execution + lifecycle wire shapes
  static readonly executionResult:   EntityValidator<ExecutionResult>      = Validator.compileNamed('ExecutionResult',   ExecutionResultSchema);
  static readonly interruptionInfo:  EntityValidator<InterruptionInfo>     = Validator.compileNamed('InterruptionInfo',  InterruptionInfoSchema);
  static readonly dagLifecycleState: EntityValidator<DAGLifecycleStateData> = Validator.compileNamed('DAGLifecycleState', DAGLifecycleStateSchema);

  // Persistence + reporting
  static readonly checkpoint:       EntityValidator<CheckpointData>    = Validator.compileNamed('CheckpointData',    CheckpointDataSchema);
  static readonly validationResult: EntityValidator<ValidationResult>  = Validator.compileNamed('ValidationResult',  ValidationResultSchema);
  static readonly dagErrorJson:     EntityValidator<DAGErrorJSON>      = Validator.compileNamed('DAGErrorJSON',      DAGErrorJSONSchema);

  // Hand-off channels
  static readonly dagHandoff: EntityValidator<DAGHandoff> = Validator.compileNamed('DAGHandoff', DAGHandoffSchema);

  // Executor container wire shapes
  static readonly executionRequest:       EntityValidator<ExecutionRequest>        = Validator.compileNamed('ExecutionRequest',        ExecutionRequestSchema);
  static readonly executionResponse:      EntityValidator<ExecutionResponse>       = Validator.compileNamed('ExecutionResponse',       ExecutionResponseSchema);
  static readonly executorIntermediate:   EntityValidator<ExecutorIntermediate>    = Validator.compileNamed('ExecutorIntermediate',    ExecutorIntermediateSchema);
  static readonly recommendedWorkerCount: EntityValidator<RecommendedWorkerCountConfig> = Validator.compileNamed('RecommendedWorkerCountConfig', RecommendedWorkerCountConfigSchema);

  // DAG sub-entities
  static readonly gatherConfig: EntityValidator<GatherConfig> = Validator.compileNamed('GatherConfig', GatherConfigSchema);

  // Adapter wire shapes
  static readonly openAiResponseBody: EntityValidator<OpenAiResponseBody> = Validator.compileNamed('OpenAiResponseBody', OpenAiResponseBodySchema);
  static readonly textChannelToolCallEnvelope: EntityValidator<TextChannelToolCallEnvelope> = Validator.compileNamed('TextChannelToolCallEnvelope', TextChannelToolCallEnvelopeSchema);

  // Constant enum schemas
  static readonly gatherStrategy: EntityValidator<GatherStrategyName> = Validator.compileNamed('GatherStrategy', GatherStrategySchema);
  static readonly scatterOutput:  EntityValidator<ScatterOutput>      = Validator.compileNamed('ScatterOutput',  ScatterOutputSchema);
  static readonly metadataKey:    EntityValidator<MetadataKey>        = Validator.compileNamed('MetadataKey',    MetadataKeySchema);
  static readonly output:         EntityValidator<Output>             = Validator.compileNamed('Output',         OutputSchema);
  static readonly nodeType:       EntityValidator<NodeType>           = Validator.compileNamed('NodeType',       NodeTypeSchema);
  static readonly backoffStrategy: EntityValidator<BackoffStrategy> = Validator.compileNamed('BackoffStrategy', BackoffStrategySchema);

  // Scatter progress checkpoint wire shapes
  static readonly scatterInboxItem:       EntityValidator<ScatterInboxItem>       = Validator.compileNamed('ScatterInboxItem',       ScatterInboxItemSchema);
  static readonly scatterAckedResult:     EntityValidator<ScatterAckedResult>     = Validator.compileNamed('ScatterAckedResult',     ScatterAckedResultSchema);
  static readonly scatterProgress:        EntityValidator<ScatterProgress>        = Validator.compileNamed('ScatterProgress',        ScatterProgressSchema);
  static readonly storedScatterProgress:  EntityValidator<StoredScatterProgress>  = Validator.compileNamed('StoredScatterProgress',  StoredScatterProgressSchema);

  // WorkSet progress checkpoint wire shapes
  static readonly workSetItem:     EntityValidator<WorkSetItem>     = Validator.compileNamed('WorkSetItem',     WorkSetItemSchema);
  static readonly workSetEntry:    EntityValidator<WorkSetEntry>    = Validator.compileNamed('WorkSetEntry',    WorkSetEntrySchema);
  static readonly workSetProgress: EntityValidator<WorkSetProgress> = Validator.compileNamed('WorkSetProgress', WorkSetProgressSchema);
}
