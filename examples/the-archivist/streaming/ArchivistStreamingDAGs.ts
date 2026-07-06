/**
 * ArchivistStreamingDAGs: state classes, nodes, and DAG definitions for the
 * archivist streaming demos. Pure module — no side effects at module load.
 *
 * Consumed by runArchivistStreaming.ts for both Demo 1 (StreamChannel.fanIn)
 * and Demo 2 (DagStreamProducer / BookSearchStreamProducer).
 */

import {
  DAG_CONTEXT,
  Batch,
  MonadicNode,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CandidateType } from '../entities/Book.ts';

// ---------------------------------------------------------------------------
// Outer state: used by both demo DAGs
// ---------------------------------------------------------------------------

export class StreamingDemoState extends NodeStateBase {
  source: AsyncIterable<CandidateType> | null = null;
  item: CandidateType | null = null;
  collectedCandidates: CandidateType[] = [];
}

// ---------------------------------------------------------------------------
// Body node: runs once per scatter clone; gather handles accumulation via append
// ---------------------------------------------------------------------------

export class CollectCandidateNode extends MonadicNode<StreamingDemoState, 'done'> {
  readonly name = 'collect-candidate';
  readonly outputs = ['done'] as const;

  static of(): CollectCandidateNode {
    return new CollectCandidateNode();
  }

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<StreamingDemoState>, _context: NodeContextType) {
    return RoutedBatch.create('done', batch);
  }
}

// ---------------------------------------------------------------------------
// Demo 1: fan-in — scatter over StreamChannel.fanIn source
// ---------------------------------------------------------------------------

export const fanInCandidatesDag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id':        'urn:noocodex:dag:archivist-streaming:fan-in-candidates',
  '@type':      'DAG',
  'name':       'fan-in-candidates',
  'version':    '1',
  'entrypoint': 'scatter-candidates',
  'nodes': [
    {
      '@id':         'urn:noocodex:dag:archivist-streaming:fan-in-candidates/node/scatter-candidates',
      '@type':       'ScatterNode',
      'name':        'scatter-candidates',
      'body':        { 'node': 'collect-candidate' },
      'source':      'source',
      'itemKey':     'candidate-item',
      'execution': { 'mode': 'item', 'concurrency': 2 },
      'gather': {
        'strategy': 'append',
        'target':   'collectedCandidates',
      },
      'outputs': {
        'all-success': 'end',
        'partial':     'end',
        'all-error':   'end',
        'empty':       'end',
      },
    },
    {
      '@id':     'urn:noocodex:dag:archivist-streaming:fan-in-candidates/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    },
  ],
};

// ---------------------------------------------------------------------------
// Demo 2: DagStreamProducer — scatter over BookSearchStreamProducer source
// ---------------------------------------------------------------------------

export const streamProducerCandidatesDag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id':        'urn:noocodex:dag:archivist-streaming:stream-producer-candidates',
  '@type':      'DAG',
  'name':       'stream-producer-candidates',
  'version':    '1',
  'entrypoint': 'scatter-candidates',
  'nodes': [
    {
      '@id':         'urn:noocodex:dag:archivist-streaming:stream-producer-candidates/node/scatter-candidates',
      '@type':       'ScatterNode',
      'name':        'scatter-candidates',
      'body':        { 'node': 'collect-candidate' },
      'source':      'source',
      'itemKey':     'candidate-item',
      'execution': { 'mode': 'item', 'concurrency': 2 },
      'gather': {
        'strategy': 'append',
        'target':   'collectedCandidates',
      },
      'outputs': {
        'all-success': 'stream-end',
        'partial':     'stream-end',
        'all-error':   'stream-end',
        'empty':       'stream-end',
      },
    },
    {
      '@id':     'urn:noocodex:dag:archivist-streaming:stream-producer-candidates/node/stream-end',
      '@type':   'TerminalNode',
      'name':    'stream-end',
      'outcome': 'completed',
    },
  ],
};
