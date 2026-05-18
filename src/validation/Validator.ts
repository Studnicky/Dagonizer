/**
 * Validator — unified Ajv-backed entity validator.
 *
 * Compiled once at module load (schemas are compile-time invariants).
 * Static class — namespaced sub-validators per entity:
 *
 *   Validator.dag.is(x)        — type predicate
 *   Validator.dag.validate(x)  — narrow or throw ValidationError
 *   Validator.dag.errors(x)    — formatted error strings or null
 *
 * Every top-level entity schema in `entities/` ships with a
 * sub-validator on this class. Consumers call them as
 * `Validator.<entityCamel>.<verb>(value)`.
 */

import type { ErrorObject, ValidateFunction } from 'ajv';

import { CheckpointDataSchema } from '../entities/checkpoint/CheckpointData.js';
import type { CheckpointData } from '../entities/checkpoint/CheckpointData.js';
import { DAGSchema } from '../entities/dag/DAG.js';
import type { DAG } from '../entities/dag/DAG.js';
import { DeepDAGNodeSchema } from '../entities/dag/DeepDAGNode.js';
import type { DeepDAGNode } from '../entities/dag/DeepDAGNode.js';
import { FanInConfigSchema } from '../entities/dag/FanInConfig.js';
import type { FanInConfig } from '../entities/dag/FanInConfig.js';
import { FanOutNodeSchema } from '../entities/dag/FanOutNode.js';
import type { FanOutNode } from '../entities/dag/FanOutNode.js';
import { ParallelNodeSchema } from '../entities/dag/ParallelNode.js';
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import { SingleNodeSchema } from '../entities/dag/SingleNode.js';
import type { SingleNode } from '../entities/dag/SingleNode.js';
import { DAGErrorJSONSchema } from '../entities/errors/DAGErrorJSON.js';
import type { DAGErrorJSON } from '../entities/errors/DAGErrorJSON.js';
import { ExecutionResultSchema } from '../entities/execution/ExecutionResult.js';
import type { ExecutionResult } from '../entities/execution/ExecutionResult.js';
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

const formatErrors = (errors: readonly ErrorObject[]): string[] =>
  errors.map((error) => {
    const path = error.instancePath.length > 0 ? error.instancePath : '<root>';
    return `${path}: ${error.message ?? 'invalid'}`;
  });

const compileEntity = <T>(name: string, schema: { readonly $id?: string }): EntityValidator<T> => {
  // Schemas embedded in others (e.g. FanInConfigSchema inlined in DAGSchema)
  // already register their `$id` when the parent compiles. Look the
  // already-registered validator up first; otherwise compile fresh.
  const id = schema.$id;
  let compiled: ValidateFunction | undefined;
  if (id !== undefined) {
    compiled = sharedAjv.getSchema(id) as ValidateFunction | undefined;
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
      const ajvErrors = validator.errors ?? [];
      throw new ValidationError(
        `Invalid ${name}:\n  - ${formatErrors(ajvErrors).join('\n  - ')}`,
        { 'ajvErrors': ajvErrors as unknown as Record<string, unknown> },
      );
    },
    errors(value): string[] | null {
      if (validator(value) === true) return null;
      return formatErrors(validator.errors ?? []);
    },
  };
};

/**
 * Unified Ajv-backed validator. Access per-entity sub-validators via
 * static fields. Every top-level entity schema in `entities/` has a
 * sub-validator here.
 */
export class Validator {
  private constructor() { /* static class */ }

  // DAG — top-level definition
  static readonly dag: EntityValidator<DAG> = compileEntity('DAG', DAGSchema);
  static readonly singleNode: EntityValidator<SingleNode> = compileEntity('SingleNode', SingleNodeSchema);
  static readonly parallelNode: EntityValidator<ParallelNode> = compileEntity('ParallelNode', ParallelNodeSchema);
  static readonly fanOutNode: EntityValidator<FanOutNode> = compileEntity('FanOutNode', FanOutNodeSchema);
  static readonly deepDAGNode: EntityValidator<DeepDAGNode> = compileEntity('DeepDAGNode', DeepDAGNodeSchema);
  static readonly fanInConfig: EntityValidator<FanInConfig> = compileEntity('FanInConfig', FanInConfigSchema);

  // Node runtime shapes
  static readonly node: EntityValidator<Node> = compileEntity('Node', NodeSchema);
  static readonly nodeContext: EntityValidator<NodeContext> = compileEntity('NodeContext', NodeContextSchema);
  static readonly nodeOutput: EntityValidator<NodeOutput> = compileEntity('NodeOutput', NodeOutputSchema);
  static readonly nodeError: EntityValidator<NodeError> = compileEntity('NodeError', NodeErrorSchema);
  static readonly nodeWarning: EntityValidator<NodeWarning> = compileEntity('NodeWarning', NodeWarningSchema);
  static readonly nodeResult: EntityValidator<NodeResult> = compileEntity('NodeResult', NodeResultSchema);
  static readonly nodeStateData: EntityValidator<NodeStateData> = compileEntity('NodeStateData', NodeStateDataSchema);

  // Execution + lifecycle wire shapes
  static readonly executionResult: EntityValidator<ExecutionResult> = compileEntity('ExecutionResult', ExecutionResultSchema);
  static readonly dagLifecycleState: EntityValidator<DAGLifecycleStateData> = compileEntity('DAGLifecycleState', DAGLifecycleStateSchema);

  // Persistence + reporting
  static readonly checkpoint: EntityValidator<CheckpointData> = compileEntity('CheckpointData', CheckpointDataSchema);
  static readonly validationResult: EntityValidator<ValidationResult> = compileEntity('ValidationResult', ValidationResultSchema);
  static readonly dagErrorJson: EntityValidator<DAGErrorJSON> = compileEntity('DAGErrorJSON', DAGErrorJSONSchema);
}
