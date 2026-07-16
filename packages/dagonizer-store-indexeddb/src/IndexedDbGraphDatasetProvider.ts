import type { GraphDatasetInterface, GraphDatasetProviderInterface, GraphScopeType } from '@studnicky/dagonizer';
import { N3GraphDataset, PersistentGraphDataset } from '@studnicky/dagonizer';

import { IndexedDbGraphJournalStore, type IndexedDbGraphJournalStoreOptionsType } from './IndexedDbGraphJournalStore.js';

/** IndexedDB graph provider with async reopening and write-behind durability. */
export class IndexedDbGraphDatasetProvider implements GraphDatasetProviderInterface {
  readonly #journal: IndexedDbGraphJournalStore;
  readonly #datasets = new Map<string, PersistentGraphDataset>();

  constructor(journal: IndexedDbGraphJournalStore) { this.#journal = journal; }

  static async open(options: IndexedDbGraphJournalStoreOptionsType = {}): Promise<IndexedDbGraphDatasetProvider> {
    const journal = IndexedDbGraphJournalStore.open(options);
    await journal.connect();
    return new IndexedDbGraphDatasetProvider(journal);
  }

  root(runIri: string): GraphDatasetInterface {
    const dataset = new PersistentGraphDataset(runIri, this.#journal);
    this.#datasets.set(runIri, dataset);
    return dataset;
  }

  child(_parent: GraphScopeType, _child: GraphScopeType): GraphDatasetInterface { return new N3GraphDataset(); }

  async reopen(runIri: string): Promise<GraphDatasetInterface | undefined> {
    const existing = this.#datasets.get(runIri);
    if (existing !== undefined) return existing;
    const reopened = await PersistentGraphDataset.reopen(runIri, this.#journal);
    this.#datasets.set(runIri, reopened);
    return reopened;
  }

  /** Flush every minted dataset's pending journal writes, then close the journal. */
  async disconnect(): Promise<void> {
    for (const dataset of this.#datasets.values()) await dataset.flush();
    await this.#journal.disconnect();
  }
}
