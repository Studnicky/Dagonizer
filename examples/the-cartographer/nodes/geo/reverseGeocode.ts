/**
 * reverse-geocode: the GPS-modality node of the geo-resolve sub-DAG.
 *
 * Calls the injected ReverseGeocoder transport (the offline country-coder
 * `OfflineReverseGeocoder`) with the scan's coords and stores the GPS-modality
 * candidate on state.gpsCandidate. A DISTINCT node — it does not fuse or
 * geolocate IP.
 *
 * Counts a reverse-geocode resolution on state.routing. (Reverse-geocode is now
 * offline/free — the avoidable REAL calls in the savings view are IP geolocations.)
 *
 * Routes 'geocoded'.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';

import type { NodeInterface } from '@noocodex/dagonizer';

// #region reverse-geocode-node
export const reverseGeocode: NodeInterface<CartographerState, 'geocoded', CartographerServices> = {
  'name': 'reverse-geocode',
  'outputs': ['geocoded'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    state.gpsCandidate = await context.services.reverseGeocoder.lookup(
      state.raw.latitude,
      state.raw.longitude,
      context.signal,
    );
    state.routing = { ...state.routing, 'reverseGeocodeRun': true };
    return { 'output': 'geocoded' };
  },
};
// #endregion reverse-geocode-node
