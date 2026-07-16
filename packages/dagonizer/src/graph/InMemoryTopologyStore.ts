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
  // Keyed by the quad's `s|p|o|g` term-key string: the key is the dedup identity,
  // the value is the quad delivered on read — one allocation for both roles.
  readonly #quads = new Map<string, QuadType>();
  readonly #bySubject = new Map<string, Set<QuadType>>();
  readonly #byPredicate = new Map<string, Set<QuadType>>();
  readonly #byGraph = new Map<string, Set<QuadType>>();
  #revisionCache: string | undefined;

  /** Shared empty result for concrete-term lookups that miss. */
  static readonly #EMPTY: readonly QuadType[] = [];

  assert(subject: TermType, predicate: TermType, object: TermType, graph: TermType = DagGraphTerms.defaultGraph()): void {
    // Each term key is computed once and reused for the dedup key and all four indexes.
    const subjectKey = InMemoryTopologyStore.termKey(subject);
    const predicateKey = InMemoryTopologyStore.termKey(predicate);
    const objectKey = InMemoryTopologyStore.termKey(object);
    const graphKey = InMemoryTopologyStore.termKey(graph);
    const key = `${subjectKey}|${predicateKey}|${objectKey}|${graphKey}`;
    if (this.#quads.has(key)) return;
    this.#revisionCache = undefined;
    const quad = { subject, predicate, object, graph };
    this.#quads.set(key, quad);
    this.#addToIndex(this.#bySubject, subjectKey, quad);
    this.#addToIndex(this.#byPredicate, predicateKey, quad);
    this.#addToIndex(this.#byGraph, graphKey, quad);
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
    if (this.#revisionCache === undefined) this.#revisionCache = GraphDatasetRevision.of(this);
    return this.#revisionCache;
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
    // The `#byGraph` bucket holds exactly this graph's quads; iterate a snapshot
    // because `#removeQuad` mutates the bucket as it goes.
    const bucket = this.#byGraph.get(InMemoryTopologyStore.termKey(graph));
    if (bucket === undefined) return;
    this.#revisionCache = undefined;
    for (const quad of [...bucket]) {
      this.#removeQuad(quad);
    }
  }

  delete(pattern: SlotPatternType): void {
    // Narrow to candidates via the concrete-term index, collect the matches into
    // a snapshot, then remove them — the snapshot avoids mutating during iteration.
    const matched: QuadType[] = [];
    for (const quad of this.#candidates(pattern)) {
      if (InMemoryTopologyStore.matches(quad, pattern)) matched.push(quad);
    }
    if (matched.length === 0) return;
    this.#revisionCache = undefined;
    for (const quad of matched) {
      this.#removeQuad(quad);
    }
  }

  *triples(): IterableIterator<QuadType> {
    yield* this.#quads.values();
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
    // Object is not indexed: no query narrows on object as its most-selective
    // term, and `matches` filters the candidate set for correctness regardless.
    const subject = this.#concreteBucket(this.#bySubject, pattern.subject);
    if (subject !== undefined) return subject;
    const predicate = this.#concreteBucket(this.#byPredicate, pattern.predicate);
    if (predicate !== undefined) return predicate;
    const graph = this.#concreteBucket(this.#byGraph, pattern.graph);
    return graph ?? this.#quads.values();
  }

  #concreteBucket(index: ReadonlyMap<string, Set<QuadType>>, term: TermType | string | undefined): Iterable<QuadType> | undefined {
    if (term === undefined || typeof term === 'string') return undefined;
    // A concrete term with no bucket yields the shared empty iterable rather
    // than a fresh throwaway Set per miss.
    return index.get(InMemoryTopologyStore.termKey(term)) ?? InMemoryTopologyStore.#EMPTY;
  }

  #addToIndex(index: Map<string, Set<QuadType>>, key: string, quad: QuadType): void {
    const bucket = index.get(key);
    if (bucket !== undefined) {
      bucket.add(quad);
      return;
    }
    index.set(key, new Set([quad]));
  }

  /**
   * Remove a quad from every index and the keyed quad map. Each term key is
   * computed once and shared across the four index removals and the map key.
   */
  #removeQuad(quad: QuadType): void {
    const subjectKey = InMemoryTopologyStore.termKey(quad.subject);
    const predicateKey = InMemoryTopologyStore.termKey(quad.predicate);
    const objectKey = InMemoryTopologyStore.termKey(quad.object);
    const graphKey = InMemoryTopologyStore.termKey(quad.graph);
    this.#removeFromIndex(this.#bySubject, subjectKey, quad);
    this.#removeFromIndex(this.#byPredicate, predicateKey, quad);
    this.#removeFromIndex(this.#byGraph, graphKey, quad);
    this.#quads.delete(`${subjectKey}|${predicateKey}|${objectKey}|${graphKey}`);
  }

  #removeFromIndex(index: Map<string, Set<QuadType>>, key: string, quad: QuadType): void {
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
}
