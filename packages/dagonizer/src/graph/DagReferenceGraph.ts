import type { DAGType } from '../entities/dag/DAG.js';

import { DagGraphProjector } from './DagGraphProjector.js';
import { DagGraphQueries } from './DagGraphQueries.js';

export type DagReferenceEdgeType = {
  readonly sourceDagIri: string;
  readonly sourcePlacement: string;
  readonly targetDagIri: string;
  readonly dynamic: boolean;
};

export class DagReferenceGraph {
  private constructor() { /* static-only */ }

  static referenceEdges(dags: ReadonlyMap<string, DAGType>): readonly DagReferenceEdgeType[] {
    const edges: DagReferenceEdgeType[] = [];
    for (const [sourceDagIri, dag] of dags) {
      const topology = DagGraphProjector.store(dag);
      for (const row of DagGraphQueries.candidateDagRows(topology)) {
        edges.push({
          sourceDagIri,
          'sourcePlacement': DagReferenceGraph.placementNameOf(row.placementIri),
          'targetDagIri': row.dagIri,
          'dynamic': row.dynamic,
        });
      }
    }
    return edges;
  }

  static stronglyConnectedComponents(
    dagIris: Iterable<string>,
    edges: readonly { readonly sourceDagIri: string; readonly targetDagIri: string }[],
  ): readonly string[][] {
    const adjacency = new Map<string, string[]>();
    for (const dagIri of dagIris) adjacency.set(dagIri, []);
    for (const edge of edges) {
      const outgoing = adjacency.get(edge.sourceDagIri);
      if (outgoing !== undefined) outgoing.push(edge.targetDagIri);
    }

    let index = 0;
    const stack: string[] = [];
    const onStack = new Set<string>();
    const indices = new Map<string, number>();
    const lowlinks = new Map<string, number>();
    const components: string[][] = [];

    const visit = (dagIri: string): void => {
      indices.set(dagIri, index);
      lowlinks.set(dagIri, index);
      index += 1;
      stack.push(dagIri);
      onStack.add(dagIri);

      for (const target of adjacency.get(dagIri) ?? []) {
        if (!adjacency.has(target)) continue;
        if (!indices.has(target)) {
          visit(target);
          lowlinks.set(dagIri, Math.min(lowlinks.get(dagIri) ?? 0, lowlinks.get(target) ?? 0));
        } else if (onStack.has(target)) {
          lowlinks.set(dagIri, Math.min(lowlinks.get(dagIri) ?? 0, indices.get(target) ?? 0));
        }
      }

      if (lowlinks.get(dagIri) !== indices.get(dagIri)) return;
      const component: string[] = [];
      while (stack.length > 0) {
        const member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        component.push(member);
        if (member === dagIri) break;
      }
      components.push(component);
    };

    for (const dagIri of adjacency.keys()) {
      if (!indices.has(dagIri)) visit(dagIri);
    }

    return components;
  }

  static hasSelfEdge(
    dagIri: string,
    edges: readonly { readonly sourceDagIri: string; readonly targetDagIri: string }[],
  ): boolean {
    return edges.some((edge) => edge.sourceDagIri === dagIri && edge.targetDagIri === dagIri);
  }

  static placementNameOf(placementIri: string): string {
    const marker = placementIri.lastIndexOf('#');
    return marker >= 0 ? decodeURIComponent(placementIri.slice(marker + 1)) : placementIri;
  }
}
