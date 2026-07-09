/**
 * producerFeeds: concrete source-specific feed nodes for Cartographer.
 *
 * Each producer has its own node IRI and placement inside a producer feed DAG.
 * The nodes only open that producer's lazy payload stream; their enclosing DAGs
 * own unpacking, decompression, format normalization, coercion, and validation.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { SourcePayload } from '../entities/SourcePayload.ts';
import { EventStreamSource } from '../services/EventStreamSource.ts';

import { Batch, MonadicNode } from '@studnicky/dagonizer';
import type { ItemType, RoutedBatchType, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

// #region producer-feed-nodes
class ProducerFeedNode extends MonadicNode<CartographerState, 'ready' | 'empty'> {
  readonly '@id': string;
  readonly 'name': string;
  readonly 'outputs' = ['ready', 'empty'] as const;

  readonly #eventType: SourcePayload['eventType'];

  constructor(eventType: SourcePayload['eventType']) {
    super();
    this.#eventType = eventType;
    this['@id'] = `urn:noocodec:node:cartographer-feed-${eventType}`;
    this.name = `feed-${eventType}`;
  }

  override get outputSchema(): Record<'ready' | 'empty', SchemaObjectType> {
    return {
      'ready': { 'type': 'object' },
      'empty': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'ready' | 'empty', CartographerState>> {
    const ready: ItemType<CartographerState>[] = [];
    const empty: ItemType<CartographerState>[] = [];

    for (const item of batch) {
      const totalCount = item.state.streamCount > 0 ? item.state.streamCount : undefined;
      item.state.sourceFeed = EventStreamSource.streamProducer(item.state.eventConfig, this.#eventType, totalCount);
      if (EventStreamSource.hasProducer(item.state.eventConfig, this.#eventType, totalCount)) {
        ready.push(item);
      } else {
        empty.push(item);
      }
    }

    const routed = new Map<'ready' | 'empty', Batch<CartographerState>>();
    if (ready.length > 0) routed.set('ready', Batch.from(ready));
    if (empty.length > 0) routed.set('empty', Batch.from(empty));
    return routed;
  }
}

export const feedPositionPing = new ProducerFeedNode('position-ping');
export const feedFacilityScan = new ProducerFeedNode('facility-scan');
export const feedSensorReading = new ProducerFeedNode('sensor-reading');
export const feedCustomsEvent = new ProducerFeedNode('customs-event');
export const feedDeliveryConfirmation = new ProducerFeedNode('delivery-confirmation');

export const producerFeedNodes = [
  feedPositionPing,
  feedFacilityScan,
  feedSensorReading,
  feedCustomsEvent,
  feedDeliveryConfirmation,
] as const;
// #endregion producer-feed-nodes
