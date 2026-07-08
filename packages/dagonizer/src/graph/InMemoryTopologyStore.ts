import type {
  BindingType,
  QuadType,
  SlotPatternType,
  TermType,
  TripleStoreInterface,
} from '../contracts/TripleStoreInterface.js';

import { DagGraphTerms } from './DagGraphTerms.js';

export class InMemoryTopologyStore implements TripleStoreInterface {
  readonly #quads: QuadType[] = [];

  assert(subject: TermType, predicate: TermType, object: TermType, graph: TermType = DagGraphTerms.defaultGraph()): void {
    this.#quads.push({ subject, predicate, object, graph });
  }

  ask(pattern: SlotPatternType): boolean {
    return this.select(pattern).length > 0;
  }

  select(pattern: SlotPatternType): readonly BindingType[] {
    const rows: BindingType[] = [];
    for (const quad of this.#quads) {
      const binding: BindingType = {};
      if (!InMemoryTopologyStore.matchTerm(quad.subject, pattern.subject, binding)) continue;
      if (!InMemoryTopologyStore.matchTerm(quad.predicate, pattern.predicate, binding)) continue;
      if (!InMemoryTopologyStore.matchTerm(quad.object, pattern.object, binding)) continue;
      if (!InMemoryTopologyStore.matchTerm(quad.graph, pattern.graph, binding)) continue;
      rows.push(binding);
    }
    return rows;
  }

  count(pattern: SlotPatternType): number {
    return this.select(pattern).length;
  }

  clearGraph(graph: TermType): void {
    let index = this.#quads.length;
    while (index > 0) {
      index -= 1;
      if (InMemoryTopologyStore.sameTerm(this.#quads[index]?.graph, graph)) {
        this.#quads.splice(index, 1);
      }
    }
  }

  *triples(): IterableIterator<QuadType> {
    yield* this.#quads;
  }

  private static matchTerm(actual: TermType, expected: TermType | string | undefined, binding: BindingType): boolean {
    if (expected === undefined) return true;
    if (typeof expected !== 'string') {
      return InMemoryTopologyStore.sameTerm(actual, expected);
    }
    if (!expected.startsWith('?')) return false;
    const key = expected.slice(1);
    const existing = binding[key];
    if (existing === undefined) {
      binding[key] = actual;
      return true;
    }
    return InMemoryTopologyStore.sameTerm(actual, existing);
  }

  private static sameTerm(left: TermType | undefined, right: TermType): boolean {
    return left?.termType === right.termType && left.value === right.value;
  }
}
