import type { GraphStateTransferFormatType } from './GraphStateTransfer.js';

export type { GraphStateTransferFormatType } from './GraphStateTransfer.js';

/**
 * Formats available for graph-state contract negotiation.
 */
export const GRAPH_STATE_TRANSFER_FORMATS = [
  'application/n-quads',
] as const satisfies readonly GraphStateTransferFormatType[];

/**
 * Default graph-state transfer format: inline N-Quads stream.
 */
export const DEFAULT_GRAPH_STATE_TRANSFER_FORMATS: readonly GraphStateTransferFormatType[] = [
  'application/n-quads',
];
