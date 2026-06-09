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

  /** Build a placement-name id, optionally prefixed by an enclosing scope. */
  static idIn(prefix: string, name: string): string {
    return prefix === '' ? name : `${prefix}/${name}`;
  }
}
