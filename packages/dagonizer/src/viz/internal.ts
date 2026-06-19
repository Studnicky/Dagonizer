/**
 * viz/internal: shared utilities used by all viz renderers.
 *
 * NOT part of the public `./viz` barrel. Import via relative path
 * within the viz module only.
 */

import type { DAGType } from '../entities/dag/DAG.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { PhaseNodeType } from '../entities/dag/PhaseNode.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementType } from '../entities/dag/SingleNode.js';
import type { TerminalNodeType } from '../entities/dag/TerminalNode.js';

/** 5-member union of every concrete placement shape. */
export type PlacementEntryType =
  | EmbeddedDAGNodeType
  | ScatterNodeType
  | SingleNodePlacementType
  | TerminalNodeType
  | PhaseNodeType;

/** The discriminant values that identify a valid `PlacementEntryType`. */
const PLACEMENT_TYPES = new Set<string>([
  'EmbeddedDAGNode',
  'ScatterNode',
  'SingleNode',
  'TerminalNode',
  'PhaseNode',
]);

/**
 * Type guard: narrows an `object` to `PlacementEntryType` by checking the
 * `@type` discriminant field. Ajv has already validated the DAG document
 * against its schema, so any object in `dag.nodes` with a recognised
 * `@type` is structurally valid. The guard exists to eliminate the bare
 * `as` cast at the schema boundary without requiring a full deep validation
 * pass here.
 */
function isPlacementEntry(node: object): node is PlacementEntryType {
  const type = (node as Record<string, unknown>)['@type'];
  return typeof type === 'string' && PLACEMENT_TYPES.has(type);
}

/**
 * The three color tokens a contained placement carries.
 *
 * `fill`   — background fill color (CSS hex).
 * `stroke` — border / outline color (darker shade of the same hue).
 * `text`   — label text color (light for dark fills, dark for light fills).
 */
export type RoleColorsType = {
  fill:   string;
  stroke: string;
  text:   string;
}

/**
 * Per-role color palette for container-bound (worker/isolate) placements.
 *
 * Color scheme rationale
 * ──────────────────────
 * Worker placements need to read visually as "offloaded / running elsewhere"
 * while remaining clearly distinct from each other when multiple roles are
 * present in one DAG. The scheme uses a curated palette of 8 warm/cool
 * accent hues (none overlapping the in-process teal #22e8ff or the retry
 * orange #f5a623). Role names are mapped to palette slots via a lightweight
 * FNV-1a hash so the same role string always resolves to the same slot
 * (deterministic, no Math.random / Date.now). Dark background fills keep
 * the overall dark-mode aesthetic; stroke is a saturated, slightly brighter
 * version of the fill; text is always the near-white #eef3f7 for legibility
 * on these dark backgrounds.
 *
 * Palette (index 0–7):
 *   0  amber-orange   #b45309 / stroke #d97706  — CPU / thread pool
 *   1  purple         #7c3aed / stroke #8b5cf6  — GPU / compute offload
 *   2  rose-red       #be185d / stroke #db2777  — IO / fork pool
 *   3  teal-green     #0f766e / stroke #14b8a6  — network / remote
 *   4  indigo         #3730a3 / stroke #4f46e5  — storage / disk
 *   5  lime-green     #3f6212 / stroke #65a30d  — batch / ETL
 *   6  sky-blue       #0369a1 / stroke #0ea5e9  — streaming / events
 *   7  fuchsia        #86198f / stroke #c026d3  — ML / inference
 */
export class RoleColorUtils {
  private constructor() { /* static class */ }

  /**
   * Curated palette of 8 distinct worker hues.
   * Each entry is [fill, stroke]; text is always the near-white constant.
   */
  private static readonly PALETTE: ReadonlyArray<readonly [string, string]> = [
    ['#b45309', '#d97706'],
    ['#7c3aed', '#8b5cf6'],
    ['#be185d', '#db2777'],
    ['#0f766e', '#14b8a6'],
    ['#3730a3', '#4f46e5'],
    ['#3f6212', '#65a30d'],
    ['#0369a1', '#0ea5e9'],
    ['#86198f', '#c026d3'],
  ] as const;

