import type { QuadType } from '../../src/contracts/TripleStoreInterface.js';
import type { ExecutionRequestItemType } from '../../src/entities/executor/ExecutionRequest.js';
import type { ExecutionResponseItemType } from '../../src/entities/executor/ExecutionResponse.js';
import type {
  TransientNodeStateResponseStateType,
  TransientNodeStateSelectionType,
  TransientNodeStateType,
} from '../../src/entities/executor/TransientNodeState.js';
import type { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { GraphStateTransferCodec } from '../../src/graph/GraphStateTransferCodec.js';

type GraphBackedState = {
  readonly runIri: string;
  readonly graphDataset: {
    exportGraph(graph: ReturnType<typeof DagGraphTerms.namedNode>): IterableIterator<QuadType>;
  };
  snapshotTransientState(): TransientNodeStateType;
};

/** One batch entry: an item id paired with its graph-backed state. */
export type BatchEntry = {
  readonly id: string;
  readonly state: GraphBackedState;
};

export function stateSnapshot(state: GraphBackedState): TransientNodeStateType {
  return state.snapshotTransientState();
}

/** Combined N-Quads batch payload over every entry's selected state. */
export function inlineTransfer(states: readonly GraphBackedState[]) {
  return GraphStateTransferCodec.inlineTransient(states.map((state) => ({
    'runIri': state.runIri,
    'state': state.snapshotTransientState(),
  })));
}

/** Combined N-Quads batch payload keyed by the accompanying request items. */
export function inlineTransferEntries(entries: readonly BatchEntry[]) {
  return GraphStateTransferCodec.inlineTransient(entries.map((entry) => ({
    'runIri': entry.state.runIri,
    'state': entry.state.snapshotTransientState(),
  })));
}

export const FULL_RESPONSE_STATE: TransientNodeStateResponseStateType = {
  'defaultSelection': {
    'mode': 'full',
    'domainPaths': [],
    'metadataKeys': [],
  },
  'outputSelections': {},
};

export const FULL_INPUT_STATE: TransientNodeStateSelectionType = {
  'mode': 'full',
  'domainPaths': [],
  'metadataKeys': [],
};

/** Empty selected-state N-Quads batch payload for the given run IRIs. */
export function emptyInlineTransfer(runIris: readonly string[] = ['urn:dagonizer:run:test']) {
  return GraphStateTransferCodec.inlineTransient(runIris.map((runIri) => ({
      runIri,
      'state': {
        'domain': {},
        'graphDomain': {},
        'metadata': {},
        'errors': [],
        'warnings': [],
        'retries': {},
        'lifecycle': {
          'variant': 'pending',
          'startedAt': null,
          'finishedAt': null,
          'error': null,
          'reason': null,
          'correlationKey': null,
        },
      },
    })));
}

/** Build the request `items` array (`{ id, runIri }`) for a batch of entries. */
export function requestItems(entries: readonly BatchEntry[]): ExecutionRequestItemType[] {
  return entries.map((entry) => ({ 'id': entry.id, 'runIri': entry.state.runIri }));
}

/** Build item-local response entries for a batch. */
export function responseItems(entries: readonly (BatchEntry & { readonly terminalOutcome: string })[]): ExecutionResponseItemType[] {
  return entries.map((entry) => ({
    'id': entry.id,
    'runIri': entry.state.runIri,
    'terminalOutcome': entry.terminalOutcome,
    'errors': [],
    'intermediates': [],
  }));
}
