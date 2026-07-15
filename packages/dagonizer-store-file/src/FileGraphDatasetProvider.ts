import type { GraphDatasetInterface, GraphDatasetProviderInterface, GraphScopeType } from '@studnicky/dagonizer/contracts';

import { FileGraphDataset } from './FileGraphDataset.js';

/** Node provider that maps each root run to one file-backed graph. */
export class FileGraphDatasetProvider implements GraphDatasetProviderInterface {
  readonly #basePath: string;

  constructor(basePath: string) {
    this.#basePath = basePath;
  }

  root(runIri: string): GraphDatasetInterface {
    return new FileGraphDataset(this.#pathFor(runIri));
  }

  child(_parent: GraphScopeType, _child: GraphScopeType): GraphDatasetInterface {
    return new FileGraphDataset(this.#pathFor(`${_child.runIri}/child`));
  }

  reopen(runIri: string): GraphDatasetInterface {
    return new FileGraphDataset(this.#pathFor(runIri));
  }

  #pathFor(runIri: string): string {
    return `${this.#basePath}/${encodeURIComponent(runIri)}.nq`;
  }
}
