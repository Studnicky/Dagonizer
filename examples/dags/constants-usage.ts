/**
 * constants-usage/dags: demonstrates every constant from
 * @noocodex/dagonizer/constants as typed guards.
 *
 * Each constant is both a runtime value (frozen lookup object) and a
 * FromSchema-derived type of the same name. Import the object for
 * membership tests; import the type for narrowing.
 *
 * Pure module: no side effects, no dispatcher, no execute.
 */

// #region constants
import {
  GatherStrategyName,
  MetadataKey,
  NodeType,
  Output,
  ParallelCombine,
  ScatterOutput,
} from '@noocodex/dagonizer/constants';

// -- Output ------------------------------------------------------------------
// Route by the node's output token.
function describeOutput(output: Output): string {
  if (output === Output.SUCCESS) return 'operation completed';
  if (output === Output.ERROR)   return 'operation failed';
  return output;
}

// -- NodeType ----------------------------------------------------------------
// Discriminate a placement type read from a DAG definition.
function isParallelPlacement(type: NodeType): boolean {
  return type === NodeType.PARALLEL;
}

// -- GatherStrategyName ------------------------------------------------------
// Validate a config value against the known gather strategies.
function isKnownGatherStrategy(name: string): name is GatherStrategyName {
  const known: readonly string[] = [
    GatherStrategyName.APPEND,
    GatherStrategyName.CUSTOM,
    GatherStrategyName.MAP,
    GatherStrategyName.PARTITION,
  ];
  return known.includes(name);
}

// -- MetadataKey -------------------------------------------------------------
// Read a reserved key off a node's metadata bag.
function readCurrentItem(metadata: Partial<Record<MetadataKey, unknown>>): unknown {
  return metadata[MetadataKey.CURRENT_ITEM];
}

// -- ParallelCombine ---------------------------------------------------------
// Pick a combine strategy name for a parallel placement.
const combineStrategy: ParallelCombine = ParallelCombine.ALL_SUCCESS;

// -- ScatterOutput -----------------------------------------------------------
// Branch on scatter aggregate output.
function interpretScatterOutput(output: ScatterOutput): string {
  if (output === ScatterOutput.ALL_SUCCESS) return 'all clones succeeded';
  if (output === ScatterOutput.ALL_ERROR)   return 'all clones failed';
  if (output === ScatterOutput.PARTIAL)     return 'partial success';
  return 'source array was empty';
}
// #endregion constants

// Suppress unused variable warnings.
void describeOutput;
void isParallelPlacement;
void isKnownGatherStrategy;
void readCurrentItem;
void combineStrategy;
void interpretScatterOutput;
