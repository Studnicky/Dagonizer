/**
 * PlacementRank: computes a topological rank for each DAG placement.
 *
 * Rank determines firing order in the work-set scheduler:
 *   - Entrypoint placements have rank 0.
 *   - rank(v) = 1 + max(rank of forward predecessors of v).
 *   - Back-edges (edges whose target is an ancestor on the current DFS path,
 *     including self-loops) are excluded so the function terminates on cycles.
 *   - Placements unreachable from the entrypoint receive `Number.MAX_SAFE_INTEGER`
 *     so they sort after all reachable ones; they never hold items in practice.
 *
 * TerminalNode and PhaseNode placements have no outgoing forward edges.
 * SingleNode / ScatterNode / EmbeddedDAGNode outgoing edges are the values
 * of their `outputs` record (next placement IRIs).
 */

import type { DAGType } from '../entities/dag/DAG.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';

export class PlacementRank {
  private constructor() { /* static class */ }

  /** Returns the set of forward next-placement IRIs for a given placement. */
  private static forwardTargets(placement: DAGNodeType): readonly string[] {
    if (Placement.isTerminal(placement) || Placement.isPhase(placement)) {
      return [];
    }
    // SingleNode, ScatterNode, EmbeddedDAGNode all have an `outputs` record.
    return Object.values(placement.outputs);
  }

  /**
   * Memoized DFS computing rank(placementIri) = 1 + max(rank of non-back-edge
   * predecessors). Entrypoint placements have no predecessors → rank 0.
   *
   * `memo` caches resolved ranks; `visiting` is the active DFS ancestor set
   * used for back-edge detection: a predecessor already on the stack is a
   * back-edge (self-loop or cycle) and is excluded so recursion terminates.
   */
  private static rankFor(
    placementIri: string,
    predecessors: ReadonlyMap<string, readonly string[]>,
    memo: Map<string, number>,
    visiting: Set<string>,
  ): number {
    const cached = memo.get(placementIri);
    if (cached !== undefined) return cached;

    // Back-edge guard: a node already on the active DFS stack returns 0 to
    // break the cycle (the caller excludes this predecessor anyway).
    if (visiting.has(placementIri)) return 0;

    visiting.add(placementIri);

    const preds = predecessors.get(placementIri) ?? [];
    let maxPredRank = -1;

    for (const pred of preds) {
      // Skip back-edge predecessors (pred is an ancestor on current DFS path).
      if (visiting.has(pred)) continue;
      const pr = PlacementRank.rankFor(pred, predecessors, memo, visiting);
      if (pr > maxPredRank) maxPredRank = pr;
    }

    visiting.delete(placementIri);

    const rank = maxPredRank === -1 ? 0 : maxPredRank + 1;
    memo.set(placementIri, rank);
    return rank;
  }

  /**
   * Compute a topological rank for every placement in `dag`.
   *
   * Returns a `ReadonlyMap<placementIri, rank>` where:
   *   - Entrypoint placement rank is 0.
   *   - Any other reachable placement's rank is 1 + max rank of its forward
   *     predecessors (predecessors whose edge to this placement is NOT a back-edge).
   *   - Unreachable placements receive `Number.MAX_SAFE_INTEGER`.
   *
   * Back-edges are detected via a DFS ancestor set (the set of placement IRIs
   * currently on the active DFS call stack). An edge whose target is
   * in the ancestor set is a back-edge and is excluded from rank computation.
   * This guarantees the function terminates even when a self-loop or cycle
   * is present in the placement graph.
   *
   * Rank is computed via a memoized DFS on the predecessor graph: for each
   * placement, rank = 1 + max(rank of non-back-edge predecessors). Entrypoint
   * placements have no predecessors, so their rank is 0.
   */
  static compute(dag: DAGType): ReadonlyMap<string, number> {
    // Build adjacency map: placement IRI → forward next-placement IRIs.
    const adjacency = new Map<string, readonly string[]>();
    for (const placement of dag.nodes) {
      adjacency.set(placement['@id'], PlacementRank.forwardTargets(placement));
    }

    // Build predecessor map: for each placement, which placements forward-edge into it?
    const predecessors = new Map<string, string[]>();
    for (const placement of dag.nodes) {
      predecessors.set(placement['@id'], []);
    }
    for (const placement of dag.nodes) {
      const targets = PlacementRank.forwardTargets(placement);
      for (const target of targets) {
        const preds = predecessors.get(target);
        if (preds !== undefined) {
          preds.push(placement['@id']);
        }
      }
    }

    // Compute reachability from every declared entrypoint (forward DFS,
    // forward edges). Multi-entry DAGs treat each entrypoint as rank 0.
    const reachable = new Set<string>();
    const reachStack: string[] = Object.values(dag.entrypoints);
    while (reachStack.length > 0) {
      const cur = reachStack.pop();
      if (cur === undefined) continue;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      const targets = adjacency.get(cur);
      if (targets !== undefined) {
        for (const t of targets) {
          if (!reachable.has(t)) reachStack.push(t);
        }
      }
    }

    // Memoized rank results and DFS ancestor-set for back-edge detection.
    const rankOf = new Map<string, number>();
    const visiting = new Set<string>();

    // Compute rank for all reachable placements.
    for (const placementIri of reachable) {
      PlacementRank.rankFor(placementIri, predecessors, rankOf, visiting);
    }

    // Assemble result: reachable placements get computed rank, unreachable get MAX.
    const result = new Map<string, number>();
    for (const placement of dag.nodes) {
      const rank = rankOf.get(placement['@id']);
      result.set(placement['@id'], rank !== undefined ? rank : Number.MAX_SAFE_INTEGER);
    }

    return result;
  }
}
