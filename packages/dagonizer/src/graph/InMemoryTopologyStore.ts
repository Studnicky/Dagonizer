import type { GraphDatasetInterface } from '../contracts/GraphDatasetInterface.js';
import type {
  BindingType,
  QuadType,
  SlotPatternType,
  TermType,
  TripleStoreInterface,
} from '../contracts/TripleStoreInterface.js';

import { DagGraphTerms } from './DagGraphTerms.js';
import { GraphDatasetRevision } from './GraphDatasetRevision.js';

export class InMemoryTopologyStore implements TripleStoreInterface, GraphDatasetInterface {
  readonly #quads: QuadType[] = [];
  readonly #keys = new Set<string>();
  readonly #bySubject = new Map<string, Set<QuadType>>();
  readonly #byPredicate = new Map<string, Set<QuadType>>();
  readonly #byObject = new Map<string, Set<QuadType>>();
  readonly #byGraph = new Map<string, Set<QuadType>>();

  assert(subject: TermType, predicate: TermType, object: TermType, graph: TermType = DagGraphTerms.defaultGraph()): void {
    const quad = { subject, predicate, object, graph };
    const key = InMemoryTopologyStore.quadKey(quad);
    if (this.#keys.has(key)) return;
    this.#keys.add(key);
    this.#quads.push(quad);
    this.#addToIndex(this.#bySubject, subject, quad);
    this.#addToIndex(this.#byPredicate, predicate, quad);
    this.#addToIndex(this.#byObject, object, quad);
    this.#addToIndex(this.#byGraph, graph, quad);
  }

  add(quads: Iterable<QuadType>): void {
    for (const quad of quads) this.assert(quad.subject, quad.predicate, quad.object, quad.graph);
  }

  *match(pattern: SlotPatternType): IterableIterator<QuadType> {
    yield* this.matching(pattern);
  }

  *exportGraph(graph: TermType): IterableIterator<QuadType> {
    yield* this.matching({ graph });
  }

  importGraph(quads: Iterable<QuadType>): void {
    this.add(quads);
  }

  async importGraphAsync(quads: AsyncIterable<QuadType>): Promise<void> {
    for await (const quad of quads) this.assert(quad.subject, quad.predicate, quad.object, quad.graph);
  }

  fork(): GraphDatasetInterface {
    return new InMemoryTopologyStore();
  }

  revision(): string {
    return GraphDatasetRevision.of(this);
  }

  transactAtRevision<T>(expectedRevision: string, operation: (dataset: GraphDatasetInterface) => T): T {
    if (this.revision() !== expectedRevision) throw new Error('Graph transaction revision mismatch');
    return this.transact(operation);
  }

  transact<T>(operation: (dataset: GraphDatasetInterface) => T): T {
    return operation(this);
  }

  async transactAsync<T>(operation: (dataset: GraphDatasetInterface) => Promise<T>): Promise<T> {
    return operation(this);
  }

  ask(pattern: SlotPatternType): boolean {
    for (const quad of this.#candidates(pattern)) {
      if (InMemoryTopologyStore.matches(quad, pattern)) return true;
    }
    return false;
  }

  select(pattern: SlotPatternType): readonly BindingType[] {
    const rows: BindingType[] = [];
    for (const quad of this.#candidates(pattern)) {
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
    let count = 0;
    for (const quad of this.#candidates(pattern)) {
      if (InMemoryTopologyStore.matches(quad, pattern)) count += 1;
    }
    return count;
  }

  *matching(pattern: SlotPatternType): IterableIterator<QuadType> {
    for (const quad of this.#candidates(pattern)) {
      if (InMemoryTopologyStore.matches(quad, pattern)) yield quad;
    }
  }

  clearGraph(graph: TermType): void {
    let index = this.#quads.length;
    while (index > 0) {
      index -= 1;
      if (InMemoryTopologyStore.sameTerm(this.#quads[index]?.graph, graph)) {
        const quad = this.#quads[index];
        if (quad !== undefined) {
          this.#removeFromIndexes(quad);
          this.#keys.delete(InMemoryTopologyStore.quadKey(quad));
          this.#quads.splice(index, 1);
        }
      }
    }
  }

  delete(pattern: SlotPatternType): void {
    let index = this.#quads.length;
    while (index > 0) {
      index -= 1;
      const quad = this.#quads[index];
      if (quad !== undefined && InMemoryTopologyStore.matches(quad, pattern)) {
        this.#removeFromIndexes(quad);
        this.#keys.delete(InMemoryTopologyStore.quadKey(quad));
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

  #candidates(pattern: SlotPatternType): Iterable<QuadType> {
    const subject = this.#concreteBucket(this.#bySubject, pattern.subject);
    if (subject !== undefined) return subject;
    const predicate = this.#concreteBucket(this.#byPredicate, pattern.predicate);
    if (predicate !== undefined) return predicate;
    const object = this.#concreteBucket(this.#byObject, pattern.object);
    if (object !== undefined) return object;
    const graph = this.#concreteBucket(this.#byGraph, pattern.graph);
    return graph ?? this.#quads;
  }

  #concreteBucket(index: ReadonlyMap<string, Set<QuadType>>, term: TermType | string | undefined): Set<QuadType> | undefined {
    if (term === undefined || typeof term === 'string') return undefined;
    return index.get(InMemoryTopologyStore.termKey(term)) ?? new Set<QuadType>();
  }

  #addToIndex(index: Map<string, Set<QuadType>>, term: TermType, quad: QuadType): void {
    const key = InMemoryTopologyStore.termKey(term);
    const bucket = index.get(key);
    if (bucket !== undefined) {
      bucket.add(quad);
      return;
    }
    index.set(key, new Set([quad]));
  }

  #removeFromIndexes(quad: QuadType): void {
    this.#removeFromIndex(this.#bySubject, quad.subject, quad);
    this.#removeFromIndex(this.#byPredicate, quad.predicate, quad);
    this.#removeFromIndex(this.#byObject, quad.object, quad);
    this.#removeFromIndex(this.#byGraph, quad.graph, quad);
  }

  #removeFromIndex(index: Map<string, Set<QuadType>>, term: TermType, quad: QuadType): void {
    const key = InMemoryTopologyStore.termKey(term);
    const bucket = index.get(key);
    if (bucket === undefined) return;
    bucket.delete(quad);
    if (bucket.size === 0) index.delete(key);
  }

  private static matches(quad: QuadType, pattern: SlotPatternType): boolean {
    const binding: BindingType = {};
    return InMemoryTopologyStore.matchTerm(quad.subject, pattern.subject, binding)
      && InMemoryTopologyStore.matchTerm(quad.predicate, pattern.predicate, binding)
      && InMemoryTopologyStore.matchTerm(quad.object, pattern.object, binding)
      && InMemoryTopologyStore.matchTerm(quad.graph, pattern.graph, binding);
  }

  private static sameTerm(left: TermType | undefined, right: TermType): boolean {
    if (left?.termType !== right.termType || left.value !== right.value) return false;
    if (left.termType === 'Literal' && right.termType === 'Literal') {
      if (left.language !== right.language) return false;
      if (left.datatype?.value !== right.datatype?.value) return false;
    }
    if (left.termType !== 'Quad' || right.termType !== 'Quad') return true;
    return InMemoryTopologyStore.sameQuad(left.quad, right.quad);
  }

  private static termKey(term: TermType): string {
    if (term.termType !== 'Quad') {
      const literalMetadata = term.termType === 'Literal' ? `:${term.language ?? ''}:${term.datatype?.value ?? ''}` : '';
      return `${term.termType}:${term.value}${literalMetadata}`;
    }
    return `Quad:${InMemoryTopologyStore.termKey(term.quad.subject)}|${InMemoryTopologyStore.termKey(term.quad.predicate)}|${InMemoryTopologyStore.termKey(term.quad.object)}|${InMemoryTopologyStore.termKey(term.quad.graph)}`;
  }

  private static sameQuad(left: QuadType, right: QuadType): boolean {
    return InMemoryTopologyStore.sameTerm(left.subject, right.subject)
      && InMemoryTopologyStore.sameTerm(left.predicate, right.predicate)
      && InMemoryTopologyStore.sameTerm(left.object, right.object)
      && InMemoryTopologyStore.sameTerm(left.graph, right.graph);
  }

  private static quadKey(quad: QuadType): string {
    return `${InMemoryTopologyStore.termKey(quad.subject)}|${InMemoryTopologyStore.termKey(quad.predicate)}|${InMemoryTopologyStore.termKey(quad.object)}|${InMemoryTopologyStore.termKey(quad.graph)}`;
  }
}
