/**
 * GeoSourceResolveDAG: validity-gated layered-consensus multi-entry geo-resolution
 * sub-DAG.
 *
 * The parent DAG has one entrypoint per geo modality. Each entrypoint embeds a
 * modality-specific resolver DAG that prepares its descriptor, resolves the
 * candidate when present, and projects `state.candidate` into a gather record.
 * The first-class `geo-weighted-fusion` gather node is the graph-visible barrier
 * that accumulates every weight>0 candidate into `state.geoCandidates`. When at
 * least one candidate resolved, a node chain derives the combined location from
 * every signal instead of a single weight-ranked winner:
 *
 *   - `resolve-country-consensus` groups candidates by country (or water) and
 *     picks the group with the highest SUMMED weight — agreement, not a single
 *     candidate's weight, decides. Branches 'consensus' when the winning group
 *     clears the agreement thresholds (see the node's own doc comment), or
 *     'no-consensus' when the signals disagreed too much to trust an answer.
 *   - `verify-point-containment` (consensus lane) reverse-geocodes the best
 *     available point and checks it against the consensus country, recording
 *     disagreement as a conflict rather than silently picking a side.
 *   - `assemble-resolved-geo` (consensus lane) writes `state.resolvedGeo`,
 *     `state.geoContext`, and `state.routing.{geoConfidence,geoModalities,...}`
 *     from the verified consensus + position — timezone is left as a placeholder.
 *   - `resolve-timezone` (consensus lane) derives the REAL timezone from the
 *     final assembled position via `TimeZoneResolver.zoneFor` — never from a
 *     candidate's self-reported value — since timezone depends on the position
 *     this chain settled on, not on any individual signal.
 *   - `flag-geo-for-review` (no-consensus lane) writes baseline `resolvedGeo`/
 *     `geoContext` and sets `state.routing.geoFlaggedForReview = true` — a
 *     visibly distinct DAG lane for locations that need investigation, not
 *     silently blended into the confident-resolution path.
 *
 * When no signal resolves, the gather writes the baseline values directly and
 * skips the consensus chain entirely — there is nothing to consense over.
 *
 * Topology:
 *   entrypoints:
 *     coords  ─► resolve-coords-source  ─success/error─┐
 *     address ─► resolve-address-source ─success/error─┤
 *     ip      ─► resolve-ip-source      ─success/error─┤
 *     code    ─► resolve-code-source    ─success/error─┤─► geo-weighted-fusion
 *     phone   ─► resolve-phone-source   ─success/error─┤
 *     locale  ─► resolve-locale-source  ─success/error─┘
 *   geo-weighted-fusion (gather):
 *     ─success/error─► resolve-country-consensus
 *                         ─consensus────► verify-point-containment ─► assemble-resolved-geo ─► resolve-timezone ─► resolved
 *                         ─no-consensus─► flag-geo-for-review ──────────────────────────────────────────────────► resolved
 *     ─empty─────────────────────────────────────────────────────────────────────────────────────────────────────► resolved
 *   resolved: terminal (completed)
 *
 * DI: `ipGeolocator` and `addressGeocoder` are injected per-call so each
 * dispatcher (main thread, worker thread) owns its own transport instances.
 */

// #region geo-source-resolve-dag
import { resolveCoords } from '../nodes/geo/resolveCoords.ts';
import { resolveLocale } from '../nodes/geo/resolveLocale.ts';
import { resolveCode } from '../nodes/geo/resolveCode.ts';
import { resolvePhone } from '../nodes/geo/resolvePhone.ts';
import { ResolveIpNode } from '../nodes/geo/resolveIp.ts';
import { ResolveAddressNode } from '../nodes/geo/resolveAddress.ts';
import {
  prepareGeoAddress,
  prepareGeoCode,
  prepareGeoCoords,
  prepareGeoIp,
  prepareGeoLocale,
  prepareGeoPhone,
} from '../nodes/geo/prepareGeoSignal.ts';
import { resolveCountryConsensus } from '../nodes/geo/resolveCountryConsensus.ts';
import { verifyPointContainment } from '../nodes/geo/verifyPointContainment.ts';
import { assembleResolvedGeo } from '../nodes/geo/assembleResolvedGeo.ts';
import { resolveTimezone } from '../nodes/geo/resolveTimezone.ts';
import { flagGeoForReview } from '../nodes/geo/flagGeoForReview.ts';
import { CARTOGRAPHER_IRIS } from '../cartographerIds.ts';
import type { IpGeolocator } from '../contracts/IpGeolocator.ts';
import type { AddressGeocoder } from '../contracts/AddressGeocoder.ts';
import type { CartographerState } from '../CartographerState.ts';

