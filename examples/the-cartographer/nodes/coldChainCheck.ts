/**
 * cold-chain-check: sensor-lane only — evaluate cold-chain telemetry for a breach.
 *
 * Runs ONLY on the route-event-type 'sensor' lane (sensor-reading events carry temp /
 * shock telemetry). Other event types skip this node entirely — the per-event-type skip
 * showcase. Sets state.coldChainBreach from the canonical body's tempC / shockG.
 *
 * Routes 'checked'.
 */

import type { CartographerState } from '../CartographerState.ts';
import { ColdChain } from '../services.ts';

import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region cold-chain-check-node
export class ColdChainCheckNode extends MonadicNode<CartographerState, 'checked'> {
  readonly 'name' = 'cold-chain-check';
  readonly 'outputs' = ['checked'] as const;

  override get outputSchema(): Record<'checked', SchemaObjectType> {
    return {
      'checked': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'checked', CartographerState>> {
    for (const item of batch) {
      const v = item.state.canonicalVariant;
      const tempC = v.eventType === 'sensor-reading' ? v.body.tempC : 0;
      const shockG = v.eventType === 'sensor-reading' ? v.body.shockG : 0;
      item.state.coldChainBreach = ColdChain.breached(tempC, shockG);
    }
    return RoutedBatch.create('checked', batch);
  }
}
// #endregion cold-chain-check-node

export const coldChainCheck = new ColdChainCheckNode();
