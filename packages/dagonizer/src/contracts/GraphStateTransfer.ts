/** Supported graph-state transfer formats (wire-contract negotiation values). */
export type GraphStateTransferFormatType = 'application/n-quads' | 'application/ld+json';

/** Graph-state envelopes; JSON-LD is the Node.js IR and N-Quads is the transfer serialization. */
export type { GraphStateTransferType } from '../entities/executor/GraphStateTransferSchema.js';
