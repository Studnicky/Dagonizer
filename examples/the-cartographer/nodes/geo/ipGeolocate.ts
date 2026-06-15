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

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region ip-geolocate-node
export class IpGeolocateNode implements NodeInterface<CartographerState, 'geolocated', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'ip-geolocate';
  readonly 'outputs' = ['geolocated'] as const;

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'geolocated'>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    state.ipCandidate = await context.services.ipGeolocator.lookup(
      state.canonical.body.ipAddress,
      context.signal,
    );
    state.routing = { ...state.routing, 'ipGeolocateRun': true };
    return NodeOutputBuilder.of('geolocated');
  }
}
// #endregion ip-geolocate-node

export const ipGeolocate = new IpGeolocateNode();
