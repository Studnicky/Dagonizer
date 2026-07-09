/**
 * 35-stream-fanin-resume/dags: pure module — state, worker node, producers, and DAG consts.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/35-stream-fanin-resume.ts (the executable entry point).
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
import type { NodeContextType } from '@studnicky/dagonizer';
import type {
  ResumableStreamProducerInterface,
  StreamProducerInterface,
  StreamSinkInterface,
} from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class FanInState extends NodeStateBase {
  source:  AsyncIterable<number> | null = null;
  item:    number                       = 0;
  results: number[]                     = [];

  protected override snapshotData(): JsonObjectType {
    // source is a live channel — not JSON-serialisable; callers supply a
    // re-positioned channel on resume via StreamChannel.resumable.
    return { 'results': [...this.results] };
  }

  protected override restoreData(snap: JsonObjectType): void {
    const v = snap['results'];
    if (Array.isArray(v)) {
      this.results = v.filter((x): x is number => typeof x === 'number');
    }
  }
}

// ---------------------------------------------------------------------------
// AbortCoordinator
// ---------------------------------------------------------------------------

/**
 * AbortCoordinator: counts scatter worker completions and fires an
 * AbortController when the threshold is reached.
 *
 * Passed to AbortingCollectNode via constructor injection so the node class
 * itself contains no abort-specific logic beyond delegating to the coordinator.
 */
export class AbortCoordinator {
  readonly #controller: AbortController;
  readonly #threshold: number;
  #count: number;

  private constructor(controller: AbortController, threshold: number) {
    this.#controller = controller;
    this.#threshold = threshold;
    this.#count = 0;
  }

  static of(controller: AbortController, threshold: number): AbortCoordinator {
    return new AbortCoordinator(controller, threshold);
  }

  tick(): void {
    if (++this.#count === this.#threshold) {
      this.#controller.abort(new Error('demo-abort'));
    }
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }
}

// ---------------------------------------------------------------------------
// Worker nodes
// ---------------------------------------------------------------------------

