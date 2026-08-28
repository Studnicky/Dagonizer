/**
 * ProducerFeedDAG: source-specific feed/unpack/normalize DAGs.
 *
 * One DAG per Cartographer producer. Each opens only its producer's source
 * stream and emits source payloads directly for the top-level source-intake /
 * stream-event flow. The canonical materialize-into-array path is retired.
 */

// #region producer-feed-dags
import type { CartographerState } from '../CartographerState.ts';
import { CARTOGRAPHER_IRIS } from '../cartographerIds.ts';
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
    const dagIri = CARTOGRAPHER_IRIS.streamFeedDagIri(spec.eventType);
    const placement = (id: string): string => CARTOGRAPHER_IRIS.placementIri(dagIri, id);

    return new DAGBuilder(dagIri, '1.0')
      .node(placement(`feed-${spec.eventType}`), spec.feedNode, {
        'ready': placement('done'),
        'empty': placement('done'),
      })
      .terminal(placement('done'), { outcome: 'completed' })
      .build();
  }
}

export const streamProducerFeedDAGs: DAGType[] = PRODUCER_FEED_SPECS.map((spec) =>
  ProducerFeedDAGBuilder.build(spec),
);

export const streamProducerFeedBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [...producerFeedNodes],
  'dags': streamProducerFeedDAGs,
};
// #endregion producer-feed-dags
