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

import type { LlmModelType } from '../entities/adapter/LlmModel.js';
import { LlmModelSchema } from '../entities/adapter/LlmModel.js';
import type { OpenAiModelsResponseType } from '../entities/adapter/OpenAiModelsResponse.js';
import { OpenAiModelsResponseSchema } from '../entities/adapter/OpenAiModelsResponse.js';
import type { OpenAiResponseBodyType } from '../entities/adapter/OpenAiResponseBody.js';
import { OpenAiResponseBodySchema } from '../entities/adapter/OpenAiResponseBody.js';
import { TextChannelToolCallEnvelopeSchema } from '../entities/adapter/TextChannelToolCallEnvelope.js';
import type { TextChannelToolCallEnvelopeType } from '../entities/adapter/TextChannelToolCallEnvelope.js';
import { CheckpointDataSchema } from '../entities/checkpoint/CheckpointData.js';
import type { CheckpointDataType } from '../entities/checkpoint/CheckpointData.js';
import { GatherStrategySchema } from '../entities/constants/GatherStrategy.js';
import type { GatherStrategyNameType } from '../entities/constants/GatherStrategy.js';
import { MetadataKeySchema } from '../entities/constants/MetadataKey.js';
import type { MetadataKeyType } from '../entities/constants/MetadataKey.js';
import { NodeTypeSchema } from '../entities/constants/NodeType.js';
import type { NodeType } from '../entities/constants/NodeType.js';
import { OutputSchema } from '../entities/constants/Output.js';
import type { OutputType } from '../entities/constants/Output.js';
import { ScatterOutputSchema } from '../entities/constants/ScatterOutput.js';
import type { ScatterOutputType } from '../entities/constants/ScatterOutput.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { DAGSchema } from '../entities/dag/DAG.js';
import { EmbeddedDAGNodeSchema } from '../entities/dag/EmbeddedDAGNode.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import { GatherConfigSchema } from '../entities/dag/GatherConfig.js';
import type { GatherConfigType } from '../entities/dag/GatherConfig.js';
import type { PhaseNodeType } from '../entities/dag/PhaseNode.js';
import { PhaseNodeSchema } from '../entities/dag/PhaseNode.js';
import { ScatterNodeSchema } from '../entities/dag/ScatterNode.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { SingleNodeType } from '../entities/dag/SingleNode.js';
import { SingleNodeSchema } from '../entities/dag/SingleNode.js';
import type { TerminalNodeType } from '../entities/dag/TerminalNode.js';
import { TerminalNodeSchema } from '../entities/dag/TerminalNode.js';
import { DAGErrorJSONSchema } from '../entities/errors/DAGErrorJSON.js';
import type { DAGErrorJSONType } from '../entities/errors/DAGErrorJSON.js';
import { ExecutionResultSchema, InterruptionInfoSchema } from '../entities/execution/ExecutionResult.js';
import type { ExecutionResultWireType, InterruptionInfoType } from '../entities/execution/ExecutionResult.js';
import { ParkedSchema } from '../entities/execution/Parked.js';
import type { ParkedType } from '../entities/execution/Parked.js';
import type { BridgeMessageType } from '../entities/executor/BridgeMessage.js';
import { BridgeMessageSchema } from '../entities/executor/BridgeMessage.js';
import { ExecutionRequestSchema } from '../entities/executor/ExecutionRequest.js';
import type { ExecutionRequestType } from '../entities/executor/ExecutionRequest.js';
import { ExecutionResponseSchema } from '../entities/executor/ExecutionResponse.js';
import type { ExecutionResponseType } from '../entities/executor/ExecutionResponse.js';
import { ExecutorIntermediateSchema } from '../entities/executor/ExecutorIntermediate.js';
import type { ExecutorIntermediateType } from '../entities/executor/ExecutorIntermediate.js';
import { RecommendedWorkerCountConfigSchema } from '../entities/executor/RecommendedWorkerCountConfig.js';
import type { RecommendedWorkerCountConfigType } from '../entities/executor/RecommendedWorkerCountConfig.js';
import type { DAGHandoffType } from '../entities/handoff/DAGHandoff.js';
import { DAGHandoffSchema } from '../entities/handoff/DAGHandoff.js';
import { NodeSchema } from '../entities/node/Node.js';
import type { NodeUnionType } from '../entities/node/Node.js';
import { NodeContextSchema } from '../entities/node/NodeContext.js';
import type { NodeContextWireType } from '../entities/node/NodeContext.js';
import { NodeErrorSchema } from '../entities/node/NodeError.js';
import type { NodeErrorWireType } from '../entities/node/NodeError.js';
import { NodeOutputSchema } from '../entities/node/NodeOutput.js';
import type { NodeOutputWireType } from '../entities/node/NodeOutput.js';
import { NodeResultSchema } from '../entities/node/NodeResult.js';
import type { NodeResultWireType } from '../entities/node/NodeResult.js';
import { NodeStateDataSchema } from '../entities/node/NodeStateData.js';
import type { NodeStateDataType } from '../entities/node/NodeStateData.js';
import { NodeWarningSchema } from '../entities/node/NodeWarning.js';
import type { NodeWarningType } from '../entities/node/NodeWarning.js';
import type { BackoffStrategyType } from '../entities/runtime/BackoffStrategy.js';
import { BackoffStrategySchema } from '../entities/runtime/BackoffStrategy.js';
import type {
  ScatterAckedResultType,
  ScatterInboxItemType,
  ScatterProgressType,
  StoredScatterProgressType,
} from '../entities/scatter/ScatterProgress.js';
import {
  ScatterAckedResultSchema,
  ScatterInboxItemSchema,
  ScatterProgressSchema,
  StoredScatterProgressSchema,
} from '../entities/scatter/ScatterProgress.js';
import { DAGLifecycleStateSchema } from '../entities/state-machines/DAGLifecycleState.js';
import type { DAGLifecycleStateDataType } from '../entities/state-machines/DAGLifecycleState.js';
import { ValidationResultSchema } from '../entities/validation/ValidationResult.js';
import type { ValidationResultType } from '../entities/validation/ValidationResult.js';
import type {
  WorkSetEntryType,
  WorkSetItemType,
  WorkSetProgressType,
} from '../entities/workset/WorkSetProgress.js';
import {
  WorkSetEntrySchema,
  WorkSetItemSchema,
  WorkSetProgressSchema,
} from '../entities/workset/WorkSetProgress.js';
import { ValidationError } from '../errors/DAGError.js';

