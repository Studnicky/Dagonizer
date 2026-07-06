/**
 * enrichEta: batch-native ETA estimation node for the order lane.
 *
 * ETA is anchored on the journey's DISPATCH epoch (not the current scan), so it
 * is identical for every scan of a journey:
 *   eta = dispatchEpoch + (nominalTransit(origin→dest) + disruptionHours)
 * The SLA promise (promisedEpochMs) is the committed deadline. onTime ⇔ eta ≤
 * promised; delayHours MAY exceed nominal transit when a disruption struck.
 *
 * Implemented as a MonadicNode for batch-native processing: a single
 * execute call covers the whole batch, amortising carrier rate table
 * lookups across all items in one pass rather than dispatching N
 * separate per-item base-class iterations.
 *
 * Always routes 'eta-estimated'.
 */

import type { CartographerState } from '../CartographerState.ts';
import { EtaEstimator } from '../services.ts';

import type { NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, RoutedBatchType } from '@studnicky/dagonizer';

// #region enrich-eta-node
export class EnrichEtaNode extends MonadicNode<CartographerState, 'eta-estimated'> {
  readonly 'name' = 'enrich-eta';
  readonly 'outputs' = ['eta-estimated'] as const;

  override get outputSchema(): Record<'eta-estimated', SchemaObjectType> {
    return {
      'eta-estimated': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'eta-estimated', CartographerState>> {
    for (const item of batch) {
      const norm = item.state.normalized;
      item.state.deliveryEstimate = EtaEstimator.estimate(
        item.state.shippingQuote.distanceKm,
        norm.carrierId,
        norm.serviceTier,
        norm.dispatchEpochMs,
        norm.promisedEpochMs,
        norm.disruptionHours,
      );
    }
    return RoutedBatch.create('eta-estimated', batch);
  }
}
// #endregion enrich-eta-node

export const enrichEta = new EnrichEtaNode();
