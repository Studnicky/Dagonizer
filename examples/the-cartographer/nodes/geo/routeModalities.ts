/**
 * route-modalities: conditional IP-modality branch inside geo-resolve.
 *
 * After reverse-geocode (the always-run GPS modality), this node decides whether
 * to run the IP-modality node: if the signal carries a gateway IP → run
 * ip-geolocate (then fuse both); else SKIP it (GPS-only resolution) → a real IP
 * call avoided. The IP modality is itself a conditionally-executed node.
 *
 * Records the decision on state.routing for the savings view.
 *
 * Routes 'ip' (run ip-geolocate) or 'gps-only' (skip it, go straight to fuse).
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';

import { NodeOutputBuilder, type NodeInterface } from '@noocodex/dagonizer';

// #region route-modalities-node
export const routeModalities: NodeInterface<CartographerState, 'ip' | 'gps-only', CartographerServices> = {
  'name': 'route-modalities',
  'outputs': ['ip', 'gps-only'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const hasIp = state.canonical.body.ipAddress.length > 0;
    if (hasIp) {
      return NodeOutputBuilder.of('ip');
    }
    state.routing = { ...state.routing, 'ipGeolocateSkipped': true };
    return NodeOutputBuilder.of('gps-only');
  },
};
// #endregion route-modalities-node
