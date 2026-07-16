import type { GraphDatasetInterface, GraphDatasetProviderInterface, GraphScopeType } from '@studnicky/dagonizer';
import { N3GraphDataset, PersistentGraphDataset } from '@studnicky/dagonizer';

import { SqliteGraphJournalStore } from './SqliteGraphJournalStore.js';

/** SQLite graph provider with async reopening and write-behind commits. */
export class SqliteGraphDatasetProvider implements GraphDatasetProviderInterface {
  readonly #journal: SqliteGraphJournalStore;
  readonly #datasets = new Map<string, PersistentGraphDataset>();
  readonly #durableChildren: boolean;

  constructor(path: string, options: { readonly durableChildren?: boolean } = {}) {
    this.#journal = new SqliteGraphJournalStore(path);
    this.#durableChildren = options.durableChildren ?? false;
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
