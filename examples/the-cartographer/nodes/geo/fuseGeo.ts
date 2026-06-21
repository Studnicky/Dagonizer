/**
 * fuse-geo: the FAN-IN node of the geo-resolve sub-DAG.
 *
 * Combines the GPS reverse-geocode candidate (state.gpsCandidate) and the IP
 * geolocation candidate (state.ipCandidate, unresolved when ip-geolocate was
 * skipped) into one ResolvedGeo via GeoFusion, then materialises it onto
 * state.geoContext (country/region/hub + tz + jurisdiction). Agreement on
 * country → high confidence + modalities ['gps','ip']; disagreement → prefer GPS,
 * lower confidence, flag.
 *
 * The fusion MATH lives in the GeoFusion helper; this NODE is the orchestration
 * unit (the fan-in seam where the two modalities become one resolved location).
 *
 * Routes 'fused'.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';
import { GeoFusion } from '../../services/GeoFusion.ts';
import { TimeZoneResolver } from '../../services.ts';

import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

// #region fuse-geo-node
export class FuseGeoNode extends ScalarNode<CartographerState, 'fused', CartographerServices> {
  readonly 'name' = 'fuse-geo';
  readonly 'outputs' = ['fused'] as const;

  override get outputSchema(): Record<'fused', SchemaObjectType> {
    return {
      'fused': { 'type': 'object' },
    };
  }

  protected override async executeOne(state: CartographerState, _context: NodeContextType<CartographerServices>): Promise<NodeOutputType<'fused'>> {
    const lat = state.raw.latitude;
    const lng = state.raw.longitude;
    const resolved = GeoFusion.fuse(state.gpsCandidate, state.ipCandidate, lat, lng);

    state.resolvedGeo = resolved;
    // Carry the fusion outcome (confidence + which modalities agreed) onto the
    // routing record so the savings view + the report can surface multi-modal
    // confidence per event.
    state.routing = {
      ...state.routing,
      'geoConfidence': resolved.confidence,
      'geoModalities': [...resolved.modalities],
    };
    state.geoContext = {
      'gridZone':     'API', // geo is API-resolved, not grid-keyed
      'country':      resolved.country.length > 0 ? resolved.country : 'INTL',
      // Macro continent for the insights rollup (from the real API).
      'continent':    resolved.continent || 'Unmapped',
      'countries':    resolved.country.length > 0 ? [resolved.country] : [],
      'region':       resolved.region,
      // The place label: the locality (city / sea), else the country name.
      'hub':          resolved.locality || resolved.countryName || 'Unknown',
      'status':       resolved.status,
      'waterBodies':  resolved.status === 'water' ? [resolved.locality] : [],
      'timezone':     TimeZoneResolver.zoneFor(lat, lng),
      'jurisdiction': resolved.jurisdiction,
    };
    return NodeOutputBuilder.of('fused');
  }
}

export const fuseGeo = new FuseGeoNode();
// #endregion fuse-geo-node
