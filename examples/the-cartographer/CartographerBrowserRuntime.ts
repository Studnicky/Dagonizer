import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

import type { CartographerState } from './CartographerState.ts';
import { CARTOGRAPHER_IRIS } from './cartographerIds.ts';
import { streamProducerFeedBundle } from './embedded-dags/ProducerFeedDAG.ts';
import './core/InsightsFoldGather.ts';
import './core/SourceIntakeGather.ts';

const CARTOGRAPHER_DAG_IRI = CARTOGRAPHER_IRIS.dag.cartographer;
const CARTOGRAPHER_DAG_WRITE_POINTS = ['NodeEdges', 'WatermarkCommit'] as const;
const CARTOGRAPHER_STREAM_SCATTER_WRITE_POINTS = [] as const;
const DEFAULT_RESERVOIR_CAPACITY = 1000;
const DEFAULT_WORKER_CONCURRENCY = 4;

type PlacementBindingsType = Record<string, { readonly resultField: 'sourceFeed' }>;

export class CartographerBrowserRuntime {
  private constructor() { /* static-only */ }

  static build(
    capacity: number = DEFAULT_RESERVOIR_CAPACITY,
    concurrency: number = DEFAULT_WORKER_CONCURRENCY,
  ): DAGType {
    return CartographerBrowserRuntime.#appendSourceIntakeGather(
      CartographerBrowserRuntime.#appendProducerStreamFeedEntrypoints(
        new DAGBuilder(CARTOGRAPHER_DAG_IRI, '1.0', {
          'writePoints': CARTOGRAPHER_DAG_WRITE_POINTS,
        }),
      ),
      CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'failed'),
    )
      .scatter(
        CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'process-stream'),
        'source-payload',
        { 'dag': CARTOGRAPHER_IRIS.dag.streamEvent },
        {
          'all-success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'),
          'partial':     CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'),
          'all-error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'),
          'empty':       CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize-insights'),
        },
        {
          'itemKey':     'source-payload',
          'container':   'cpu',
          'writePoints': CARTOGRAPHER_STREAM_SCATTER_WRITE_POINTS,
          'execution': { 'mode': 'reservoir', 'concurrency': concurrency, 'reservoir': { 'keyField': 'eventType', 'capacity': capacity } },
        },
      )
      .gather(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'), {
        [CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'process-stream')]: {},
      }, { 'strategy': 'insights-fold' }, {
        'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize-insights'),
        'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize-insights'),
        'empty':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize-insights'),
      })
      .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize-insights'), CARTOGRAPHER_IRIS.dag.insightsSummary, {
        'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'done'),
        'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'failed'),
      }, {
        'container': 'io',
      })
      .terminal(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'done'), { outcome: 'completed' })
      .terminal(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'failed'), { outcome: 'failed' })
      .entrypoints(CARTOGRAPHER_IRIS.feedEntrypoints(CARTOGRAPHER_DAG_IRI))
      .build();
  }

  static bundle(
    capacity: number = DEFAULT_RESERVOIR_CAPACITY,
    concurrency: number = DEFAULT_WORKER_CONCURRENCY,
  ): DispatcherBundleType<CartographerState> {
    return {
      'nodes': [...streamProducerFeedBundle.nodes],
      'dags': [
        ...streamProducerFeedBundle.dags,
        CartographerBrowserRuntime.#buildWorkerOwnedDagStub(CARTOGRAPHER_IRIS.dag.streamEvent),
        CartographerBrowserRuntime.#buildWorkerOwnedDagStub(CARTOGRAPHER_IRIS.dag.insightsSummary),
        CartographerBrowserRuntime.build(capacity, concurrency),
      ],
    };
  }

  static #appendProducerStreamFeedEntrypoints(builder: DAGBuilder): DAGBuilder {
    const intakeGatherIri = CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'intake-gather');
    for (const eventType of CARTOGRAPHER_IRIS.intakeEventTypes) {
      builder.embed<CartographerState, CartographerState>(
        CARTOGRAPHER_IRIS.feedPlacementIri(CARTOGRAPHER_DAG_IRI, eventType),
        CARTOGRAPHER_IRIS.streamFeedDagIri(eventType),
        {
          'success': intakeGatherIri,
          'error':   intakeGatherIri,
        },
      );
    }
    return builder;
  }

  static #appendSourceIntakeGather(builder: DAGBuilder, emptyTarget: string): DAGBuilder {
    const sourceBindings = Object.fromEntries(
      CARTOGRAPHER_IRIS.intakeEventTypes.map((eventType) => [
        CARTOGRAPHER_IRIS.feedPlacementIri(CARTOGRAPHER_DAG_IRI, eventType),
        { 'resultField': 'sourceFeed' },
      ]),
    ) as PlacementBindingsType;

    return builder.gather(
      CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'intake-gather'),
      sourceBindings,
      { 'strategy': 'source-intake' },
      {
        'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'process-stream'),
        'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'process-stream'),
        'empty':   emptyTarget,
      },
    );
  }

  static #buildWorkerOwnedDagStub(dagIri: string): DAGType {
    return new DAGBuilder(dagIri, '1.0')
      .terminal(CARTOGRAPHER_IRIS.placementIri(dagIri, 'done'), { outcome: 'completed' })
      .entrypoints({ 'main': CARTOGRAPHER_IRIS.placementIri(dagIri, 'done') })
      .build();
  }
}
