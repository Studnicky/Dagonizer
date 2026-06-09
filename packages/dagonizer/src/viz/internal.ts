/**
 * viz/internal: shared utilities used by all viz renderers.
 *
 * NOT part of the public `./viz` barrel. Import via relative path
 * within the viz module only.
 */

import type { EmbeddedDAGNode } from '../entities/dag/EmbeddedDAGNode.js';
import type { PhaseNodePlacementInterface } from '../entities/dag/PhaseNode.js';
import type { ScatterNode } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import type { TerminalNodePlacementInterface } from '../entities/dag/TerminalNode.js';

/** 5-member union of every concrete placement shape. */
export type PlacementEntry =
  | EmbeddedDAGNode
  | ScatterNode
  | SingleNodePlacementInterface
  | TerminalNodePlacementInterface
  | PhaseNodePlacementInterface;

/**
 * Shared worker/contained color for all viz renderers.
 *
 * Color rationale: amber-orange (#f59e0b) reads visually as "offloaded /
 * running elsewhere" and contrasts the default teal accent (#22e8ff) used
 * for in-process placements. It is distinct from the retry route orange
 * (#f5a623) in CytoscapeGraph's stylesheet; the hue is shifted warmer and
 * the saturation is slightly lower so the two signals do not clash.
 *
 * Both MermaidRenderer (classDef fill) and CytoscapeGraph (stylesheet rule)
 * reference this constant so the same hex appears in a single place.
 */
export const WORKER_COLOR = '#f59e0b';

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
  static embeddedDagName(placement: PlacementEntry): string | null {
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
  static containerRole(placement: PlacementEntry): string | null {
    if (placement['@type'] === 'EmbeddedDAGNode') {
      return placement.container ?? null;
    }
    if (placement['@type'] === 'ScatterNode') {
      return placement.container ?? null;
    }
    return null;
  }

  /** Build a placement-name id, optionally prefixed by an enclosing scope. */
  static idIn(prefix: string, name: string): string {
    return prefix === '' ? name : `${prefix}/${name}`;
  }
}
