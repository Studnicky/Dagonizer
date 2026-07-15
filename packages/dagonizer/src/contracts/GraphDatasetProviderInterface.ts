import type { GraphDatasetInterface } from './GraphDatasetInterface.js';

/** IRI identity for a live root or isolated child graph. */
export type GraphScopeType = {
  readonly runIri: string;
  readonly dagIri: string;
  readonly placementIri: string;
  readonly workItemIri?: string;
};

/** Mints the synchronous datasets used by state, topology, and transfer paths. */
export interface GraphDatasetProviderInterface {
  root(runIri: string): GraphDatasetInterface;
  child(parent: GraphScopeType, child: GraphScopeType): GraphDatasetInterface;
  reopen(runIri: string): GraphDatasetInterface | undefined;
}
