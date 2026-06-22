/**
 * GeoResolveDAG: the multi-modal geo-resolution sub-DAG (composed of DISTINCT
 * nodes — NOT a monolithic resolver). Real geo APIs resolve each modality; the
 * fan-in node fuses them:
 *
 *   reverse-geocode (GPS modality, always runs — offline country-coder)
 *     └─► route-modalities
 *           ├─ip─────────► ip-geolocate (a real freeipapi.com call) ─┐
 *           └─gps-only────────────────────────────────────────────┐ │ (skip the IP call)
 *                                                                  ▼ ▼
 *                                                               fuse-geo (FAN-IN)
 *                                                                  └─► resolved
 *
 * reverse-geocode, ip-geolocate, and fuse-geo are SEPARATE nodes. The GPS modality
 * is resolved OFFLINE (deterministic, no network); the IP modality is conditionally
 * executed (route-modalities skips it for GPS-only signals → a real IP call avoided).
 * fuse-geo combines the two candidates into state.geoContext with a confidence + the
 * modalities that agreed.
 *
 * Embedded in event-pipeline via route-geo's 'needs-geo' branch; route-geo skips
 * this whole sub-DAG (the geo nodes) when the source pre-resolved geo.
 *
 * The transports (ReverseGeocoder / IpGeolocator) are injected via constructor DI —
 * call GeoResolveDAG.build(reverseGeocoder, ipGeolocator) at the call site.
 */

// #region geo-resolve-dag
import { ReverseGeocodeNode } from '../nodes/geo/reverseGeocode.ts';
import { routeModalities } from '../nodes/geo/routeModalities.ts';
import { IpGeolocateNode } from '../nodes/geo/ipGeolocate.ts';
import { fuseGeo } from '../nodes/geo/fuseGeo.ts';
import type { CartographerState } from '../CartographerState.ts';
import type { ReverseGeocoder } from '../contracts/ReverseGeocoder.ts';
import type { IpGeolocator } from '../contracts/IpGeolocator.ts';

import type { DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

export class GeoResolveDAG {
  private constructor() { /* static-only */ }

  static build(
    reverseGeocoder: ReverseGeocoder,
    ipGeolocator: IpGeolocator,
  ): DispatcherBundleType<CartographerState> {
    const reverseGeocodeNode = new ReverseGeocodeNode(reverseGeocoder);
    const ipGeolocateNode = new IpGeolocateNode(ipGeolocator);

    const dag = new DAGBuilder('geo-resolve', '1.0')

      // 1. reverse-geocode: GPS modality (offline country-coder). Always runs.
      .node('reverse-geocode', reverseGeocodeNode, {
        'geocoded': 'route-modalities',
      })

      // 2. route-modalities: run the IP modality only when a gateway IP is present.
      .node('route-modalities', routeModalities, {
        'ip':       'ip-geolocate',
        'gps-only': 'fuse-geo',
      })

      // 3. ip-geolocate: IP modality (a real freeipapi.com call). Conditional.
      .node('ip-geolocate', ipGeolocateNode, {
        'geolocated': 'fuse-geo',
      })

      // 4. fuse-geo: FAN-IN the two modality candidates → ResolvedGeo + geoContext.
      .node('fuse-geo', fuseGeo, {
        'fused': 'resolved',
      })

      .terminal('resolved', { outcome: 'completed' })

      .build();

    return {
      'nodes': [reverseGeocodeNode, routeModalities, ipGeolocateNode, fuseGeo],
      'dags': [dag],
    };
  }
}
// #endregion geo-resolve-dag
