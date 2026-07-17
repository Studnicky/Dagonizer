import type { QuadType } from '../../src/contracts/TripleStoreInterface.js';
import type { ExecutionRequestItemType } from '../../src/entities/executor/ExecutionRequest.js';
import type { ExecutionResponseItemType } from '../../src/entities/executor/ExecutionResponse.js';
import type {
  TransientNodeStateBatchType,
  TransientNodeStateResponseStateType,
  TransientNodeStateSelectionType,
  TransientNodeStateType,
} from '../../src/entities/executor/TransientNodeState.js';
import type { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';

type GraphBackedState = {
  readonly runIri: string;
  readonly graphDataset: {
    exportGraph(graph: ReturnType<typeof DagGraphTerms.namedNode>): IterableIterator<QuadType>;
  };
  snapshotTransientState(): TransientNodeStateBatchType['states'][number]['state'];
};

/** One batch entry: an item id paired with its graph-backed state. */
export type BatchEntry = {
  readonly id: string;
  readonly state: GraphBackedState;
};

export function stateSnapshot(state: GraphBackedState): TransientNodeStateType {
  return state.snapshotTransientState();
}

/** Combined transient-state batch payload over every entry's live state. */
export function inlineTransfer(states: readonly GraphBackedState[]): TransientNodeStateBatchType {
  return { 'states': states.map((state, index) => ({ 'id': state.runIri || `item-${index}`, 'state': state.snapshotTransientState() })) };
}

/** Combined transient-state batch payload keyed by explicit batch item ids. */
export function inlineTransferEntries(entries: readonly BatchEntry[]): TransientNodeStateBatchType {
  return { 'states': entries.map((entry) => ({ 'id': entry.id, 'state': entry.state.snapshotTransientState() })) };
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

/** Empty combined transient-state batch payload for the given run IRIs. */
export function emptyInlineTransfer(runIris: readonly string[] = ['urn:dagonizer:run:test']): TransientNodeStateBatchType {
  return {
    'states': runIris.map((runIri) => ({
      'id': runIri,
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
    })),
  };
}

/** Build the request `items` array (`{ id, runIri }`) for a batch of entries. */
export function requestItems(entries: readonly BatchEntry[]): ExecutionRequestItemType[] {
  return entries.map((entry) => ({ 'id': entry.id, 'runIri': entry.state.runIri }));
}

/** Build the response `items` array (`{ id, runIri, terminalOutcome }`) for a batch of entries. */
export function responseItems(entries: readonly (BatchEntry & { readonly terminalOutcome: string })[]): ExecutionResponseItemType[] {
  return entries.map((entry) => ({
    'id': entry.id,
    'runIri': entry.state.runIri,
    'terminalOutcome': entry.terminalOutcome,
  }));
}
