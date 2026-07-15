import type { GraphDatasetInterface } from '../contracts/GraphDatasetInterface.js';
import type { GraphDatasetProviderInterface, GraphScopeType } from '../contracts/GraphDatasetProviderInterface.js';

import { InMemoryGraphDataset } from './InMemoryGraphDataset.js';

/** Volatile provider used by the default dispatcher. */
export class InMemoryGraphDatasetProvider implements GraphDatasetProviderInterface {
  root(_runIri: string): GraphDatasetInterface {
    return new InMemoryGraphDataset();
  }

  child(_parent: GraphScopeType, _child: GraphScopeType): GraphDatasetInterface {
    return new InMemoryGraphDataset();
  }

  reopen(_runIri: string): undefined {
    return undefined;
  }
}
