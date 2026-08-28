/** Supported graph-state transfer formats (wire-contract negotiation values). */
export type GraphStateTransferFormatType = 'application/n-quads';

/**
 * Graph-state envelopes for container execution, graph snapshot persistence,
 * and export surfaces. Container state crosses the wire as one codec-backed
 * N-Quads batch transfer.
 */
export type { GraphStateTransferType } from '../entities/executor/GraphStateTransferSchema.js';
