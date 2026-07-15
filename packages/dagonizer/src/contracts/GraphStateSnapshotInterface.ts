import type { AbortableOptionsType } from './AbortableOptionsType.js';
import type { QuadType } from './TripleStoreInterface.js';

/** Streaming graph snapshot seam used by checkpoints and remote transfer. */
export interface GraphStateSnapshotInterface {
  snapshotGraph(runIri: string, options?: AbortableOptionsType): AsyncIterable<QuadType>;
  restoreGraph(runIri: string, quads: AsyncIterable<QuadType>, options?: AbortableOptionsType): Promise<void>;
}
