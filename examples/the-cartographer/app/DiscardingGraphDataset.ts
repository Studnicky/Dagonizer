import type { AbortableOptionsType, GraphDatasetInterface, QuadType, SlotPatternType, TermType } from '@studnicky/dagonizer/contracts';

/**
 * Browser-only topology sink that intentionally discards every write.
 *
 * The cartographer demo drives its live DAG visualization from observer hooks,
 * not from `executionTopologyStore` queries. Retaining per-event `NodeEdges`
 * quads in the browser process therefore burns heap without powering any UI.
 *
 * This dataset satisfies the dispatcher contract while making topology writes
 * O(1) and non-retentive on the page thread.
 */
export class DiscardingGraphDataset implements GraphDatasetInterface {
  add(_quads: Iterable<QuadType>, _options?: AbortableOptionsType): void {}

  delete(_pattern: SlotPatternType, _options?: AbortableOptionsType): void {}

  match(_pattern: SlotPatternType, _options?: AbortableOptionsType): IterableIterator<QuadType> {
    return [][Symbol.iterator]();
  }

  ask(_pattern: SlotPatternType, _options?: AbortableOptionsType): boolean {
    return false;
  }

  count(_pattern: SlotPatternType, _options?: AbortableOptionsType): number {
    return 0;
  }

  clearGraph(_graph: TermType, _options?: AbortableOptionsType): void {}

  exportGraph(_graph: TermType, _options?: AbortableOptionsType): IterableIterator<QuadType> {
    return [][Symbol.iterator]();
  }

  importGraph(_quads: Iterable<QuadType>, _options?: AbortableOptionsType): void {}

  async importGraphAsync(_quads: AsyncIterable<QuadType>, _options?: AbortableOptionsType): Promise<void> {}

  fork(): GraphDatasetInterface {
    return new DiscardingGraphDataset();
  }

  revision(): string {
    return '0';
  }

  transactAtRevision<T>(_expectedRevision: string, operation: (dataset: GraphDatasetInterface) => T, _options?: AbortableOptionsType): T {
    return operation(this);
  }

  transact<T>(operation: (dataset: GraphDatasetInterface) => T, _options?: AbortableOptionsType): T {
    return operation(this);
  }

  async transactAsync<T>(operation: (dataset: GraphDatasetInterface) => Promise<T>, _options?: AbortableOptionsType): Promise<T> {
    return operation(this);
  }

  assert(_subject: TermType, _predicate: TermType, _object: TermType, _graph?: TermType): void {}

  select(_pattern: SlotPatternType): readonly Record<string, TermType>[] {
    return [];
  }

  triples(): IterableIterator<QuadType> {
    return [][Symbol.iterator]();
  }
}