// Side-effect import: registers 'geo-weighted-fusion' at module load so the
// scatter placement can resolve the strategy name at dispatcher construction.
import '../core/GeoWeightedFusionGather.ts';

import type { DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

export class GeoSourceResolveDAG {
  private constructor() { /* static-only */ }

  static build(
    ipGeolocator: IpGeolocator,
    addressGeocoder: AddressGeocoder,
  ): DispatcherBundleType<CartographerState> {
    const resolveIp = new ResolveIpNode(ipGeolocator);
    const resolveAddress = new ResolveAddressNode(addressGeocoder);

    const resolveCoordsDag = new DAGBuilder(CARTOGRAPHER_IRIS.dag.geoResolveCoords, '1.0')
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveCoords, 'prepare-geo-coords'), prepareGeoCoords, {
        'present': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveCoords, 'resolve-coords'),
        'missing': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveCoords, 'done'),
      })
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveCoords, 'resolve-coords'), resolveCoords, { 'resolved': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveCoords, 'done') })
      .terminal(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveCoords, 'done'), { 'outcome': 'completed' })
      .build();

    const resolveAddressDag = new DAGBuilder(CARTOGRAPHER_IRIS.dag.geoResolveAddress, '1.0')
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveAddress, 'prepare-geo-address'), prepareGeoAddress, {
        'present': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveAddress, 'resolve-address'),
        'missing': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveAddress, 'done'),
      })
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveAddress, 'resolve-address'), resolveAddress, { 'resolved': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveAddress, 'done') })
      .terminal(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveAddress, 'done'), { 'outcome': 'completed' })
      .build();

    const resolveIpDag = new DAGBuilder(CARTOGRAPHER_IRIS.dag.geoResolveIp, '1.0')
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveIp, 'prepare-geo-ip'), prepareGeoIp, {
        'present': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveIp, 'resolve-ip'),
        'missing': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveIp, 'done'),
      })
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveIp, 'resolve-ip'), resolveIp, { 'resolved': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveIp, 'done') })
      .terminal(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveIp, 'done'), { 'outcome': 'completed' })
      .build();

    const resolveCodeDag = new DAGBuilder(CARTOGRAPHER_IRIS.dag.geoResolveCode, '1.0')
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveCode, 'prepare-geo-code'), prepareGeoCode, {
        'present': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveCode, 'resolve-code'),
        'missing': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveCode, 'done'),
      })
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveCode, 'resolve-code'), resolveCode, { 'resolved': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveCode, 'done') })
      .terminal(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveCode, 'done'), { 'outcome': 'completed' })
      .build();

    const resolvePhoneDag = new DAGBuilder(CARTOGRAPHER_IRIS.dag.geoResolvePhone, '1.0')
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolvePhone, 'prepare-geo-phone'), prepareGeoPhone, {
        'present': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolvePhone, 'resolve-phone'),
        'missing': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolvePhone, 'done'),
      })
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolvePhone, 'resolve-phone'), resolvePhone, { 'resolved': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolvePhone, 'done') })
      .terminal(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolvePhone, 'done'), { 'outcome': 'completed' })
      .build();

    const resolveLocaleDag = new DAGBuilder(CARTOGRAPHER_IRIS.dag.geoResolveLocale, '1.0')
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveLocale, 'prepare-geo-locale'), prepareGeoLocale, {
        'present': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveLocale, 'resolve-locale'),
        'missing': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveLocale, 'done'),
      })
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveLocale, 'resolve-locale'), resolveLocale, { 'resolved': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveLocale, 'done') })
      .terminal(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoResolveLocale, 'done'), { 'outcome': 'completed' })
      .build();

    const dag = new DAGBuilder(CARTOGRAPHER_IRIS.dag.geoSourceResolve, '1.0')

      .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-coords-source'), CARTOGRAPHER_IRIS.dag.geoResolveCoords, {
        'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'geo-weighted-fusion'),
        'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'geo-weighted-fusion'),
      }, {
        'gatherResult': { 'resultField': 'candidate' },
      })

      .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-address-source'), CARTOGRAPHER_IRIS.dag.geoResolveAddress, {
        'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'geo-weighted-fusion'),
        'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'geo-weighted-fusion'),
      }, {
        'gatherResult': { 'resultField': 'candidate' },
      })

      .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-ip-source'), CARTOGRAPHER_IRIS.dag.geoResolveIp, {
        'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'geo-weighted-fusion'),
        'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'geo-weighted-fusion'),
      }, {
        'gatherResult': { 'resultField': 'candidate' },
      })

      .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-code-source'), CARTOGRAPHER_IRIS.dag.geoResolveCode, {
        'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'geo-weighted-fusion'),
        'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'geo-weighted-fusion'),
      }, {
        'gatherResult': { 'resultField': 'candidate' },
      })

      .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-phone-source'), CARTOGRAPHER_IRIS.dag.geoResolvePhone, {
        'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'geo-weighted-fusion'),
        'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'geo-weighted-fusion'),
      }, {
        'gatherResult': { 'resultField': 'candidate' },
      })

      .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-locale-source'), CARTOGRAPHER_IRIS.dag.geoResolveLocale, {
        'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'geo-weighted-fusion'),
        'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'geo-weighted-fusion'),
      }, {
        'gatherResult': { 'resultField': 'candidate' },
      })

      .entrypoints({
        'coords':  CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-coords-source'),
        'address': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-address-source'),
        'ip':      CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-ip-source'),
        'code':    CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-code-source'),
        'phone':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-phone-source'),
        'locale':  CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-locale-source'),
      })

      // First-class gather barrier over all embedded resolver producers.
      .gather(
        CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'geo-weighted-fusion'),
        {
          [CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-coords-source')]: {},
          [CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-address-source')]: {},
          [CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-ip-source')]: {},
          [CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-code-source')]: {},
          [CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-phone-source')]: {},
          [CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-locale-source')]: {},
        },
        { 'strategy': 'geo-weighted-fusion' },
        {
          'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-country-consensus'),
          'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-country-consensus'),
          'empty':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolved'),
        },
      )

      // Layered-consensus chain: consensus country → verified point → assembled
      // ResolvedGeo/GeoContext → real-geography timezone. A country/water
      // identity that fails to reach consensus branches to flag-geo-for-review
      // instead of joining the confident-resolution lane.
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-country-consensus'), resolveCountryConsensus, {
        'consensus':    CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'verify-point-containment'),
        'no-consensus': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'flag-geo-for-review'),
      })
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'verify-point-containment'), verifyPointContainment, {
        'resolved': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'assemble-resolved-geo'),
      })
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'assemble-resolved-geo'), assembleResolvedGeo, {
        'resolved': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-timezone'),
      })
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolve-timezone'), resolveTimezone, {
        'resolved': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolved'),
      })
      .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'flag-geo-for-review'), flagGeoForReview, {
        'resolved': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolved'),
      })

      .terminal(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolved'), { 'outcome': 'completed' })

      .build();

    return {
      'nodes': [
        prepareGeoCoords,
        prepareGeoAddress,
        prepareGeoIp,
        prepareGeoCode,
        prepareGeoPhone,
        prepareGeoLocale,
        resolveCoords,
        resolveAddress,
        resolveIp,
        resolveCode,
        resolvePhone,
        resolveLocale,
        resolveCountryConsensus,
        verifyPointContainment,
        assembleResolvedGeo,
        resolveTimezone,
        flagGeoForReview,
      ],
      'dags': [
        resolveCoordsDag,
        resolveAddressDag,
        resolveIpDag,
        resolveCodeDag,
        resolvePhoneDag,
        resolveLocaleDag,
        dag,
      ],
    };
  }
}
// #endregion geo-source-resolve-dag
