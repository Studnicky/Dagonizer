import type { AbortableOptionsType } from '../contracts/AbortableOptionsType.js';
import type { GraphDatasetInterface } from '../contracts/GraphDatasetInterface.js';
import type { BindingType, QuadType, SlotPatternType, TermType } from '../contracts/TripleStoreInterface.js';

import { GraphDatasetRevision } from './GraphDatasetRevision.js';
import { InMemoryTopologyStore } from './InMemoryTopologyStore.js';

/** In-memory RDF dataset adapter for local execution and tests. */
export class InMemoryGraphDataset implements GraphDatasetInterface {
  readonly #store = new InMemoryTopologyStore();

  add(quads: Iterable<QuadType>, _options?: AbortableOptionsType): void {
    for (const quad of quads) this.#store.assert(quad.subject, quad.predicate, quad.object, quad.graph);
  }

  assert(subject: TermType, predicate: TermType, object: TermType, graph?: TermType): void {
    this.#store.assert(subject, predicate, object, graph);
  }

  select(pattern: SlotPatternType): readonly BindingType[] {
    return this.#store.select(pattern);
  }

  count(pattern: SlotPatternType, _options?: AbortableOptionsType): number {
    return this.#store.count(pattern);
  }

  clearGraph(graph: TermType, _options?: AbortableOptionsType): void {
    this.#store.clearGraph(graph);
  }

  *triples(): IterableIterator<QuadType> {
    yield* this.#store.triples();
  }

  delete(pattern: SlotPatternType, _options?: AbortableOptionsType): void {
    this.#store.delete(pattern);
  }

  *match(pattern: SlotPatternType, _options?: AbortableOptionsType): IterableIterator<QuadType> {
    yield* this.#store.matching(pattern);
  }

  ask(pattern: SlotPatternType, _options?: AbortableOptionsType): boolean {
    return this.#store.ask(pattern);
  }

  *exportGraph(graph: TermType, _options?: AbortableOptionsType): IterableIterator<QuadType> {
    yield* this.match({ graph });
  }

  importGraph(quads: Iterable<QuadType>, _options?: AbortableOptionsType): void {
    this.add(quads);
  }

  async importGraphAsync(quads: AsyncIterable<QuadType>, _options?: AbortableOptionsType): Promise<void> {
    await this.#store.importGraphAsync(quads);
  }

  fork(): GraphDatasetInterface {
    return new InMemoryGraphDataset();
  }

  revision(): string {
    return GraphDatasetRevision.of(this);
  }

  transactAtRevision<T>(expectedRevision: string, operation: (dataset: GraphDatasetInterface) => T): T {
    if (this.revision() !== expectedRevision) throw new Error('Graph transaction revision mismatch');
    return this.transact(operation);
  }

  transact<T>(operation: (dataset: GraphDatasetInterface) => T, _options?: AbortableOptionsType): T {
    return operation(this);
  }

  async transactAsync<T>(operation: (dataset: GraphDatasetInterface) => Promise<T>, _options?: AbortableOptionsType): Promise<T> {
    return operation(this);
  }
}