import { sharedAjv } from './sharedAjv.js';

/** Per-entity validator interface returned by every `Validator.<entity>` field. */
export interface EntityValidatorInterface<T> {
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
   * Compile a consumer-supplied schema into a typed `EntityValidatorInterface<T>`
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
  static compile<T>(schema: { readonly $id?: string }): EntityValidatorInterface<T> {
    return Validator.compileNamed<T>(schema.$id ?? '<schema>', schema);
  }

  /**
   * Compile a schema into a typed `EntityValidatorInterface<T>` under an explicit
   * name used in error messages. Backs both the public single-arg
   * `compile(schema)` and every internal per-entity field initializer.
   * Schemas embedded in others (e.g. `GatherConfigSchema` inlined in
   * `DAGSchema`) already register their `$id` when the parent compiles;
   * this method looks the already-registered validator up before
   * compiling fresh.
   */
  private static compileNamed<T>(name: string, schema: { readonly $id?: string }): EntityValidatorInterface<T> {
    const id = schema.$id;
    // Typed as `ValidateFunction<T>` so the compiled Ajv function IS a type
    // guard: `validator(value)` narrows `value` to `T`, making the validated
    // return cast-free (no `value as T` at the boundary).
    let compiled: ValidateFunction<T> | undefined;
    if (id !== undefined) {
      const cached = sharedAjv.getSchema<T>(id);
      if (typeof cached === 'function') {
        compiled = cached;
      }
    }
    if (compiled === undefined) {
      compiled = sharedAjv.compile<T>(schema);
    }
    const validator: ValidateFunction<T> = compiled;
    return {
      is(value): value is T {
        return validator(value);
      },
      validate(value): T {
        if (validator(value)) return value;
        const ajvErrors: readonly ErrorObject[] = validator.errors ?? [];
        throw new ValidationError(
          `Invalid ${name}:\n  - ${Validator.formatErrors(ajvErrors).join('\n  - ')}`,
          { 'context': { ajvErrors } },
        );
      },
      errors(value): string[] | null {
        if (validator(value)) return null;
        return Validator.formatErrors(validator.errors ?? []);
      },
    };
  }

