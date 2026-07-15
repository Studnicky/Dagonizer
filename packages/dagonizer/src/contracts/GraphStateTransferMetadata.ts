import type { GraphStateJsonLdDocumentType } from './GraphStateJsonLd.js';

/** Required caller-owned identity for a graph-state transfer. */
export type GraphStateTransferIdentityType = Pick<GraphStateTransferMetadataType, 'dagIri' | 'placementPath' | 'placementIri' | 'jsonLd'> & Partial<Pick<GraphStateTransferMetadataType, 'stateGraphIri' | 'createdAt' | 'byteSize' | 'quadCount'>>;

/** Identity and integrity metadata carried by every graph-state transfer. */
export type GraphStateTransferMetadataType = {
  readonly dagIri: string;
  readonly placementPath: string[];
  readonly placementIri: string;
  readonly stateGraphIri: string;
  readonly createdAt: string;
  readonly byteSize: number;
  readonly quadCount: number;
  /** Node.js JSON-LD view of the same graph payload. */
  readonly jsonLd: GraphStateJsonLdDocumentType;
};
