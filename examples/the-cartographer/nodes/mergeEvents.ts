/**
 * mergeEvents: flattens the ingestion fan-in buckets into one canonical model.
 *
 * The ingestion scatter's `append` gather appends each source clone's
 * `ingestedEvents` array as a single element of state.ingestBuckets (one bucket
 * per source). This node concatenates the buckets in order into the unified
 * state.canonicalEvents collection the streaming enrichment scatter reads.
 *
 * This is the seam where the heterogeneous-format sources become one model.
 *
 * Routes 'merged'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CanonicalEventVariant } from '../entities/CanonicalEvent.ts';

import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region merge-events-node
export class MergeEventsNode extends MonadicNode<CartographerState, 'merged'> {
  readonly '@id' = 'urn:noocodec:node:merge-events';
  readonly 'name' = 'merge-events';
  readonly 'outputs' = ['merged'] as const;

  override get outputSchema(): Record<'merged', SchemaObjectType> {
    return {
      'merged': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'merged', CartographerState>> {
    for (const item of batch) {
      const merged: CanonicalEventVariant[] = [];
      for (const bucket of item.state.ingestBuckets) {
        for (const event of bucket) {
          merged.push(event);
        }
      }
      item.state.canonicalEvents = merged;
    }
    return RoutedBatch.create('merged', batch);
  }
}
// #endregion merge-events-node

export const mergeEvents = new MergeEventsNode();
