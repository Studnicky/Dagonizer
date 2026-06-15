/**
 * cold-chain-check: sensor-lane only — evaluate cold-chain telemetry for a breach.
 *
 * Runs ONLY on the route-kind 'sensor' lane (sensor-reading events carry temp /
 * shock telemetry). Other kinds skip this node entirely — the per-kind skip
 * showcase. Sets state.coldChainBreach from the canonical body's tempC / shockG.
 *
 * Routes 'checked'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { ColdChain } from '../services.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region cold-chain-check-node
export class ColdChainCheckNode implements NodeInterface<CartographerState, 'checked', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'cold-chain-check';
  readonly 'outputs' = ['checked'] as const;

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'checked'>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const b = state.canonical.body;
    state.coldChainBreach = ColdChain.breached(b.tempC, b.shockG);
    return NodeOutputBuilder.of('checked');
  }
}
// #endregion cold-chain-check-node

export const coldChainCheck = new ColdChainCheckNode();
