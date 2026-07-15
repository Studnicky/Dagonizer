import { N3GraphDataset } from '../adapter/N3GraphDataset.js';
import type { GraphDatasetInterface } from '../contracts/GraphDatasetInterface.js';
import type { GraphDatasetProviderInterface, GraphScopeType } from '../contracts/GraphDatasetProviderInterface.js';

/** Volatile browser-safe provider backed by N3. */
export class N3GraphDatasetProvider implements GraphDatasetProviderInterface {
  root(_runIri: string): GraphDatasetInterface {
    return new N3GraphDataset();
  }

  child(_parent: GraphScopeType, _child: GraphScopeType): GraphDatasetInterface {
    return new N3GraphDataset();
  }

  reopen(_runIri: string): undefined {
    return undefined;
  }
}
