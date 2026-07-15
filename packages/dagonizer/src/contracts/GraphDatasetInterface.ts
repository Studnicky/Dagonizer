import type { AbortableOptionsType } from './AbortableOptionsType.js';
import type { QuadType, SlotPatternType, TermType, TripleStoreInterface } from './TripleStoreInterface.js';

/** Canonical RDF dataset port used by topology, contracts, execution, and state. */
export interface GraphDatasetInterface extends TripleStoreInterface {
  add(quads: Iterable<QuadType>, options?: AbortableOptionsType): void;
  delete(pattern: SlotPatternType, options?: AbortableOptionsType): void;
  match(pattern: SlotPatternType, options?: AbortableOptionsType): IterableIterator<QuadType>;
  ask(pattern: SlotPatternType, options?: AbortableOptionsType): boolean;
  count(pattern: SlotPatternType, options?: AbortableOptionsType): number;
  clearGraph(graph: TermType, options?: AbortableOptionsType): void;
  exportGraph(graph: TermType, options?: AbortableOptionsType): IterableIterator<QuadType>;
  importGraph(quads: Iterable<QuadType>, options?: AbortableOptionsType): void;
  importGraphAsync(quads: AsyncIterable<QuadType>, options?: AbortableOptionsType): Promise<void>;
  /** Create an isolated dataset for a cloned node state. */
  fork(): GraphDatasetInterface;
  /** Deterministic content revision used for optimistic graph updates. */
  revision(): string;
  /** Apply one transaction only when the dataset still has the expected revision. */
  transactAtRevision<T>(expectedRevision: string, operation: (dataset: GraphDatasetInterface) => T, options?: AbortableOptionsType): T;
  transact<T>(operation: (dataset: GraphDatasetInterface) => T, options?: AbortableOptionsType): T;
  transactAsync<T>(operation: (dataset: GraphDatasetInterface) => Promise<T>, options?: AbortableOptionsType): Promise<T>;
}
