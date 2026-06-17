/**
 * geo-pipeline-batch: inlined geo-pipeline for the homogeneous per-type batch path.
 *
 * Iterates `state.variantBatch` and, for each item, runs the exact conditional
 * sequence that the individual-event geo sub-DAG runs across five nodes
 * (route-geo → apply-geo | validate-coords → reverse-geocode → route-modalities
 * → ip-geolocate? → fuse-geo), writing per-item results into the batch arrays:
 *   - state.geoContextBatch[i]
 *   - state.resolvedGeoBatch[i]
 *   - state.gpsCandidateBatch[i]
 *   - state.ipCandidateBatch[i]
 *   - state.routingBatch[i]
 *
 * Items with invalid WGS-84 coordinates receive default (unmapped) shapes and
 * are never dropped — the batch always resolves to 'resolved'.
 *
 * The routing record for every item in a position-ping batch is stamped
 * `path: 'geo-only'`, `pricingSkipped: true`, `etaSkipped: true`,
 * `coldChainRun: false`, `customsDwellRun: false` — matching the decisions
 * routeEventType makes for `'position-ping'` events.
 *
 * Routes 'resolved' always.
 */

import { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import type { GeoCandidate } from '../entities/GeoCandidate.ts';
import type { GeoContext } from '../entities/GeoContext.ts';
import type { ResolvedGeo } from '../entities/ResolvedGeo.ts';
import type { EnrichedShipment } from '../entities/EnrichedShipment.ts';
import { GeoLookup, TimeZoneResolver } from '../services.ts';
import { GeoFusion } from '../services/GeoFusion.ts';

import {
  NodeOutputBuilder,
  type NodeContextInterface,
  type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region default-shapes
const DEFAULT_GEO_CONTEXT: GeoContext = {
  'gridZone':    '',
  'country':     '',
  'continent':   'Unmapped',
  'countries':   [],
  'region':      '',
  'hub':         '',
  'status':      'unmapped',
  'waterBodies': [],
  'timezone':    'UTC',
  'jurisdiction': 'baseline',
};

const DEFAULT_RESOLVED_GEO: ResolvedGeo = {
  'country':     '',
  'countryName': '',
  'continent':   'Unmapped',
  'region':      '',
  'locality':    '',
  'lat':         0,
  'lng':         0,
  'status':      'land',
  'jurisdiction': 'baseline',
  'confidence':  0,
  'modalities':  [],
};
// #endregion default-shapes

// #region geo-pipeline-batch-node
export class GeoPipelineBatchNode extends ScalarNode<CartographerState, 'resolved', CartographerServices> {
  readonly 'name' = 'geo-pipeline-batch';
  readonly 'outputs' = ['resolved'] as const;

  protected override async executeOne(
    state: CartographerState,
    context: NodeContextInterface<CartographerServices>,
  ): Promise<NodeOutputInterface<'resolved'>> {
    // Reset all batch arrays before the loop so stale data from a previous
    // dispatch never bleeds into this one.
    state.geoContextBatch   = [];
    state.resolvedGeoBatch  = [];
    state.routingBatch      = [];
    state.gpsCandidateBatch = [];
    state.ipCandidateBatch  = [];
    state.batchSkipMask     = [];

    const { variantBatch } = state;

    for (let i = 0; i < variantBatch.length; i++) {
      const variant = variantBatch[i];
      if (variant === undefined) continue;

      // Base routing for this item: position-ping lane defaults.
      const itemRouting: EnrichedShipment['routing'] = {
        ...CartographerState.defaultRouting(),
        'path':          'geo-only',
        'pricingRun':    false,
        'pricingSkipped': true,
        'etaRun':        false,
        'etaSkipped':    true,
        'coldChainRun':  false,
        'customsDwellRun': false,
      };

      // Per-item candidates (fresh for each item).
      let gpsCandidate: GeoCandidate = CartographerState.unresolvedCandidate('gps');
      let ipCandidate:  GeoCandidate = CartographerState.unresolvedCandidate('ip');

      let itemGeoContext:  GeoContext  = { ...DEFAULT_GEO_CONTEXT,  'countries': [], 'waterBodies': [] };
      let itemResolvedGeo: ResolvedGeo = { ...DEFAULT_RESOLVED_GEO, 'modalities': [] };

      // ── Step A: route-geo ────────────────────────────────────────────────────
      const geo = variant.geo;
      const hasResolvedGeo =
        geo !== undefined &&
        geo.country.length > 0 &&
        geo.country !== 'UNK' &&
        geo.region.length > 0 &&
        geo.region !== 'Unmapped';

      if (hasResolvedGeo) {
        // ── Step B: apply-geo (has-geo branch) ──────────────────────────────
        itemRouting.geoLookupSkipped = true;
        itemRouting.geoLookupRun     = false;

        // geo is guaranteed non-undefined by hasResolvedGeo; ?? branches are
        // defensive fallbacks that match applyGeo.ts exactly.
        const country   = geo?.country   ?? variant.body.latitude.toString();
        const continent = geo?.continent ?? 'Unmapped';
        const region    = geo?.region    ?? 'Unmapped';

        itemGeoContext = GeoLookup.fromResolved(
          country,
          continent,
          region,
          variant.body.latitude,
          variant.body.longitude,
        );
      } else {
        // ── needs-geo branch ─────────────────────────────────────────────────
        itemRouting.geoLookupRun     = true;
        itemRouting.geoLookupSkipped = false;

        const lat = variant.body.latitude;
        const lng = variant.body.longitude;
        const coordsValid = lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

        if (!coordsValid) {
          // ── Step C: validate-coords rejected — mark item for skip ────────────
          // Mirror the per-event behaviour: validate-coords routes to 'rejected'
          // terminal which produces no enriched output. The skip mask excludes
          // this item from normalizedBatch/enrichedBatch downstream.
          state.geoContextBatch[i]   = { ...DEFAULT_GEO_CONTEXT,  'countries': [], 'waterBodies': [] };
          state.resolvedGeoBatch[i]  = { ...DEFAULT_RESOLVED_GEO, 'modalities': [] };
          state.gpsCandidateBatch[i] = gpsCandidate;
          state.ipCandidateBatch[i]  = ipCandidate;
          state.routingBatch[i]      = itemRouting;
          state.batchSkipMask[i]     = true;
          continue;
        } else {
          // ── Step D: reverse-geocode ─────────────────────────────────────────
          gpsCandidate = await context.services.reverseGeocoder.lookup(lat, lng, context.signal);
          itemRouting.reverseGeocodeRun = true;

          // ── Step E: route-modalities ────────────────────────────────────────
          const hasIp = variant.body.ipAddress.length > 0;

          if (hasIp) {
            // ── Step F: ip-geolocate ──────────────────────────────────────────
            ipCandidate = await context.services.ipGeolocator.lookup(
              variant.body.ipAddress,
              context.signal,
            );
            itemRouting.ipGeolocateRun = true;
          } else {
            itemRouting.ipGeolocateSkipped = true;
          }

          // ── Step G: fuse-geo ────────────────────────────────────────────────
          const resolved = GeoFusion.fuse(gpsCandidate, ipCandidate, lat, lng);

          itemResolvedGeo = resolved;
          itemRouting.geoConfidence = resolved.confidence;
          itemRouting.geoModalities = [...resolved.modalities];

          itemGeoContext = {
            'gridZone':    'API',
            'country':     resolved.country.length > 0 ? resolved.country : 'INTL',
            'continent':   resolved.continent || 'Unmapped',
            'countries':   resolved.country.length > 0 ? [resolved.country] : [],
            'region':      resolved.region,
            'hub':         resolved.locality || resolved.countryName || 'Unknown',
            'status':      resolved.status,
            'waterBodies': resolved.status === 'water' ? [resolved.locality] : [],
            'timezone':    TimeZoneResolver.zoneFor(lat, lng),
            'jurisdiction': resolved.jurisdiction,
          };
        }
      }

      // ── Write per-item results ───────────────────────────────────────────────
      state.geoContextBatch[i]   = itemGeoContext;
      state.resolvedGeoBatch[i]  = itemResolvedGeo;
      state.gpsCandidateBatch[i] = gpsCandidate;
      state.ipCandidateBatch[i]  = ipCandidate;
      state.routingBatch[i]      = itemRouting;
      state.batchSkipMask[i]     = false;
    }

    return NodeOutputBuilder.of('resolved');
  }
}
// #endregion geo-pipeline-batch-node

export const geoPipelineBatch = new GeoPipelineBatchNode();
