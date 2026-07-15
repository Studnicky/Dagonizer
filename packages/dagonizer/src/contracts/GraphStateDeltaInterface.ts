import type { QuadType } from './TripleStoreInterface.js';

/** Incremental graph snapshot seam for transports that already have a base. */
export interface GraphStateDeltaInterface {
  snapshotGraphDelta(runIri: string): Promise<{ readonly additions: readonly QuadType[]; readonly deletions: readonly QuadType[]; readonly baseRevision: string; readonly revision: string }>;
}
