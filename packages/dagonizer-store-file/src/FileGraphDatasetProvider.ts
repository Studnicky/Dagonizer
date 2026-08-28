import { N3GraphDataset } from '@studnicky/dagonizer/adapter';
import type { GraphDatasetInterface, GraphDatasetProviderInterface, GraphScopeType } from '@studnicky/dagonizer/contracts';

import { FileGraphDataset } from './FileGraphDataset.js';

export type FileGraphDatasetProviderOptionsType = {
  readonly durableChildren?: boolean;
};

/** Node provider that maps each root run to one file-backed graph. */
export class FileGraphDatasetProvider implements GraphDatasetProviderInterface {
  readonly #basePath: string;
  readonly #durableChildren: boolean;
  readonly #datasets = new Map<string, FileGraphDataset>();

  constructor(basePath: string, options: FileGraphDatasetProviderOptionsType = {}) {
    this.#basePath = basePath;
    this.#durableChildren = options.durableChildren ?? false;
  }

  root(runIri: string): GraphDatasetInterface {
    const existing = this.#datasets.get(runIri);
    if (existing !== undefined) return existing;
    const dataset = new FileGraphDataset(this.#pathFor(runIri));
    this.#datasets.set(runIri, dataset);
    return dataset;
  }

  child(_parent: GraphScopeType, child: GraphScopeType): GraphDatasetInterface {
    if (!this.#durableChildren) return new N3GraphDataset();
    const key = `${child.runIri}/child`;
    const existing = this.#datasets.get(key);
    if (existing !== undefined) return existing;
    const dataset = new FileGraphDataset(this.#pathFor(key));
    this.#datasets.set(key, dataset);
    return dataset;
  }

  async reopen(runIri: string): Promise<GraphDatasetInterface> {
    const existing = this.#datasets.get(runIri);
    if (existing !== undefined) return existing;
    const dataset = new FileGraphDataset(this.#pathFor(runIri));
    this.#datasets.set(runIri, dataset);
    return dataset;
  }

  #pathFor(runIri: string): string {
    return `${this.#basePath}/${encodeURIComponent(runIri)}.nq`;
  }
}
