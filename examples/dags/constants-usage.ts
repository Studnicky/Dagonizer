/**
 * constants-usage/dags: demonstrates every constant from
 * @studnicky/dagonizer/constants as typed guards.
 *
 * Each constant ships a runtime value (frozen lookup object, plural name) and a
 * FromSchema-derived type (singular name). Import the object for membership
 * tests; import the type for narrowing.
 *
 * Pure module: no side effects, no dispatcher, no execute.
 * Imported by examples/constants-usage.ts (the executable entry point).
 */

// #region constants
import {
  GatherStrategyNames,
  MetadataKeys,
  NodeTypes,
  OutputNames,
  ScatterOutputNames,
  type GatherStrategyNameType,
  type MetadataKeyType,
  type NodeType,
  type OutputType,
  type ScatterOutputType,
} from '@studnicky/dagonizer/constants';

// ── Item type narrowed at the scatter boundary ────────────────────────────────
export interface CatalogueItem {
  readonly title: string;
}

// ── Constant guards: all five methods live on one cohesive static class ───────
export class ConstantUsage {
  // -- Output ------------------------------------------------------------------
  // Route by the node's output token.
  static describeOutput(output: OutputType): string {
    if (output === OutputNames.SUCCESS) return 'operation completed';
    if (output === OutputNames.ERROR)   return 'operation failed';
    return output;
  }

  // -- NodeType ----------------------------------------------------------------
  // Discriminate a placement type read from a DAG definition.
  static isScatterPlacement(type: NodeType): boolean {
    return type === NodeTypes.SCATTER;
  }

  // -- GatherStrategyName ------------------------------------------------------
  // Validate a config value against the known gather strategies.
  static isKnownGatherStrategy(name: string): name is GatherStrategyNameType {
    const strategySet = new Set<string>(Object.values(GatherStrategyNames));
    return strategySet.has(name);
  }

  // -- MetadataKey -------------------------------------------------------------
  // Read a reserved key off a node's metadata bag.
  // CURRENT_ITEM is set by scatter; narrow to CatalogueItem at the read site.
  static readCurrentItem(metadata: Partial<Record<MetadataKeyType, CatalogueItem>>): CatalogueItem | undefined {
    return metadata[MetadataKeys.CURRENT_ITEM];
  }

  // -- ScatterOutput -----------------------------------------------------------
  // Branch on scatter aggregate output.
  static interpretScatterOutput(output: ScatterOutputType): string {
    if (output === ScatterOutputNames.ALL_SUCCESS) return 'all clones succeeded';
    if (output === ScatterOutputNames.ALL_ERROR)   return 'all clones failed';
    if (output === ScatterOutputNames.PARTIAL)     return 'partial success';
    return 'source array was empty';
  }
}

// Select the gather strategy for a fan-out that maps per-clone field values
// into a target array on the parent state (one entry per source item, in
// source-index order). Use COLLECT when aggregating output tokens instead.
export const fanOutGatherStrategy: GatherStrategyNameType = GatherStrategyNames.MAP;
// #endregion constants
