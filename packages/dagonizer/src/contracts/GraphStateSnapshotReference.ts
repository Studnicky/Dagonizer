import type { GraphStateTransferMetadataType } from './GraphStateTransferMetadata.js';

/** Metadata for a graph snapshot held by a transfer adapter. */
export type GraphStateSnapshotReferenceType = GraphStateTransferMetadataType & {
  readonly reference: string;
  readonly format: 'application/n-quads';
  readonly graphIris: string[];
  readonly hash: string;
};
