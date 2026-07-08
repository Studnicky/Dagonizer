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

    const resolveCoordsDag = new DAGBuilder('geo-resolve-coords', '1.0')
      .node('prepare-geo-coords', prepareGeoCoords, {
        'present': 'resolve-coords',
        'missing': 'done',
      })
      .node('resolve-coords', resolveCoords, { 'resolved': 'done' })
      .terminal('done', { 'outcome': 'completed' })
      .build();

    const resolveAddressDag = new DAGBuilder('geo-resolve-address', '1.0')
      .node('prepare-geo-address', prepareGeoAddress, {
        'present': 'resolve-address',
        'missing': 'done',
      })
      .node('resolve-address', resolveAddress, { 'resolved': 'done' })
      .terminal('done', { 'outcome': 'completed' })
      .build();

    const resolveIpDag = new DAGBuilder('geo-resolve-ip', '1.0')
      .node('prepare-geo-ip', prepareGeoIp, {
        'present': 'resolve-ip',
        'missing': 'done',
      })
      .node('resolve-ip', resolveIp, { 'resolved': 'done' })
      .terminal('done', { 'outcome': 'completed' })
      .build();

    const resolveCodeDag = new DAGBuilder('geo-resolve-code', '1.0')
      .node('prepare-geo-code', prepareGeoCode, {
        'present': 'resolve-code',
        'missing': 'done',
      })
      .node('resolve-code', resolveCode, { 'resolved': 'done' })
      .terminal('done', { 'outcome': 'completed' })
      .build();

    const resolvePhoneDag = new DAGBuilder('geo-resolve-phone', '1.0')
      .node('prepare-geo-phone', prepareGeoPhone, {
        'present': 'resolve-phone',
        'missing': 'done',
      })
      .node('resolve-phone', resolvePhone, { 'resolved': 'done' })
      .terminal('done', { 'outcome': 'completed' })
      .build();

    const resolveLocaleDag = new DAGBuilder('geo-resolve-locale', '1.0')
      .node('prepare-geo-locale', prepareGeoLocale, {
        'present': 'resolve-locale',
        'missing': 'done',
      })
      .node('resolve-locale', resolveLocale, { 'resolved': 'done' })
      .terminal('done', { 'outcome': 'completed' })
      .build();

    const dag = new DAGBuilder('geo-source-resolve', '1.0')

      .embed<CartographerState, CartographerState>('resolve-coords-source', 'geo-resolve-coords', {
        'success': 'geo-weighted-fusion',
        'error':   'geo-weighted-fusion',
      }, {
        'gatherResult': { 'resultField': 'candidate' },
      })

      .embed<CartographerState, CartographerState>('resolve-address-source', 'geo-resolve-address', {
        'success': 'geo-weighted-fusion',
        'error':   'geo-weighted-fusion',
      }, {
        'gatherResult': { 'resultField': 'candidate' },
      })

      .embed<CartographerState, CartographerState>('resolve-ip-source', 'geo-resolve-ip', {
        'success': 'geo-weighted-fusion',
        'error':   'geo-weighted-fusion',
      }, {
        'gatherResult': { 'resultField': 'candidate' },
      })

      .embed<CartographerState, CartographerState>('resolve-code-source', 'geo-resolve-code', {
        'success': 'geo-weighted-fusion',
        'error':   'geo-weighted-fusion',
      }, {
        'gatherResult': { 'resultField': 'candidate' },
      })

      .embed<CartographerState, CartographerState>('resolve-phone-source', 'geo-resolve-phone', {
        'success': 'geo-weighted-fusion',
        'error':   'geo-weighted-fusion',
      }, {
        'gatherResult': { 'resultField': 'candidate' },
      })

      .embed<CartographerState, CartographerState>('resolve-locale-source', 'geo-resolve-locale', {
        'success': 'geo-weighted-fusion',
        'error':   'geo-weighted-fusion',
      }, {
        'gatherResult': { 'resultField': 'candidate' },
      })

      .entrypoints({
        'coords':  'resolve-coords-source',
        'address': 'resolve-address-source',
        'ip':      'resolve-ip-source',
        'code':    'resolve-code-source',
        'phone':   'resolve-phone-source',
        'locale':  'resolve-locale-source',
      })

      // First-class gather barrier over all embedded resolver producers.
      .gather(
        'geo-weighted-fusion',
        ['coords', 'address', 'ip', 'code', 'phone', 'locale'],
        { 'strategy': 'geo-weighted-fusion' },
        {
          'success': 'resolved',
          'error':   'resolved',
          'empty':   'resolved',
        },
      )

      .terminal('resolved', { 'outcome': 'completed' })

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
