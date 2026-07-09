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
  readonly '@id' = 'urn:noocodec:node:collect-candidate';
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
  '@id': 'urn:noocodec:dag:archivist-streaming:fan-in-candidates',
  '@type':      'DAG',
  'name':       'fan-in-candidates',
  'version':    '1',
  'entrypoints': { 'main': 'urn:noocodec:dag:archivist-streaming:fan-in-candidates/node/scatter-candidates' },
  'nodes': [
    {
      '@id': 'urn:noocodec:dag:archivist-streaming:fan-in-candidates/node/scatter-candidates',
      '@type':       'ScatterNode',
      'name':        'scatter-candidates',
      'body':        { 'node': 'urn:noocodec:node:collect-candidate' },
      'source':      'source',
      'itemKey':     'candidate-item',
      'execution': { 'mode': 'item', 'concurrency': 2 },
      'outputs': {
        'all-success': 'urn:noocodec:dag:archivist-streaming:fan-in-candidates/node/collect-candidates',
        'partial': 'urn:noocodec:dag:archivist-streaming:fan-in-candidates/node/collect-candidates',
        'all-error': 'urn:noocodec:dag:archivist-streaming:fan-in-candidates/node/collect-candidates',
        'empty':       'urn:noocodec:dag:archivist-streaming:fan-in-candidates/node/end',
      },
    },
    {
      '@id': 'urn:noocodec:dag:archivist-streaming:fan-in-candidates/node/collect-candidates',
      '@type': 'GatherNode',
      'name': 'collect-candidates',
      sources: { 'urn:noocodec:dag:archivist-streaming:fan-in-candidates/node/scatter-candidates': {} },
      'gather': { 'strategy': 'append', 'target': 'collectedCandidates' },
      'outputs': { 'success': 'urn:noocodec:dag:archivist-streaming:fan-in-candidates/node/end', 'error': 'urn:noocodec:dag:archivist-streaming:fan-in-candidates/node/end', 'empty': 'urn:noocodec:dag:archivist-streaming:fan-in-candidates/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:archivist-streaming:fan-in-candidates/node/end',
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
  '@id': 'urn:noocodec:dag:archivist-streaming:stream-producer-candidates',
  '@type':      'DAG',
  'name':       'stream-producer-candidates',
  'version':    '1',
  'entrypoints': { 'main': 'urn:noocodec:dag:archivist-streaming:stream-producer-candidates/node/scatter-candidates' },
  'nodes': [
    {
      '@id': 'urn:noocodec:dag:archivist-streaming:stream-producer-candidates/node/scatter-candidates',
      '@type':       'ScatterNode',
      'name':        'scatter-candidates',
      'body':        { 'node': 'urn:noocodec:node:collect-candidate' },
      'source':      'source',
      'itemKey':     'candidate-item',
      'execution': { 'mode': 'item', 'concurrency': 2 },
      'outputs': {
        'all-success': 'urn:noocodec:dag:archivist-streaming:stream-producer-candidates/node/collect-candidates',
        'partial': 'urn:noocodec:dag:archivist-streaming:stream-producer-candidates/node/collect-candidates',
        'all-error': 'urn:noocodec:dag:archivist-streaming:stream-producer-candidates/node/collect-candidates',
        'empty':       'urn:noocodec:dag:archivist-streaming:stream-producer-candidates/node/stream-end',
      },
    },
    {
      '@id': 'urn:noocodec:dag:archivist-streaming:stream-producer-candidates/node/collect-candidates',
      '@type': 'GatherNode',
      'name': 'collect-candidates',
      sources: { 'urn:noocodec:dag:archivist-streaming:stream-producer-candidates/node/scatter-candidates': {} },
      'gather': { 'strategy': 'append', 'target': 'collectedCandidates' },
      'outputs': { 'success': 'urn:noocodec:dag:archivist-streaming:stream-producer-candidates/node/stream-end', 'error': 'urn:noocodec:dag:archivist-streaming:stream-producer-candidates/node/stream-end', 'empty': 'urn:noocodec:dag:archivist-streaming:stream-producer-candidates/node/stream-end' },
    },
    {
      '@id': 'urn:noocodec:dag:archivist-streaming:stream-producer-candidates/node/stream-end',
      '@type':   'TerminalNode',
      'name':    'stream-end',
      'outcome': 'completed',
    },
  ],
};
