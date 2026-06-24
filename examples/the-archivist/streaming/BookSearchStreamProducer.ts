/**
 * BookSearchStreamProducer: DagStreamProducer subclass that bridges batches of
 * CandidateType items from an inner discovery DAG into an outer scatter source.
 *
 * Each batch is one inner DAG run. The inner state carries `pendingBatch` (input)
 * and `candidates` (output) so a single dispatcher + node instance can serve all
 * batches without re-registration. select() extracts candidates from the
 * 'discover-candidates' node stage only.
 *
 * No network, no LLM, no embedder. Used by runArchivistStreaming.ts Demo 2.
 */

import {
  DAG_CONTEXT,
  DagStreamProducer,
  Dagonizer,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { DAGType, NodeResultType, NodeStateInterface, SchemaObjectType } from '@studnicky/dagonizer';
import type { CandidateType } from '../entities/Book.ts';

// ---------------------------------------------------------------------------
// Inner state: parameterised per batch via pendingBatch
// ---------------------------------------------------------------------------

class CandidateDiscoveryState extends NodeStateBase {
  pendingBatch: CandidateType[] = [];
  candidates:   CandidateType[] = [];
}

// ---------------------------------------------------------------------------
// Inner node: copies pendingBatch → candidates
// ---------------------------------------------------------------------------

class DiscoverCandidatesNode extends ScalarNode<CandidateDiscoveryState, 'done'> {
  readonly name    = 'discover-candidates';
  readonly outputs = ['done'] as const;

  static of(): DiscoverCandidatesNode {
    return new DiscoverCandidatesNode();
  }

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  protected override async executeOne(state: CandidateDiscoveryState) {
    state.candidates = [...state.pendingBatch];
    return NodeOutputBuilder.of('done');
  }
}

// ---------------------------------------------------------------------------
// Inner DAG: discover-candidates → found (terminal)
// ---------------------------------------------------------------------------

const CANDIDATE_DISCOVERY_DAG: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id':        'urn:noocodex:dag:archivist-streaming:candidate-discovery',
  '@type':      'DAG',
  'name':       'candidate-discovery',
  'version':    '1',
  'entrypoint': 'discover-candidates',
  'nodes': [
    {
      '@id':     'urn:noocodex:dag:archivist-streaming:candidate-discovery/node/discover-candidates',
      '@type':   'SingleNode',
      'name':    'discover-candidates',
      'node':    'discover-candidates',
      'outputs': { 'done': 'found' },
    },
    {
      '@id':     'urn:noocodex:dag:archivist-streaming:candidate-discovery/node/found',
      '@type':   'TerminalNode',
      'name':    'found',
      'outcome': 'completed',
    },
  ],
};

// ---------------------------------------------------------------------------
// BookSearchStreamProducer
// ---------------------------------------------------------------------------

export class BookSearchStreamProducer extends DagStreamProducer<CandidateType> {
  readonly #batches: CandidateType[][];

  constructor(batches: CandidateType[][]) {
    super();
    this.#batches = batches;
  }

  static of(batches: CandidateType[][]): BookSearchStreamProducer {
    return new BookSearchStreamProducer(batches);
  }

  async *#runAll(): AsyncGenerator<NodeResultType<NodeStateInterface>> {
    const dispatcher = new Dagonizer<CandidateDiscoveryState>();
    dispatcher.registerNode(DiscoverCandidatesNode.of());
    dispatcher.registerDAG(CANDIDATE_DISCOVERY_DAG);
    for (const batch of this.#batches) {
      const state = new CandidateDiscoveryState();
      state.pendingBatch = batch;
      for await (const stage of dispatcher.execute('candidate-discovery', state)) {
        yield stage;
      }
    }
  }

  protected override executions(): AsyncIterable<NodeResultType<NodeStateInterface>> {
    return this.#runAll();
  }

  protected override select(stage: NodeResultType<NodeStateInterface>): Iterable<CandidateType> {
    if (stage.nodeName !== 'discover-candidates') {
      return [];
    }
    const s = stage.state;
    if (s instanceof CandidateDiscoveryState && s.candidates.length > 0) {
      return s.candidates;
    }
    return [];
  }
}
