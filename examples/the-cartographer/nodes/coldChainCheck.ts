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
import type { CartographerServices } from '../CartographerServices.ts';
import { ColdChain } from '../services.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region cold-chain-check-node
export class ColdChainCheckNode extends ScalarNode<CartographerState, 'checked', CartographerServices> {
  readonly 'name' = 'cold-chain-check';
  readonly 'outputs' = ['checked'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'checked'>> {
    const v = state.canonicalVariant;
    const tempC = v.eventType === 'sensor-reading' ? v.body.tempC : 0;
    const shockG = v.eventType === 'sensor-reading' ? v.body.shockG : 0;
    state.coldChainBreach = ColdChain.breached(tempC, shockG);
    return NodeOutputBuilder.of('checked');
  }
}
// #endregion cold-chain-check-node

export const coldChainCheck = new ColdChainCheckNode();
