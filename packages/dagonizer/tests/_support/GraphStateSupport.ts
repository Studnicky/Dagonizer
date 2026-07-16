import type { GraphStateJsonLdDocumentType } from '../../src/contracts/GraphStateJsonLd.js';
import type { QuadType } from '../../src/contracts/TripleStoreInterface.js';
import type { ExecutionRequestItemType } from '../../src/entities/executor/ExecutionRequest.js';
import type { ExecutionResponseItemType } from '../../src/entities/executor/ExecutionResponse.js';
import type { GraphStateInlineType } from '../../src/entities/executor/GraphStateTransferSchema.js';
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

/** One batch entry: an item id paired with its graph-backed state. */
export type BatchEntry = {
  readonly id: string;
  readonly state: GraphBackedState;
};

export function graphStateDocument(state: GraphBackedState): GraphStateJsonLdDocumentType {
  return state.snapshotJsonLd(state.runIri);
}

function stateQuads(state: GraphBackedState): QuadType[] {
  return [...state.graphDataset.exportGraph(DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(state.runIri)))];
}

/** Combined inline graph-state transfer over every entry's live state graph. */
export function inlineTransfer(states: readonly GraphBackedState[]): GraphStateInlineType {
  return GraphStateTransferCodec.inlineSync(states.map((state) => ({ 'runIri': state.runIri, 'quads': stateQuads(state) })));
}

/** Empty combined inline graph-state transfer for the given run IRIs (a batch of empty graphs). */
export function emptyInlineTransfer(runIris: readonly string[] = ['urn:dagonizer:run:test']): GraphStateInlineType {
  return GraphStateTransferCodec.inlineSync(runIris.map((runIri) => ({ runIri, 'quads': [] })));
}

/** Build the request `items` array (`{ id, runIri, jsonLd }`) for a batch of entries. */
export function requestItems(entries: readonly BatchEntry[]): ExecutionRequestItemType[] {
  return entries.map((entry) => ({ 'id': entry.id, 'runIri': entry.state.runIri, 'jsonLd': graphStateDocument(entry.state) }));
}

/** Build the response `items` array (`{ id, runIri, terminalOutcome, jsonLd }`) for a batch of entries. */
export function responseItems(entries: readonly (BatchEntry & { readonly terminalOutcome: string })[]): ExecutionResponseItemType[] {
  return entries.map((entry) => ({ 'id': entry.id, 'runIri': entry.state.runIri, 'terminalOutcome': entry.terminalOutcome, 'jsonLd': graphStateDocument(entry.state) }));
}
