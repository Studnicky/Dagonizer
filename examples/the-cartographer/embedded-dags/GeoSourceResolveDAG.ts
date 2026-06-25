/**
 * GeoSourceResolveDAG: validity-gated weighted scatter/gather geo-resolution sub-DAG.
 *
 * Scores all present, valid geo signals on the canonical event body, then fans
 * out one `resolve-one-signal` clone per signal. The `geo-weighted-fusion` gather
 * folds all resolved candidates by weight into `state.resolvedGeo`, `state.geoContext`,
 * and `state.routing.{geoConfidence,geoModalities}`. When no signals score (empty
 * source array), the engine skips the gather and routes to `geo-baseline` instead,
 * which writes the same baseline values directly.
 *
 * Topology:
 *   score-signals
 *     └─scored──► resolve-signals (scatter over state.geoSignals)
 *                   resolve-one-signal (inner DAG):
 *                     route-signal → {resolve-coords, resolve-address, resolve-ip,
 *                                     resolve-code, resolve-phone, resolve-locale,
 *                                     resolve-none} → done
 *                   ├─all-success──► resolved
 *                   ├─partial──────► resolved
 *                   ├─all-error────► resolved
 *                   └─empty────────► geo-baseline
 *                                        └─baselined──► resolved
 *   resolved: terminal (completed)
 *
 * DI: `ipGeolocator` and `addressGeocoder` are injected per-call so each
 * dispatcher (main thread, worker thread) owns its own transport instances.
 */

// #region geo-source-resolve-dag
import { scoreSignals } from '../nodes/geo/scoreSignals.ts';
import { routeSignal } from '../nodes/geo/routeSignal.ts';
import { resolveCoords } from '../nodes/geo/resolveCoords.ts';
import { resolveLocale } from '../nodes/geo/resolveLocale.ts';
import { resolveCode } from '../nodes/geo/resolveCode.ts';
import { resolvePhone } from '../nodes/geo/resolvePhone.ts';
import { resolveNone } from '../nodes/geo/resolveNone.ts';
import { ResolveIpNode } from '../nodes/geo/resolveIp.ts';
import { ResolveAddressNode } from '../nodes/geo/resolveAddress.ts';
import { geoBaseline } from '../nodes/geo/geoBaseline.ts';
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

    // Inner scatter-body sub-DAG: routes each signal to its resolver node.
    const resolveOneSignalDag = new DAGBuilder('resolve-one-signal', '1.0')
      .node('route-signal', routeSignal, {
        'coords':  'resolve-coords',
        'address': 'resolve-address',
        'ip':      'resolve-ip',
        'code':    'resolve-code',
        'phone':   'resolve-phone',
        'locale':  'resolve-locale',
        'none':    'resolve-none',
      })
      .node('resolve-coords',  resolveCoords,  { 'resolved': 'done' })
      .node('resolve-address', resolveAddress, { 'resolved': 'done' })
      .node('resolve-ip',      resolveIp,      { 'resolved': 'done' })
      .node('resolve-code',    resolveCode,    { 'resolved': 'done' })
      .node('resolve-phone',   resolvePhone,   { 'resolved': 'done' })
      .node('resolve-locale',  resolveLocale,  { 'resolved': 'done' })
      .node('resolve-none',    resolveNone,    { 'resolved': 'done' })
      .terminal('done', { 'outcome': 'completed' })
      .build();

    const dag = new DAGBuilder('geo-source-resolve', '1.0')

      // 1. score-signals: emit one GeoSignalDescriptor per valid signal modality.
      .node('score-signals', scoreSignals, {
        'scored': 'resolve-signals',
      })

      // 2. resolve-signals: scatter over state.geoSignals — one clone per descriptor.
      //    Each clone runs resolve-one-signal; the geo-weighted-fusion gather folds
      //    all candidates back by weight. Empty source routes to geo-baseline.
      .scatter(
        'resolve-signals',
        'geoSignals',
        { 'dag': 'resolve-one-signal' },
        {
          'all-success': 'resolved',
          'partial':     'resolved',
          'all-error':   'resolved',
          'empty':       'geo-baseline',
        },
        {
          'itemKey': 'geo-signal',
          'gather':  { 'strategy': 'geo-weighted-fusion' },
        },
      )

      // 3. geo-baseline: writes the empty-resolution baseline when scatter was empty.
      .node('geo-baseline', geoBaseline, {
        'baselined': 'resolved',
      })

      .terminal('resolved', { 'outcome': 'completed' })

      .build();

    return {
      'nodes': [
        scoreSignals,
        routeSignal,
        resolveCoords,
        resolveAddress,
        resolveIp,
        resolveCode,
        resolvePhone,
        resolveLocale,
        resolveNone,
        geoBaseline,
      ],
      'dags': [resolveOneSignalDag, dag],
    };
  }
}
// #endregion geo-source-resolve-dag
