import type { GraphStateSnapshotReferenceType } from './GraphStateSnapshotReference.js';
import type { GraphStateTransferLeaseType } from './GraphStateTransferLease.js';
import type { QuadType } from './TripleStoreInterface.js';

/** Adapter port for graph snapshot references and shared-endpoint leases. */
export interface GraphStateTransferStoreInterface {
  readonly endpoint: string;
  putSnapshot(quads: AsyncIterable<QuadType>, metadata: GraphStateSnapshotReferenceType): Promise<GraphStateSnapshotReferenceType>;
  readSnapshot(reference: string): AsyncIterable<QuadType>;
  deleteSnapshot(reference: string): Promise<void>;
  acquireLease(graphIris: readonly string[], ttlMs: number): Promise<GraphStateTransferLeaseType>;
  releaseLease(lease: GraphStateTransferLeaseType): Promise<void>;
  readShared(lease: GraphStateTransferLeaseType, graphIris: readonly string[]): AsyncIterable<QuadType>;
  writeShared(lease: GraphStateTransferLeaseType, quads: AsyncIterable<QuadType>): Promise<void>;
}
