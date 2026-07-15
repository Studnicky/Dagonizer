import type { GraphStateJsonLdDocumentType } from '../../src/contracts/GraphStateJsonLd.js';
import type { GraphStateTransferType } from '../../src/contracts/GraphStateTransfer.js';
import type { GraphStateTransferIdentityType } from '../../src/contracts/GraphStateTransferMetadata.js';
import type { QuadType } from '../../src/contracts/TripleStoreInterface.js';
import { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { GraphStateTerms } from '../../src/graph/GraphStateTerms.js';
import { GraphStateTransferCodec } from '../../src/graph/GraphStateTransferCodec.js';

type GraphBackedState = {
  readonly runIri: string;
  readonly graphDataset: {
    exportGraph(graph: ReturnType<typeof DagGraphTerms.namedNode>): IterableIterator<QuadType>;
  };
  snapshotJsonLd(runIri?: string): GraphStateJsonLdDocumentType;
};

export function graphStateDocument(state: GraphBackedState): GraphStateJsonLdDocumentType {
  return state.snapshotJsonLd(state.runIri);
}

export function graphStateTransfer(state: GraphBackedState, identity: Partial<Omit<GraphStateTransferIdentityType, 'jsonLd'>> = {}): GraphStateTransferType {
  const document = graphStateDocument(state);
  const graphIri = GraphStateTerms.runGraphIri(state.runIri);
  return GraphStateTransferCodec.inline(
    state.runIri,
    [graphIri],
    state.graphDataset.exportGraph(DagGraphTerms.namedNode(graphIri)),
    {
      'dagIri': identity.dagIri ?? 'urn:dagonizer:dag:test',
      'placementPath': identity.placementPath ?? ['urn:dagonizer:placement:test'],
      'placementIri': identity.placementIri ?? 'urn:dagonizer:placement:test',
      ...identity,
      'stateGraphIri': graphIri,
      'jsonLd': document,
    },
  );
}

export function emptyGraphStateTransfer(runIri = 'urn:dagonizer:run:test'): GraphStateTransferType {
  return GraphStateTransferCodec.inline(
    runIri,
    [GraphStateTerms.runGraphIri(runIri)],
    [],
    {
      'dagIri': 'urn:dagonizer:dag:test',
      'placementPath': ['urn:dagonizer:placement:test'],
      'placementIri': 'urn:dagonizer:placement:test',
      'stateGraphIri': GraphStateTerms.runGraphIri(runIri),
      'jsonLd': { '@context': GraphStateTerms.JSON_LD_CONTEXT, '@graph': [] },
    },
  );
}
