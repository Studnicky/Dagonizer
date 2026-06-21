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

import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

// #region reverse-geocode-node
export class ReverseGeocodeNode extends ScalarNode<CartographerState, 'geocoded', CartographerServices> {
  readonly 'name' = 'reverse-geocode';
  readonly 'outputs' = ['geocoded'] as const;

  override get outputSchema(): Record<'geocoded', SchemaObjectType> {
    return {
      'geocoded': { 'type': 'object' },
    };
  }

  protected override async executeOne(state: CartographerState, context: NodeContextType<CartographerServices>): Promise<NodeOutputType<'geocoded'>> {
    const outcome = await context.services.reverseGeocoder.lookup(
      state.raw.latitude,
      state.raw.longitude,
      context.signal,
    );
    state.gpsCandidate = outcome.candidate;
    // A captured transport exception rides as data: append it to state.capturedErrors.
    // The node still routes 'geocoded' — graceful degradation, error recorded.
    if (outcome.error !== null) {
      state.capturedErrors = [...state.capturedErrors, outcome.error];
    }
    state.routing = { ...state.routing, 'reverseGeocodeRun': true };
    return NodeOutputBuilder.of('geocoded');
  }
}
// #endregion reverse-geocode-node

export const reverseGeocode = new ReverseGeocodeNode();
