/**
 * ip-geolocate: the IP-modality node of the geo-resolve sub-DAG.
 *
 * Calls the injected IpGeolocator transport (real freeipapi.com live, or the
 * recorded fixture) with the signal's gateway IP and stores the IP-modality
 * candidate on state.ipCandidate. A DISTINCT node — it does not fuse or
 * reverse-geocode.
 *
 * This node runs ONLY when the signal carries an IP (route-modalities skips it
 * for GPS-only signals → an avoided real IP call). Counts a real call on
 * state.routing.
 *
 * Routes 'geolocated'.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';

import { NodeOutputBuilder, type NodeInterface } from '@noocodex/dagonizer';

// #region ip-geolocate-node
export const ipGeolocate: NodeInterface<CartographerState, 'geolocated', CartographerServices> = {
  'name': 'ip-geolocate',
  'outputs': ['geolocated'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    state.ipCandidate = await context.services.ipGeolocator.lookup(
      state.canonical.body.ipAddress,
      context.signal,
    );
    state.routing = { ...state.routing, 'ipGeolocateRun': true };
    return NodeOutputBuilder.of('geolocated');
  },
};
// #endregion ip-geolocate-node
