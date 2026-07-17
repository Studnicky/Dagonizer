/** Supported graph-state transfer formats (wire-contract negotiation values). */
export type GraphStateTransferFormatType = 'application/n-quads';

/**
 * Graph-state envelopes for graph snapshot persistence and export surfaces.
 *
 * Container execution no longer uses these envelopes for transient worker
 * state; it uses `TransientNodeStateBatch` plain JSON snapshots instead.
 */
export type { GraphStateTransferType } from '../entities/executor/GraphStateTransferSchema.js';