export class CollectNode extends MonadicNode<FanInState, 'done'> {
  readonly name    = 'collect';
  readonly '@id'   = 'urn:noocodec:node:collect';
  readonly outputs = ['done'] as const;

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<FanInState>) {
    for (const item of batch) {
      item.state.item = item.state.getter.number('fan-item', 0);
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

/**
 * AbortingCollectNode: like CollectNode but delays 2ms (so the scatter pull
 * loop can observe abort between dispatches) and calls coordinator.tick() on
 * each completion. The coordinator fires the run-level abort when the configured
 * threshold is reached.
 */
export class AbortingCollectNode extends MonadicNode<FanInState, 'done'> {
  readonly name    = 'collect';
  readonly '@id'   = 'urn:noocodec:node:collect';
  readonly outputs = ['done'] as const;
  readonly #coordinator: AbortCoordinator;

  constructor(coordinator: AbortCoordinator) {
    super();
    this.#coordinator = coordinator;
  }

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<FanInState>,
    context: NodeContextType,
  ) {
    for (const item of batch) {
      await new Promise<void>((resolve, reject) => {
        const handle = setTimeout(resolve, 2);
        context.signal.addEventListener('abort', () => {
          clearTimeout(handle);
          reject(context.signal.reason);
        }, { 'once': true });
      });
      item.state.item = item.state.getter.number('fan-item', 0);
      this.#coordinator.tick();
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

// ---------------------------------------------------------------------------
// RangeProducer
// ---------------------------------------------------------------------------

export class RangeProducer implements StreamProducerInterface<number> {
  readonly #start: number;
  readonly #end:   number;

  constructor(start: number, end: number) {
    this.#start = start;
    this.#end   = end;
  }

  static range(start: number, end: number): RangeProducer {
    return new RangeProducer(start, end);
  }

  async produce(sink: StreamSinkInterface<number>): Promise<void> {
    for (let i = this.#start; i < this.#end; i++) {
      await sink.push(i);
    }
  }
}

// ---------------------------------------------------------------------------
// DeterministicProducer
// ---------------------------------------------------------------------------

export class DeterministicProducer implements ResumableStreamProducerInterface<number> {
  readonly #total: number;

  constructor(total: number) {
    this.#total = total;
  }

  static of(total: number): DeterministicProducer {
    return new DeterministicProducer(total);
  }

  async produce(sink: StreamSinkInterface<number>, resumeAfter: number): Promise<void> {
    for (let i = resumeAfter; i < this.#total; i++) {
      await sink.push(i);
    }
  }
}

// ---------------------------------------------------------------------------
// fanInDag
// ---------------------------------------------------------------------------

export const fanInDag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:stream-fanin',
  '@type':      'DAG',
  'name':       'stream-fanin',
  'version':    '1',
  'entrypoints': { 'main': 'urn:noocodec:dag:stream-fanin/node/scatter-fanin' },
  'nodes': [
    {
      '@id': 'urn:noocodec:dag:stream-fanin/node/scatter-fanin',
      '@type':       'ScatterNode',
      'name':        'scatter-fanin',
      'body':        { 'node': 'urn:noocodec:node:collect' },
      'source':      'source',
      'itemKey':     'fan-item',
      'execution': { 'mode': 'item', 'concurrency': 2 },
      'outputs': {
        'all-success': 'urn:noocodec:dag:stream-fanin/node/collect-results',
        'partial': 'urn:noocodec:dag:stream-fanin/node/collect-results',
        'all-error': 'urn:noocodec:dag:stream-fanin/node/collect-results',
        'empty':       'urn:noocodec:dag:stream-fanin/node/end',
      },
    },
    {
      '@id': 'urn:noocodec:dag:stream-fanin/node/collect-results',
      '@type': 'GatherNode',
      'name': 'collect-results',
      sources: { 'urn:noocodec:dag:stream-fanin/node/scatter-fanin': {} },
      'gather': { 'strategy': 'append', 'target': 'results' },
      'outputs': { 'success': 'urn:noocodec:dag:stream-fanin/node/end', 'error': 'urn:noocodec:dag:stream-fanin/node/end', 'empty': 'urn:noocodec:dag:stream-fanin/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:stream-fanin/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    },
  ],
};

// ---------------------------------------------------------------------------
// resumeDag
// ---------------------------------------------------------------------------

export const resumeDag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:stream-resume',
  '@type':      'DAG',
  'name':       'resume-stream',
  'version':    '1',
  'entrypoints': { 'main': 'urn:noocodec:dag:stream-resume/node/resume-stream' },
  'nodes': [
    {
      '@id': 'urn:noocodec:dag:stream-resume/node/resume-stream',
      '@type':       'ScatterNode',
      'name':        'resume-stream',
      'body':        { 'node': 'urn:noocodec:node:collect' },
      'source':      'source',
      'itemKey':     'fan-item',
      'execution': { 'mode': 'item', 'concurrency': 2 },
      'outputs': {
        'all-success': 'urn:noocodec:dag:stream-resume/node/collect-results',
        'partial': 'urn:noocodec:dag:stream-resume/node/collect-results',
        'all-error': 'urn:noocodec:dag:stream-resume/node/collect-results',
        'empty':       'urn:noocodec:dag:stream-resume/node/end',
      },
    },
    {
      '@id': 'urn:noocodec:dag:stream-resume/node/collect-results',
      '@type': 'GatherNode',
      'name': 'collect-results',
      sources: { 'urn:noocodec:dag:stream-resume/node/resume-stream': {} },
      'gather': { 'strategy': 'append', 'target': 'results' },
      'outputs': { 'success': 'urn:noocodec:dag:stream-resume/node/end', 'error': 'urn:noocodec:dag:stream-resume/node/end', 'empty': 'urn:noocodec:dag:stream-resume/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:stream-resume/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    },
  ],
};