  /** Light text color legible on all palette dark-background fills. */
  private static readonly TEXT = '#eef3f7';

  /**
   * FNV-1a 32-bit hash of `role` mapped to a palette slot index.
   *
   * FNV-1a is deterministic, parameter-free, and produces well-distributed
   * output for short ASCII strings (role names). No runtime state, no
   * random seed — the same role always yields the same index.
   */
  private static hashToPaletteIndex(role: string): number {
    let hash = 2166136261;
    for (let i = 0; i < role.length; i++) {
      hash ^= role.charCodeAt(i);
      // Multiply by the FNV prime (32-bit wrap via bitwise OR 0).
      hash = (hash * 16777619) | 0;
    }
    // Unsigned modulo palette length.
    return (hash >>> 0) % RoleColorUtils.PALETTE.length;
  }

  /**
   * Return the stable `{fill, stroke, text}` color triple for a container role.
   *
   * The mapping is DETERMINISTIC: the same role string always returns the same
   * colors. Different role strings (with overwhelming probability for any
   * realistic set of role names) resolve to different palette slots.
   *
   * @example
   *   RoleColorUtils.forRole('cpu')  // { fill: '#b45309', stroke: '#d97706', text: '#eef3f7' }
   *   RoleColorUtils.forRole('io')   // { fill: '#be185d', stroke: '#db2777', text: '#eef3f7' }
   */
  static forRole(role: string): RoleColorsType {
    const idx = RoleColorUtils.hashToPaletteIndex(role);
    const entry = RoleColorUtils.PALETTE[idx];
    // PALETTE is a compile-time constant with 8 entries; hashToPaletteIndex
    // returns idx via unsigned modulo of PALETTE.length, so idx is always 0–7.
    if (entry === undefined) throw new Error(`RoleColorUtils: palette index ${idx} out of range`);
    const [fill, stroke] = entry;
    return { fill, stroke, "text": RoleColorUtils.TEXT };
  }
}

/** Placement utility operations. Static class; no instantiation. */
export class PlacementUtils {
  private constructor() { /* static class */ }

  /**
   * Return the sub-DAG name that this placement embeds, or `null` if it does
   * not embed a DAG.
   *
   * Covers both shapes:
   *   - `EmbeddedDAGNode`           → `placement.dag`
   *   - `ScatterNode` with dag body → `placement.body.dag`
   */
  static embeddedDagName(placement: PlacementEntryType): string | null {
    if (placement['@type'] === 'EmbeddedDAGNode') return placement.dag;
    if (placement['@type'] === 'ScatterNode' && 'dag' in placement.body) return placement.body.dag;
    return null;
  }

  /**
   * Return the `container` role for a placement that supports it
   * (`EmbeddedDAGNode` or dag-body `ScatterNode`), or `null` for all
   * others (including node-body ScatterNode and every other placement type).
   *
   * A non-null return means the placement is container-bound (worker/isolate).
   */
  static containerRole(placement: PlacementEntryType): string | null {
    if (placement['@type'] === 'EmbeddedDAGNode') {
      return placement.container ?? null;
    }
    if (placement['@type'] === 'ScatterNode') {
      return placement.container ?? null;
    }
    return null;
  }

  /**
   * Narrow `dag.nodes` to `PlacementEntryType[]`.
   *
   * `DAG.nodes` is typed as `ReadonlyArray<object>` at the schema boundary so
   * the engine core stays dependency-free. All renderer/layout callers in the
   * viz module need the richer union type. The `isPlacementEntry` type guard
   * checks the `@type` discriminant field; Ajv has already validated the DAG
   * document, so every node with a recognised `@type` is structurally valid.
   *
   * Nodes that fail the guard (which would indicate a schema bypass) are
   * excluded rather than crashing the renderer, preserving graceful degradation.
   */
  static narrowNodes(dag: DAGType): PlacementEntryType[] {
    return dag.nodes.filter(isPlacementEntry);
  }

  /** Build a placement-name id, optionally prefixed by an enclosing scope. */
  static idIn(prefix: string, name: string): string {
    return prefix === '' ? name : `${prefix}/${name}`;
  }
}
