import type { GraphDatasetInterface, GraphDatasetProviderInterface, GraphScopeType } from '@studnicky/dagonizer';
import { N3GraphDataset, PersistentGraphDataset } from '@studnicky/dagonizer';

import { OpfsGraphJournalStore } from './OpfsGraphJournalStore.js';

export type OpfsGraphDatasetProviderOptionsType = {
  readonly durableChildren?: boolean;
};

/** OPFS graph provider with async reopening and write-behind durability. */
export class OpfsGraphDatasetProvider implements GraphDatasetProviderInterface {
  readonly #journal: OpfsGraphJournalStore;
  readonly #datasets = new Map<string, PersistentGraphDataset>();
  readonly #durableChildren: boolean;

  constructor(journal: OpfsGraphJournalStore, options: { readonly durableChildren?: boolean } = {}) {
    this.#journal = journal;
    this.#durableChildren = options.durableChildren ?? false;
  }

  static async rooted(dirName: string, options: OpfsGraphDatasetProviderOptionsType = {}): Promise<OpfsGraphDatasetProvider> {
    const journal = await OpfsGraphJournalStore.rooted(dirName);
    await journal.connect();
    return new OpfsGraphDatasetProvider(journal, options);
  }

  root(runIri: string): GraphDatasetInterface {
    const existing = this.#datasets.get(runIri);
    if (existing !== undefined) return existing;
    const dataset = new PersistentGraphDataset(runIri, this.#journal);
    this.#datasets.set(runIri, dataset);
    return dataset;
  }

  child(_parent: GraphScopeType, child: GraphScopeType): GraphDatasetInterface {
    return this.#durableChildren
      ? new PersistentGraphDataset(child.runIri, this.#journal)
      : new N3GraphDataset();
  }

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