  // Bridge protocol
  static readonly bridgeMessage: EntityValidatorInterface<BridgeMessageType> = Validator.compileNamed('BridgeMessage', BridgeMessageSchema);

  // DAG: top-level definition
  static readonly dag:             EntityValidatorInterface<DAGType>             = Validator.compileNamed('DAG',             DAGSchema);
  static readonly singleNode:      EntityValidatorInterface<SingleNodeType>      = Validator.compileNamed('SingleNode',      SingleNodeSchema);
  static readonly scatterNode:     EntityValidatorInterface<ScatterNodeType>     = Validator.compileNamed('ScatterNode',     ScatterNodeSchema);
  static readonly embeddedDAGNode: EntityValidatorInterface<EmbeddedDAGNodeType> = Validator.compileNamed('EmbeddedDAGNode', EmbeddedDAGNodeSchema);
  static readonly terminalNode: EntityValidatorInterface<TerminalNodeType>  = Validator.compileNamed('TerminalNode', TerminalNodeSchema);
  static readonly phaseNode:    EntityValidatorInterface<PhaseNodeType>     = Validator.compileNamed('PhaseNode',    PhaseNodeSchema);

  // Node runtime shapes
  static readonly node:          EntityValidatorInterface<NodeUnionType>      = Validator.compileNamed('Node',          NodeSchema);
  static readonly nodeContext:   EntityValidatorInterface<NodeContextWireType>    = Validator.compileNamed('NodeContext',   NodeContextSchema);
  static readonly nodeOutput:    EntityValidatorInterface<NodeOutputWireType>     = Validator.compileNamed('NodeOutput',    NodeOutputSchema);
  static readonly nodeError:     EntityValidatorInterface<NodeErrorWireType>      = Validator.compileNamed('NodeError',     NodeErrorSchema);
  static readonly nodeWarning:   EntityValidatorInterface<NodeWarningType>    = Validator.compileNamed('NodeWarning',   NodeWarningSchema);
  static readonly nodeResult:    EntityValidatorInterface<NodeResultWireType>     = Validator.compileNamed('NodeResult',    NodeResultSchema);
  static readonly nodeStateData: EntityValidatorInterface<NodeStateDataType>  = Validator.compileNamed('NodeStateData', NodeStateDataSchema);

  // Execution + lifecycle wire shapes
  static readonly executionResult:   EntityValidatorInterface<ExecutionResultWireType>      = Validator.compileNamed('ExecutionResult',   ExecutionResultSchema);
  static readonly interruptionInfo:  EntityValidatorInterface<InterruptionInfoType>     = Validator.compileNamed('InterruptionInfo',  InterruptionInfoSchema);
  static readonly dagLifecycleState: EntityValidatorInterface<DAGLifecycleStateDataType> = Validator.compileNamed('DAGLifecycleStateType', DAGLifecycleStateSchema);
  static readonly parked:            EntityValidatorInterface<ParkedType>               = Validator.compileNamed('Parked',             ParkedSchema);

  // Persistence + reporting
  static readonly checkpoint:       EntityValidatorInterface<CheckpointDataType>    = Validator.compileNamed('CheckpointData',    CheckpointDataSchema);
  static readonly validationResult: EntityValidatorInterface<ValidationResultType>  = Validator.compileNamed('ValidationResult',  ValidationResultSchema);
  static readonly dagErrorJson:     EntityValidatorInterface<DAGErrorJSONType>      = Validator.compileNamed('DAGErrorJSON',      DAGErrorJSONSchema);

  // Hand-off channels
  static readonly dagHandoff: EntityValidatorInterface<DAGHandoffType> = Validator.compileNamed('DAGHandoff', DAGHandoffSchema);

