/**
 * PlacementRank: computes a topological rank for each DAG placement.
 *
 * Rank determines firing order in the work-set scheduler:
 *   - Entry placement has rank 0.
 *   - rank(v) = 1 + max(rank of forward predecessors of v).
 *   - Back-edges (edges whose target is an ancestor on the current DFS path,
 *     including self-loops) are excluded so the function terminates on cycles.
 *   - Placements unreachable from the entrypoint receive `Number.MAX_SAFE_INTEGER`
 *     so they sort after all reachable ones; they never hold items in practice.
 *
 * TerminalNode and PhaseNode placements have no outgoing forward edges.
 * SingleNode / ScatterNode / EmbeddedDAGNode outgoing edges are the values
 * of their `outputs` record (next placement names).
 */

import type { DAG } from '../entities/dag/DAG.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';

export class PlacementRank {
  private constructor() { /* static class */ }

  /** Returns the set of forward next-placement names for a given placement. */
  private static forwardTargets(placement: DAGNodeType): readonly string[] {
    if (Placement.isTerminal(placement) || Placement.isPhase(placement)) {
      return [];
    }
    // SingleNode, ScatterNode, EmbeddedDAGNode all have an `outputs` record.
    return Object.values(placement.outputs);
  }

  /**
   * Compute a topological rank for every placement in `dag`.
   *
   * Returns a `ReadonlyMap<placementName, rank>` where:
   *   - Entry placement rank is 0.
   *   - Any other reachable placement's rank is 1 + max rank of its forward
   *     predecessors (predecessors whose edge to this placement is NOT a back-edge).
   *   - Unreachable placements receive `Number.MAX_SAFE_INTEGER`.
   *
   * Back-edges are detected via a DFS ancestor set (the set of placement
   * names currently on the active DFS call stack). An edge whose target is
   * in the ancestor set is a back-edge and is excluded from rank computation.
   * This guarantees the function terminates even when a self-loop or cycle
   * is present in the placement graph.
   *
   * Rank is computed via a memoized DFS on the predecessor graph: for each
   * placement, rank = 1 + max(rank of non-back-edge predecessors). The entry
   * placement has no predecessors, so its rank is 0.
   */
  static compute(dag: DAG): ReadonlyMap<string, number> {
    // Build adjacency map: placement name → forward next-placement names.
    const adjacency = new Map<string, readonly string[]>();
    for (const placement of dag.nodes) {
      adjacency.set(placement.name, PlacementRank.forwardTargets(placement));
    }

    // Build predecessor map: for each placement, which placements forward-edge into it?
    const predecessors = new Map<string, string[]>();
    for (const placement of dag.nodes) {
      predecessors.set(placement.name, []);
    }
    for (const placement of dag.nodes) {
      const targets = PlacementRank.forwardTargets(placement);
      for (const target of targets) {
        const preds = predecessors.get(target);
        if (preds !== undefined) {
          preds.push(placement.name);
        }
      }
    }

    // Compute reachability from the entry placement (forward DFS, forward edges).
    const reachable = new Set<string>();
    const reachStack: string[] = [dag.entrypoint];
    while (reachStack.length > 0) {
      const cur = reachStack.pop() as string;
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

    // Compute rank(v) = 1 + max(rank of non-back-edge predecessors of v).
    // The entry placement has no predecessors → rank 0.
    function computeRank(name: string): number {
      const memo = rankOf.get(name);
      if (memo !== undefined) return memo;

      // Back-edge guard: if we visit a node already on the active DFS stack,
      // return 0 to break the cycle (the caller will exclude this anyway).
      if (visiting.has(name)) return 0;

      visiting.add(name);

      const preds = predecessors.get(name) ?? [];
      let maxPredRank = -1;

      for (const pred of preds) {
        // Skip back-edge predecessors (pred is an ancestor on current DFS path).
        if (visiting.has(pred)) continue;
        const pr = computeRank(pred);
        if (pr > maxPredRank) maxPredRank = pr;
      }

      visiting.delete(name);

      const rank = maxPredRank === -1 ? 0 : maxPredRank + 1;
      rankOf.set(name, rank);
      return rank;
    }

    // Compute rank for all reachable placements.
    for (const name of reachable) {
      computeRank(name);
    }

    // Assemble result: reachable placements get computed rank, unreachable get MAX.
    const result = new Map<string, number>();
    for (const placement of dag.nodes) {
      const rank = rankOf.get(placement.name);
      result.set(placement.name, rank !== undefined ? rank : Number.MAX_SAFE_INTEGER);
    }

    return result;
  }
}
