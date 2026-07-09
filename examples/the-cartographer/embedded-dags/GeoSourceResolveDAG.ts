/**
 * GeoSourceResolveDAG: validity-gated weighted multi-entry geo-resolution sub-DAG.
 *
 * The parent DAG has one entrypoint per geo modality. Each entrypoint embeds a
 * modality-specific resolver DAG that prepares its descriptor, resolves the
 * candidate when present, and projects `state.candidate` into a gather record.
 * The first-class `geo-weighted-fusion` gather node is the graph-visible barrier
 * that folds candidates by weight into `state.resolvedGeo`, `state.geoContext`,
 * and `state.routing.{geoConfidence,geoModalities}`. When no signal resolves,
 * the gather writes the baseline values directly.
 *
 * Topology:
 *   entrypoints:
 *     coords  ─► resolve-coords-source  ─success/error─┐
 *     address ─► resolve-address-source ─success/error─┤
 *     ip      ─► resolve-ip-source      ─success/error─┤
 *     code    ─► resolve-code-source    ─success/error─┤─► geo-weighted-fusion
 *     phone   ─► resolve-phone-source   ─success/error─┤
 *     locale  ─► resolve-locale-source  ─success/error─┘
 *   geo-weighted-fusion (gather) ─success/error/empty──► resolved
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
          'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolved'),
          'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolved'),
          'empty':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.geoSourceResolve, 'resolved'),
        },
      )

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
