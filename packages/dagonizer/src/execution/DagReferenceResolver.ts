import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import type { TripleStoreInterface } from '../contracts/TripleStoreInterface.js';
import { ContextResolver } from '../dag/ContextResolver.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { DagReference } from '../entities/dag/DagReference.js';
import type { DagReferenceType } from '../entities/dag/DagReference.js';
import { DagGraphProjector } from '../graph/DagGraphProjector.js';

export class DagReferenceResolver {
  private constructor() { /* static-only */ }

  static resolve(input: {
    readonly reference: DagReferenceType;
    readonly source: 'state' | 'item';
    readonly value: unknown;
    readonly context: Record<string, unknown>;
    readonly dags: ReadonlyMap<string, DAGType>;
    readonly accessor: StateAccessorInterface;
    readonly candidateIris?: ReadonlySet<string>;
  }): string | null {
    const dagIri = DagReferenceResolver.resolveIri(input);
    return dagIri !== null && input.dags.has(dagIri) ? dagIri : null;
  }

  static resolveIri(input: {
    readonly reference: DagReferenceType;
    readonly source: 'state' | 'item';
    readonly value: unknown;
    readonly context: Record<string, unknown>;
    readonly accessor: StateAccessorInterface;
    readonly candidateIris?: ReadonlySet<string>;
  }): string | null {
    if (!DagReference.isDynamic(input.reference)) {
      return ContextResolver.expand(input.reference, input.context);
    }
    if (input.reference.from !== input.source) return null;
    if (typeof input.value !== 'object' || input.value === null) return null;
    const selected = input.accessor.get(input.value, input.reference.path);
    if (typeof selected !== 'string' || selected.length === 0) return null;

    const selectedIri = ContextResolver.expand(selected, input.context);
    const candidateIris = input.candidateIris ?? DagReferenceResolver.candidateIris(input.reference, input.context);
    return candidateIris.has(selectedIri)
      ? selectedIri
      : null;
  }

  static bindSelectedDag(input: {
    readonly store: TripleStoreInterface;
    readonly ownerPlacementIri: string;
    readonly selectedDagIri: string | null;
    readonly graphIri?: string;
  }): void {
    if (input.selectedDagIri === null) return;
    DagGraphProjector.bindSelectedDag(
      input.store,
      input.ownerPlacementIri,
      input.selectedDagIri,
      input.graphIri,
    );
  }

  static candidateIris(reference: DagReferenceType, context: Record<string, unknown>): ReadonlySet<string> {
    const result = new Set<string>();
    for (const candidate of DagReference.candidates(reference)) {
      result.add(ContextResolver.expand(candidate, context));
    }
    return result;
  }
}
