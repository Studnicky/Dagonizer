/**
 * customs-dwell: customs-lane only — compute the clearance dwell hours.
 *
 * Runs ONLY on the route-event-type 'customs' lane (customs-event). Other event types skip
 * it — the per-event-type skip showcase. Sets state.customsDwellHours from the
 * canonical body's customsStatus (held dwells longer than cleared).
 *
 * Routes 'dwelled'.
 */

import type { CartographerState } from '../CartographerState.ts';
import { Customs } from '../services.ts';

import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region customs-dwell-node
export class CustomsDwellNode extends MonadicNode<CartographerState, 'dwelled'> {
  readonly 'name' = 'customs-dwell';
  readonly 'outputs' = ['dwelled'] as const;

  override get outputSchema(): Record<'dwelled', SchemaObjectType> {
    return {
      'dwelled': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'dwelled', CartographerState>> {
    for (const item of batch) {
      const v = item.state.canonicalVariant;
      const customsStatus = v.eventType === 'customs-event' ? v.body.customsStatus : '';
      item.state.customsDwellHours = Customs.dwellHours(customsStatus);
    }
    return RoutedBatch.create('dwelled', batch);
  }
}
// #endregion customs-dwell-node

export const customsDwell = new CustomsDwellNode();
