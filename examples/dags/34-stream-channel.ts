/**
 * 34-stream-channel/dags: pure module — state, worker node, producer class, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/34-stream-channel.ts (the executable entry point).
 */

import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutputBuilder,
  NodeStateBase,
  RoutedBatchBuilder,
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
  readonly outputs = ['done'] as const;

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ChannelState>) {
    for (const item of batch) {
      const raw  = item.state.getter.number('stream-item', 0);
      item.state.item = raw * 2;
    }
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('done').output, batch);
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
  '@id':        'urn:noocodex:dag:stream-channel',
  '@type':      'DAG',
  'name':       'stream-channel',
  'version':    '1',
  'entrypoint': 'scatter-items',
  'nodes': [
    {
      '@id':         'urn:noocodex:dag:stream-channel/node/scatter-items',
      '@type':       'ScatterNode',
      'name':        'scatter-items',
      'body':        { 'node': 'process' },
      'source':      'source',
      'itemKey':     'stream-item',
      'execution': { 'mode': 'item', 'concurrency': 3 },
      'gather': {
        'strategy': 'map',
        'mapping':  { 'item': 'results' },
      },
      'outputs': {
        'all-success': 'end',
        'partial':     'end',
        'all-error':   'end',
        'empty':       'end',
      },
    },
    {
      '@id':     'urn:noocodex:dag:stream-channel/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    },
  ],
};
