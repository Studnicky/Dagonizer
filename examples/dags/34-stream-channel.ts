/**
 * 34-stream-channel/dags: pure module — state, worker node, producer class, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/34-stream-channel.ts (the executable entry point).
 */

import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import type { StreamProducerInterface, StreamSinkInterface } from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class ChannelState extends NodeStateBase {
  source:  AsyncIterable<number> | null = null;
  item:    number                       = 0;
  results: number[]                     = [];
}

// ---------------------------------------------------------------------------
// Worker node
// ---------------------------------------------------------------------------

export class ProcessNode extends MonadicNode<ChannelState, 'done'> {
  readonly name    = 'process';
  readonly '@id'   = 'urn:noocodec:node:process';
  readonly outputs = ['done'] as const;

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ChannelState>) {
    for (const item of batch) {
      const raw  = item.state.getter.number('stream-item', 0);
      item.state.item = raw * 2;
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

// ---------------------------------------------------------------------------
// Producer
// ---------------------------------------------------------------------------

export class NumberProducer implements StreamProducerInterface<number> {
  readonly #count: number;

  constructor(count: number) {
    this.#count = count;
  }

  static of(count: number): NumberProducer {
    return new NumberProducer(count);
  }

  async produce(sink: StreamSinkInterface<number>): Promise<void> {
    for (let i = 0; i < this.#count; i++) {
      await sink.push(i);
    }
  }
}

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export const dag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:stream-channel',
  '@type':      'DAG',
  'name':       'stream-channel',
  'version':    '1',
  'entrypoints': { 'main': 'urn:noocodec:dag:stream-channel/node/scatter-items' },
  'nodes': [
    {
      '@id': 'urn:noocodec:dag:stream-channel/node/scatter-items',
      '@type':       'ScatterNode',
      'name':        'scatter-items',
      'body':        { 'node': 'urn:noocodec:node:process' },
      'source':      'source',
      'itemKey':     'stream-item',
      'execution': { 'mode': 'item', 'concurrency': 3 },
      'outputs': {
        'all-success': 'urn:noocodec:dag:stream-channel/node/collect-stream-items',
        'partial': 'urn:noocodec:dag:stream-channel/node/collect-stream-items',
        'all-error': 'urn:noocodec:dag:stream-channel/node/collect-stream-items',
        'empty': 'urn:noocodec:dag:stream-channel/node/end',
      },
    },
    {
      '@id': 'urn:noocodec:dag:stream-channel/node/collect-stream-items',
      '@type': 'GatherNode',
      'name': 'collect-stream-items',
      sources: { 'urn:noocodec:dag:stream-channel/node/scatter-items': {} },
      'gather': {
        'strategy': 'map',
        'mapping':  { 'item': 'results' },
      },
      'outputs': { 'success': 'urn:noocodec:dag:stream-channel/node/end', 'error': 'urn:noocodec:dag:stream-channel/node/end', 'empty': 'urn:noocodec:dag:stream-channel/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:stream-channel/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    },
  ],
};
