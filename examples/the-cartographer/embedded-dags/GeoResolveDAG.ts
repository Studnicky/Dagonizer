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
 * The transports (ReverseGeocoder / IpGeolocator) are injected via the services
 * record — the GPS transport is always the offline country-coder; the IP transport is
 * Live (real HTTP) online or Recorded (fixture replay) for the smoke.
 */

// #region geo-resolve-dag
import { reverseGeocode } from '../nodes/geo/reverseGeocode.ts';
import { routeModalities } from '../nodes/geo/routeModalities.ts';
import { ipGeolocate } from '../nodes/geo/ipGeolocate.ts';
import { fuseGeo } from '../nodes/geo/fuseGeo.ts';
import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

export const geoResolveDAG: DAGType = new DAGBuilder('geo-resolve', '1.0')

  // 1. reverse-geocode: GPS modality (offline country-coder). Always runs.
  .node('reverse-geocode', reverseGeocode, {
    'geocoded': 'route-modalities',
  })

  // 2. route-modalities: run the IP modality only when a gateway IP is present.
  .node('route-modalities', routeModalities, {
    'ip':       'ip-geolocate',
    'gps-only': 'fuse-geo',
  })

  // 3. ip-geolocate: IP modality (a real freeipapi.com call). Conditional.
  .node('ip-geolocate', ipGeolocate, {
    'geolocated': 'fuse-geo',
  })

  // 4. fuse-geo: FAN-IN the two modality candidates → ResolvedGeo + geoContext.
  .node('fuse-geo', fuseGeo, {
    'fused': 'resolved',
  })

  .terminal('resolved', { outcome: 'completed' })

  .build();

export const geoResolveBundle: DispatcherBundleType<CartographerState, CartographerServices> = {
  'nodes': [reverseGeocode, routeModalities, ipGeolocate, fuseGeo],
  'dags': [geoResolveDAG],
};
// #endregion geo-resolve-dag
