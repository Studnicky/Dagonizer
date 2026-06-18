/**
 * canonicalizeFacility: facility-scan ONLY. Fills the facility slots of
 * state.normalized: weight→grams (Units.toGrams), facilityId, lineItems, and
 * re-derives serviceTier/sizeTier from the real weight. No-op-free: it only
 * runs in the facility sub-DAG.
 *
 * Routes 'done'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { EventClassifier, Units } from '../services.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@studnicky/dagonizer';

// #region canonicalize-facility-node
export class CanonicalizeFacilityNode extends ScalarNode<CartographerState, 'done', CartographerServices> {
  readonly 'name' = 'canonicalize-facility';
  readonly 'outputs' = ['done'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'done'>> {
    if (state.canonicalVariant.eventType !== 'facility-scan') {
      return NodeOutputBuilder.of('done');
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

    return NodeOutputBuilder.of('done');
  }
}

export const canonicalizeFacility = new CanonicalizeFacilityNode();
// #endregion canonicalize-facility-node
