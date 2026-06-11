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
import type { CartographerServices } from '../CartographerServices.ts';
import type { CanonicalEvent } from '../entities/CanonicalEvent.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region merge-events-node
export class MergeEventsNode implements NodeInterface<CartographerState, 'merged', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'merge-events';
  readonly 'outputs' = ['merged'] as const;

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'merged'>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const merged: CanonicalEvent[] = [];
    for (const bucket of state.ingestBuckets) {
      for (const event of bucket) {
        merged.push(event);
      }
    }
    state.canonicalEvents = merged;
    return NodeOutputBuilder.of('merged');
  }
}
// #endregion merge-events-node
