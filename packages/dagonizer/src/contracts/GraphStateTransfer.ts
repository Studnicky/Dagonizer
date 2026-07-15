import type { GraphStateTransferMetadataType } from './GraphStateTransferMetadata.js';

/** Graph-state envelopes; JSON-LD is the Node.js IR and N-Quads is the transfer serialization. */
export type GraphStateTransferType =
  | ({ readonly mode: 'inline-nquads'; readonly format: 'application/n-quads'; readonly runIri: string; readonly graphIris: string[]; readonly nquads: string; readonly hash: string } & GraphStateTransferMetadataType)
  | ({ readonly mode: 'graph-ref'; readonly runIri: string; readonly graphSnapshotRef: string; readonly format: string; readonly graphIris: string[]; readonly hash: string } & GraphStateTransferMetadataType)
  | ({ readonly mode: 'shared-endpoint'; readonly runIri: string; readonly endpoint: string; readonly graphIris: string[]; readonly lease: string } & GraphStateTransferMetadataType)
  | ({ readonly mode: 'delta-ref'; readonly runIri: string; readonly baseSnapshotRef: string; readonly baseRevision?: string; readonly revision?: string; readonly graphIris: string[]; readonly additions: string; readonly deletions: string; readonly hash: string } & GraphStateTransferMetadataType)
  | ({ readonly mode: 'inline-delta-nquads'; readonly runIri: string; readonly baseSnapshotRef: string; readonly baseRevision?: string; readonly revision?: string; readonly graphIris: string[]; readonly additions: string; readonly deletions: string; readonly hash: string } & GraphStateTransferMetadataType);