  // Executor container wire shapes
  static readonly executionRequest:       EntityValidatorInterface<ExecutionRequestType>        = Validator.compileNamed('ExecutionRequest',        ExecutionRequestSchema);
  static readonly executionResponse:      EntityValidatorInterface<ExecutionResponseType>       = Validator.compileNamed('ExecutionResponse',       ExecutionResponseSchema);
  static readonly executorIntermediate:   EntityValidatorInterface<ExecutorIntermediateType>    = Validator.compileNamed('ExecutorIntermediate',    ExecutorIntermediateSchema);
  static readonly recommendedWorkerCount: EntityValidatorInterface<RecommendedWorkerCountConfigType> = Validator.compileNamed('RecommendedWorkerCountConfig', RecommendedWorkerCountConfigSchema);

  // DAG sub-entities
  static readonly gatherConfig: EntityValidatorInterface<GatherConfigType> = Validator.compileNamed('GatherConfig', GatherConfigSchema);

  // Adapter wire shapes
  static readonly llmModel: EntityValidatorInterface<LlmModelType> = Validator.compileNamed('LlmModel', LlmModelSchema);
  static readonly openAiModelsResponse: EntityValidatorInterface<OpenAiModelsResponseType> = Validator.compileNamed('OpenAiModelsResponse', OpenAiModelsResponseSchema);
  static readonly openAiResponseBody: EntityValidatorInterface<OpenAiResponseBodyType> = Validator.compileNamed('OpenAiResponseBody', OpenAiResponseBodySchema);
  static readonly textChannelToolCallEnvelope: EntityValidatorInterface<TextChannelToolCallEnvelopeType> = Validator.compileNamed('TextChannelToolCallEnvelope', TextChannelToolCallEnvelopeSchema);

  // Constant enum schemas
  static readonly gatherStrategy: EntityValidatorInterface<GatherStrategyNameType> = Validator.compileNamed('GatherStrategy', GatherStrategySchema);
  static readonly scatterOutput:  EntityValidatorInterface<ScatterOutputType>      = Validator.compileNamed('ScatterOutput',  ScatterOutputSchema);
  static readonly metadataKey:    EntityValidatorInterface<MetadataKeyType>        = Validator.compileNamed('MetadataKey',    MetadataKeySchema);
  static readonly output:         EntityValidatorInterface<OutputType>             = Validator.compileNamed('Output',         OutputSchema);
  static readonly nodeType:       EntityValidatorInterface<NodeType>               = Validator.compileNamed('NodeType',       NodeTypeSchema);
  static readonly backoffStrategy: EntityValidatorInterface<BackoffStrategyType> = Validator.compileNamed('BackoffStrategy', BackoffStrategySchema);

  // Scatter progress checkpoint wire shapes
  static readonly scatterInboxItem:       EntityValidatorInterface<ScatterInboxItemType>       = Validator.compileNamed('ScatterInboxItem',       ScatterInboxItemSchema);
  static readonly scatterAckedResult:     EntityValidatorInterface<ScatterAckedResultType>     = Validator.compileNamed('ScatterAckedResult',     ScatterAckedResultSchema);
  static readonly scatterProgress:        EntityValidatorInterface<ScatterProgressType>        = Validator.compileNamed('ScatterProgress',        ScatterProgressSchema);
  static readonly storedScatterProgress:  EntityValidatorInterface<StoredScatterProgressType>  = Validator.compileNamed('StoredScatterProgress',  StoredScatterProgressSchema);

  // WorkSet progress checkpoint wire shapes
  static readonly workSetItem:     EntityValidatorInterface<WorkSetItemType>     = Validator.compileNamed('WorkSetItem',     WorkSetItemSchema);
  static readonly workSetEntry:    EntityValidatorInterface<WorkSetEntryType>    = Validator.compileNamed('WorkSetEntry',    WorkSetEntrySchema);
  static readonly workSetProgress: EntityValidatorInterface<WorkSetProgressType> = Validator.compileNamed('WorkSetProgress', WorkSetProgressSchema);
}
