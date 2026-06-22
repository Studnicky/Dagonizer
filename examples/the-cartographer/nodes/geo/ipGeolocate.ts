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
import type { IpGeolocator } from '../../contracts/IpGeolocator.ts';

import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

// #region ip-geolocate-node
export class IpGeolocateNode extends ScalarNode<CartographerState, 'geolocated'> {
  private readonly ipGeolocator: IpGeolocator;
  readonly 'name' = 'ip-geolocate';
  readonly 'outputs' = ['geolocated'] as const;

  constructor(ipGeolocator: IpGeolocator) {
    super();
    this.ipGeolocator = ipGeolocator;
  }

  override get outputSchema(): Record<'geolocated', SchemaObjectType> {
    return {
      'geolocated': { 'type': 'object' },
    };
  }

  protected override async executeOne(state: CartographerState, context: NodeContextType): Promise<NodeOutputType<'geolocated'>> {
    const outcome = await this.ipGeolocator.lookup(
      state.canonical.body.ipAddress,
      context.signal,
    );
    state.ipCandidate = outcome.candidate;
    // A captured transport exception rides as data: append it to state.capturedErrors.
    if (outcome.error !== null) {
      state.capturedErrors = [...state.capturedErrors, outcome.error];
    }
    state.routing = { ...state.routing, 'ipGeolocateRun': true };
    return NodeOutputBuilder.of('geolocated');
  }
}
// #endregion ip-geolocate-node
