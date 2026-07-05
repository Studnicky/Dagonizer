/**
 * 36-dag-stream-producer/dags: pure module — inner/outer state, nodes, producer, and DAG consts.
 * No side effects at module load.
 * Imported by examples/36-dag-stream-producer.ts (the executable entry point).
 */

import {
  DAG_CONTEXT,
  DagStreamProducer,
  Dagonizer,
  Batch,
  MonadicNode,
  NodeOutputBuilder,
  NodeStateBase,
  RoutedBatchBuilder,
} from '@studnicky/dagonizer';
import type { DAGType, NodeResultType, NodeStateInterface, SchemaObjectType } from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// Inner DAG: state + node
// ---------------------------------------------------------------------------

export class InnerState extends NodeStateBase {
  value: number = 0;
  label: string = '';
}

export class GenerateNode extends MonadicNode<InnerState, 'done'> {
  readonly name    = 'generate';
  readonly outputs = ['done'] as const;

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<InnerState>) {
    for (const item of batch) {
      item.state.label = 'item-' + String(item.state.value);
    }
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('done').output, batch);
  }
}

// ---------------------------------------------------------------------------
// Outer DAG: state + node
// ---------------------------------------------------------------------------

export class OuterState extends NodeStateBase {
  source: AsyncIterable<string> | null = null;
  item:   string                       = '';
  labels: string[]                     = [];
}

export class RecordNode extends MonadicNode<OuterState, 'done'> {
  readonly name    = 'record';
  readonly outputs = ['done'] as const;

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<OuterState>) {
    for (const item of batch) {
      item.state.item = item.state.getter.string('label-item', '');
    }
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('done').output, batch);
  }
}

// ---------------------------------------------------------------------------
// LabelStreamProducer
// ---------------------------------------------------------------------------

export class LabelStreamProducer extends DagStreamProducer<string> {
  readonly #values: number[];

  constructor(values: number[]) {
    super();
    this.#values = values;
  }

  static of(values: number[]): LabelStreamProducer {
    return new LabelStreamProducer(values);
  }

  async *#runAll(): AsyncGenerator<NodeResultType<NodeStateInterface>> {
    const dispatcher = new Dagonizer<InnerState>();
    dispatcher.registerNode(new GenerateNode());
    dispatcher.registerDAG(innerDag);
    for (const v of this.#values) {
      const state = new InnerState();
      state.value = v;
      for await (const stage of dispatcher.execute('inner-stream', state)) {
        yield stage;
      }
    }
  }

  protected override executions(): AsyncIterable<NodeResultType<NodeStateInterface>> {
    return this.#runAll();
  }

  protected override select(stage: NodeResultType<NodeStateInterface>): Iterable<string> {
    // Only extract from the 'generate' node stage (not the terminal node).
    if (stage.nodeName !== 'generate') {
      return [];
    }
    const s = stage.state;
    if (s instanceof InnerState && s.label !== '') {
      return [s.label];
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// Inner DAG: linear generate → end
// ---------------------------------------------------------------------------

export const innerDag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id':        'urn:noocodex:dag:inner-stream',
  '@type':      'DAG',
  'name':       'inner-stream',
  'version':    '1',
  'entrypoint': 'generate',
  'nodes': [
    {
      '@id':     'urn:noocodex:dag:inner-stream/node/generate',
      '@type':   'SingleNode',
      'name':    'generate',
      'node':    'generate',
      'outputs': { 'done': 'end' },
    },
    {
      '@id':     'urn:noocodex:dag:inner-stream/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    },
  ],
};

// ---------------------------------------------------------------------------
// Outer DAG: scatter over labels
// ---------------------------------------------------------------------------

export const outerDag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id':        'urn:noocodex:dag:label-stream',
  '@type':      'DAG',
  'name':       'label-stream',
  'version':    '1',
  'entrypoint': 'scatter-labels',
  'nodes': [
    {
      '@id':         'urn:noocodex:dag:label-stream/node/scatter-labels',
      '@type':       'ScatterNode',
      'name':        'scatter-labels',
      'body':        { 'node': 'record' },
      'source':      'source',
      'itemKey':     'label-item',
      'execution': { 'mode': 'item', 'concurrency': 2 },
      'gather': {
        'strategy': 'append',
        'target':   'labels',
      },
      'outputs': {
        'all-success': 'end',
        'partial':     'end',
        'all-error':   'end',
        'empty':       'end',
      },
    },
    {
      '@id':     'urn:noocodex:dag:label-stream/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    },
  ],
};
