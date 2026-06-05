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

import type { NodeInterface } from '@noocodex/dagonizer';

// #region cold-chain-check-node
export const coldChainCheck: NodeInterface<CartographerState, 'checked', CartographerServices> = {
  'name': 'cold-chain-check',
  'outputs': ['checked'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const b = state.canonical.body;
    state.coldChainBreach = ColdChain.breached(b.tempC, b.shockG);
    return { 'output': 'checked' };
  },
};
// #endregion cold-chain-check-node
