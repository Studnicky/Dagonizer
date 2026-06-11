/**
 * enrichEta: shipment-level ETA vs the SLA promise.
 *
 * ETA is anchored on the journey's DISPATCH epoch (not the current scan), so it
 * is identical for every scan of a journey:
 *   eta = dispatchEpoch + (nominalTransit(origin→dest) + disruptionHours)
 * The SLA promise (promisedEpochMs) is the committed deadline. onTime ⇔ eta ≤
 * promised; delayHours MAY exceed nominal transit when a disruption struck.
 *
 * Always routes 'eta-estimated'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { EtaEstimator } from '../services.ts';

import { NodeOutputBuilder, type NodeInterface } from '@noocodex/dagonizer';

// #region enrich-eta-node
export const enrichEta: NodeInterface<CartographerState, 'eta-estimated', CartographerServices> = {
  'name': 'enrich-eta',
  'outputs': ['eta-estimated'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const norm = state.normalized;
    state.deliveryEstimate = EtaEstimator.estimate(
      state.shippingQuote.distanceKm,
      norm.carrierId,
      norm.serviceTier,
      norm.dispatchEpochMs,
      norm.promisedEpochMs,
      norm.disruptionHours,
    );
    return NodeOutputBuilder.of('eta-estimated');
  },
};
// #endregion enrich-eta-node
