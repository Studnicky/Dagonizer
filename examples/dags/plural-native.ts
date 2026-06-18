/**
 * plural-native/dags: pure module — batch-native node taxonomy and reservoir DAG.
 * No side effects, no dispatcher execution.
 * Imported by examples/plural-native.ts (the executable entry point).
 */

// #region execute-contract
import { MonadicNode, RoutedBatchBuilder, Batch } from '@studnicky/dagonizer';
import type { NodeContextInterface, NodeStateInterface, RoutedBatch } from '@studnicky/dagonizer';

// The execute signature: consume Batch<TState>, return RoutedBatch<TOutput, TState>.
// Items are partitioned across output ports — routing IS partitioning.
export class EchoNode extends MonadicNode<NodeStateInterface, 'out'> {
  readonly name    = 'echo';
  readonly outputs = ['out'] as const;

  async execute(batch: Batch<NodeStateInterface>, _ctx: NodeContextInterface): Promise<RoutedBatch<'out', NodeStateInterface>> {
    return RoutedBatchBuilder.of('out', batch);
  }
}
// #endregion execute-contract

// #region node-taxonomy
import { NodeOutputBuilder, NodeStateBase, ScalarNode } from '@studnicky/dagonizer';

// EventState: domain state shared by both node variants below.
export class EventState extends NodeStateBase {
  coords: string | null = null;
  region                = '';
}

// Stub geo-lookup cache — in production this would be an injected service.
const geoCache = {
  lookup(coords: string): string {
    return coords.length > 0 ? 'us-east' : 'unknown';
  },
};

// per-item (the common case): ScalarNode processes one EventState at a time.
export class GeoNode extends ScalarNode<EventState, 'has-geo' | 'needs-geo'> {
  readonly name    = 'geo';
  readonly outputs = ['has-geo', 'needs-geo'] as const;

  protected override async executeOne(state: EventState) {
    if (state.coords === null) {
      return NodeOutputBuilder.of('needs-geo');
    }
    return NodeOutputBuilder.of('has-geo');
  }
}

// batch-native: MonadicNode processes the whole batch in one execute call,
// allowing a single shared-cache lookup across all items simultaneously.
export class EnrichNode extends MonadicNode<EventState, 'enriched'> {
  readonly name    = 'enrich';
  readonly outputs = ['enriched'] as const;

  async execute(batch: Batch<EventState>, _ctx: NodeContextInterface): Promise<RoutedBatch<'enriched', EventState>> {
    for (const item of batch) {
      const state = item.state;
      if (state.coords !== null) {
        state.region = geoCache.lookup(state.coords);
      }
    }
    return RoutedBatchBuilder.of('enriched', batch);
  }
}
// #endregion node-taxonomy

// #region reservoir-scatter
import { DAG_CONTEXT } from '@studnicky/dagonizer';
import type { DAG } from '@studnicky/dagonizer';

// ScoreState holds the items array fed to the scatter and the collected results.
export class ScoreState extends NodeStateBase {
  items:          unknown[] = [];
  topCandidates:  unknown[] = [];
}

export class ScoreNode extends ScalarNode<ScoreState, 'scored'> {
  readonly name    = 'score';
  readonly outputs = ['scored'] as const;

  protected override async executeOne(_state: ScoreState) {
    return NodeOutputBuilder.of('scored');
  }
}

// DAG with a reservoir-configured scatter: items accumulate per `route` key
// before ScoreNode runs. Up to 10 items per key; partial batches flush after
// 500 ms of idle time.
export const reservoirDag: DAG = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:plural-native-demo',
  '@type':     'DAG',
  name:        'plural-native-demo',
  version:     '1',
  entrypoint:  'batch-score',
  nodes: [
    {
      '@id':       'urn:noocodex:dag:plural-native-demo/node/batch-score',
      '@type':     'ScatterNode',
      name:        'batch-score',
      body:        { node: 'score' },
      source:      'items',
      itemKey:     'item',
      concurrency: 4,
      reservoir: {
        keyField: 'route',   // accessor path on each source item → the partition key
        capacity: 10,        // release a batch when 10 items accumulate per key
        idleMs:   500,       // flush partial batches after 500 ms idle
      },
      gather: {
        strategy: 'append',
        target:   'topCandidates',
      },
      outputs: {
        'all-success': 'end',
        partial:       'end',
        'all-error':   'end',
        empty:         'end',
      },
    },
    {
      '@id':   'urn:noocodex:dag:plural-native-demo/node/end',
      '@type': 'TerminalNode',
      name:    'end',
      outcome: 'completed',
    },
  ],
};
// #endregion reservoir-scatter
