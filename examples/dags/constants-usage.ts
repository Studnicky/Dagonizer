/**
 * constants-usage/dags: demonstrates every constant from
 * @noocodex/dagonizer/constants as typed guards.
 *
 * Each constant is both a runtime value (frozen lookup object) and a
 * FromSchema-derived type of the same name. Import the object for
 * membership tests; import the type for narrowing.
 *
 * Pure module: no side effects, no dispatcher, no execute.
 * Imported by examples/constants-usage.ts (the executable entry point).
 */

// #region constants
import {
  GatherStrategyName,
  MetadataKey,
  NodeType,
  Output,
  ScatterOutput,
} from '@noocodex/dagonizer/constants';

// ── Item type narrowed at the scatter boundary ────────────────────────────────
export interface CatalogueItem {
  readonly title: string;
}

// ── Constant guards: all five methods live on one cohesive static class ───────
export class ConstantUsage {
  // -- Output ------------------------------------------------------------------
  // Route by the node's output token.
  static describeOutput(output: Output): string {
    if (output === Output.SUCCESS) return 'operation completed';
    if (output === Output.ERROR)   return 'operation failed';
    return output;
  }

  // -- NodeType ----------------------------------------------------------------
  // Discriminate a placement type read from a DAG definition.
  static isScatterPlacement(type: NodeType): boolean {
    return type === NodeType.SCATTER;
  }

  // -- GatherStrategyName ------------------------------------------------------
  // Validate a config value against the known gather strategies.
  static isKnownGatherStrategy(name: string): name is GatherStrategyName {
    return (Object.values(GatherStrategyName) as readonly string[]).includes(name);
  }

  // -- MetadataKey -------------------------------------------------------------
  // Read a reserved key off a node's metadata bag.
  // CURRENT_ITEM is set by scatter; narrow to CatalogueItem at the read site.
  static readCurrentItem(metadata: Partial<Record<MetadataKey, CatalogueItem>>): CatalogueItem | undefined {
    return metadata[MetadataKey.CURRENT_ITEM];
  }

  // -- ScatterOutput -----------------------------------------------------------
  // Branch on scatter aggregate output.
  static interpretScatterOutput(output: ScatterOutput): string {
    if (output === ScatterOutput.ALL_SUCCESS) return 'all clones succeeded';
    if (output === ScatterOutput.ALL_ERROR)   return 'all clones failed';
    if (output === ScatterOutput.PARTIAL)     return 'partial success';
    return 'source array was empty';
  }
}

// Select the gather strategy for a fan-out that maps per-clone field values
// into a target array on the parent state (one entry per source item, in
// source-index order). Use COLLECT when aggregating output tokens instead.
export const fanOutGatherStrategy: GatherStrategyName = GatherStrategyName.MAP;
// #endregion constants
