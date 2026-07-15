/**
 * ProducerFeedDAG: source-specific feed/unpack/normalize DAGs.
 *
 * One DAG per Cartographer producer. Each opens only its producer's source
 * stream, scatters those payloads through the ingest-source unpack/normalize
 * DAG, folds the validated event buckets, and emits canonicalEvents for the
 * top-level open gather.
 */

// #region producer-feed-dags
import type { CartographerState } from '../CartographerState.ts';
import { CARTOGRAPHER_IRIS } from '../cartographerIds.ts';
import { mergeEvents } from '../nodes/mergeEvents.ts';
import {
  feedPositionPing,
  feedFacilityScan,
  feedSensorReading,
  feedCustomsEvent,
  feedDeliveryConfirmation,
  producerFeedNodes,
} from '../nodes/producerFeeds.ts';

import type { DAGType, DispatcherBundleType, NodeInterface } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

type ProducerFeedSpecType = {
  readonly eventType: typeof CARTOGRAPHER_IRIS.intakeEventTypes[number];
  readonly feedNode: NodeInterface<CartographerState, 'ready' | 'empty'>;
};

const PRODUCER_FEED_SPECS: readonly ProducerFeedSpecType[] = [
  { 'eventType': 'position-ping',         'feedNode': feedPositionPing },
  { 'eventType': 'facility-scan',         'feedNode': feedFacilityScan },
  { 'eventType': 'sensor-reading',        'feedNode': feedSensorReading },
  { 'eventType': 'customs-event',         'feedNode': feedCustomsEvent },
  { 'eventType': 'delivery-confirmation', 'feedNode': feedDeliveryConfirmation },
];

class ProducerFeedDAGBuilder {
  private constructor() { /* static-only */ }

  static build(spec: ProducerFeedSpecType): DAGType {
    const dagIri = CARTOGRAPHER_IRIS.feedDagIri(spec.eventType);
    const placement = (id: string): string => CARTOGRAPHER_IRIS.placementIri(dagIri, id);

    return new DAGBuilder(dagIri, '1.0')
      .node(placement(`feed-${spec.eventType}`), spec.feedNode, {
        'ready': placement('unpack-normalize'),
        'empty': placement('done'),
      })
      .scatter(
        placement('unpack-normalize'),
        'sourceFeed',
        { 'dag': CARTOGRAPHER_IRIS.dag.ingestSource },
        {
          'all-success': placement('collect-normalized'),
          'partial':     placement('collect-normalized'),
          'all-error':   placement('collect-normalized'),
          'empty':       placement('done'),
        },
        {
          'itemKey': 'source',
          'execution': { 'mode': 'item', 'concurrency': 8 },
        },
      )
      .gather(placement('collect-normalized'), {
        [placement('unpack-normalize')]: {},
      }, { 'strategy': 'append', 'target': 'ingestBuckets', 'field': 'ingestedEvents' }, {
        'success': placement('merge-events'),
        'error':   placement('merge-events'),
        'empty':   placement('done'),
      })
      .node(placement('merge-events'), mergeEvents, {
        'merged': placement('done'),
      })
      .terminal(placement('done'), { outcome: 'completed' })
      .build();
  }
}

export const producerFeedDAGs: DAGType[] = PRODUCER_FEED_SPECS.map((spec) =>
  ProducerFeedDAGBuilder.build(spec),
);

export const producerFeedBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [
    ...producerFeedNodes,
    mergeEvents,
  ],
  'dags': producerFeedDAGs,
};
// #endregion producer-feed-dags
