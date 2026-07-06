/**
 * canonicalizeFacility: facility-scan ONLY. Fills the facility slots of
 * state.normalized: weight→grams (Units.toGrams), facilityId, lineItems, and
 * re-derives serviceTier/sizeTier from the real weight. No-op-free: it only
 * runs in the facility sub-DAG.
 *
 * Routes 'done'.
 */

import type { CartographerState } from '../CartographerState.ts';
import { EventClassifier, Units } from '../services.ts';

import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region canonicalize-facility-node
export class CanonicalizeFacilityNode extends MonadicNode<CartographerState, 'done'> {
  readonly 'name' = 'canonicalize-facility';
  readonly 'outputs' = ['done'] as const;

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return {
      'done': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'done', CartographerState>> {
    for (const item of batch) {
      const state = item.state;
      if (state.canonicalVariant.eventType !== 'facility-scan') {
        continue;
      }

      const raw = state.raw;
      const weightGrams = Units.toGrams(raw.weight, raw.weightUnit);
      const serviceTier = EventClassifier.serviceTier(state.normalized.carrierId, weightGrams);
      const sizeTier    = EventClassifier.sizeTier(weightGrams);

      state.normalized = {
        ...state.normalized,
        'weightGrams': weightGrams,
        'facilityId':  raw.facilityId,
        'lineItems':   raw.lineItems.map((li) => ({ ...li })),
        'serviceTier': serviceTier,
        'sizeTier':    sizeTier,
      };
    }

    return RoutedBatch.create('done', batch);
  }
}

export const canonicalizeFacility = new CanonicalizeFacilityNode();
// #endregion canonicalize-facility-node
