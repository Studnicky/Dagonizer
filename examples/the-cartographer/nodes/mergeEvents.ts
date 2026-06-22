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

import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

// #region merge-events-node
export class MergeEventsNode extends ScalarNode<CartographerState, 'merged'> {
  readonly 'name' = 'merge-events';
  readonly 'outputs' = ['merged'] as const;

  override get outputSchema(): Record<'merged', SchemaObjectType> {
    return {
      'merged': { 'type': 'object' },
    };
  }

  protected override async executeOne(state: CartographerState, _context: NodeContextType): Promise<NodeOutputType<'merged'>> {
    const merged: CanonicalEventVariant[] = [];
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

export const mergeEvents = new MergeEventsNode();
