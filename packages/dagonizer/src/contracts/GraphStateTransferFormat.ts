import type { GraphStateTransferFormatType } from './GraphStateTransfer.js';

export type { GraphStateTransferFormatType } from './GraphStateTransfer.js';

/**
 * Formats available for graph-state contract negotiation.
 */
export const GRAPH_STATE_TRANSFER_FORMATS = [
  'application/n-quads',
  'application/ld+json',
] as const satisfies readonly GraphStateTransferFormatType[];

/**
 * Default graph-state transfer format: inline N-Quads stream.
 */
export const DEFAULT_GRAPH_STATE_TRANSFER_FORMATS: readonly GraphStateTransferFormatType[] = [
  'application/n-quads',
];

/**
 * Normalise caller-provided formats:
 * - remove duplicates
 * - discard unknown values
 * - fall back to N-Quads default when nothing remains
 */
export function normalizeGraphStateTransferFormats(
  formats: readonly GraphStateTransferFormatType[] = DEFAULT_GRAPH_STATE_TRANSFER_FORMATS,
): readonly GraphStateTransferFormatType[] {
  const uniqueFormats = new Map<GraphStateTransferFormatType, true>(
    DEFAULT_GRAPH_STATE_TRANSFER_FORMATS.map((value): [GraphStateTransferFormatType, true] => [value, true]),
  );
  for (const format of formats) {
    uniqueFormats.set(format, true);
  }

  return [...uniqueFormats.keys()];
}

/**
 * Predicate for optional JSON-LD contract support.
 */
export function supportsJsonLd(formats: readonly GraphStateTransferFormatType[]): boolean {
  return formats.includes('application/ld+json');
}
