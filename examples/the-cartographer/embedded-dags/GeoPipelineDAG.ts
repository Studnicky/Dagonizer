/**
 * GeoPipelineDAG: the shared geo spine carved out as a standalone embeddable sub-DAG.
 *
 * Encapsulates the full geo routing logic so per-type pipeline DAGs embed a
 * single 'geo-pipeline' call instead of duplicating the three-node spine inline.
 *
 *   route-geo
 *     ├─has-geo──► apply-geo ──(normalize)──► resolved
 *     └─needs-geo─► validate-coords
 *                     ├─valid────► geo-resolve (embedded)
 *                     │             ├─success──► resolved
 *                     │             └─error────► resolved
 *                     └─rejected─► geo-resolve (embedded)
 *
 * route-geo routes 'has-geo' when the source pre-resolved geo (apply-geo
 * materialises GeoContext from carried geo, skipping the live lookup).
 * validate-coords classifies WGS-84 bounds. Out-of-range coords are NOT silently
 * dropped at a failed terminal — they flow into geo-resolve too, where the GPS
 * transport (OfflineGeo) captures the RangeError as a GeoErrorRecord on
 * state.errors and degrades gracefully. The fault rides as DATA through the
 * gather rather than vanishing. geo-resolve's nodes ship in geoResolveBundle.
 */

// #region geo-pipeline-dag
import { routeGeo } from '../nodes/routeGeo.ts';
import { applyGeo } from '../nodes/applyGeo.ts';
import { validateCoords } from '../nodes/validateCoords.ts';
import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

export const geoPipelineDAG: DAGType = new DAGBuilder('geo-pipeline', '1.0')

  // 1. route-geo: skip the geo lookup when the source pre-resolved location.
  .node('route-geo', routeGeo, {
    'has-geo':   'apply-geo',
    'needs-geo': 'validate-coords',
  })

  // 2. apply-geo (skip path): materialise GeoContext from carried geo.
  .node('apply-geo', applyGeo, {
    'normalize': 'resolved',
  })

  // 3. validate-coords (lookup path): WGS-84 bounds classification. Both valid
  //    and rejected coords flow into geo-resolve — rejected ones are NOT dropped;
  //    the GPS transport captures their RangeError as data and degrades.
  .node('validate-coords', validateCoords, {
    'valid':    'geo-resolve',
    'rejected': 'geo-resolve',
  })

  // 4. geo-resolve: embedded multi-modal geo-resolution sub-DAG.
  //    Writes state.geoContext + state.resolvedGeo + routing record.
  .embeddedDAG<CartographerState, CartographerState>('geo-resolve', 'geo-resolve', {
    'success': 'resolved',
    'error':   'resolved',
  }, {
    'inputs': {
      'raw':            'raw',
      'canonical':      'canonical',
      'routing':        'routing',
      // Inherit the parent's captured-error list so the geo nodes APPEND to it
      // (the output below maps the appended list back).
      'capturedErrors': 'capturedErrors',
    },
    'outputs': {
      'geoContext':     'geoContext',
      'resolvedGeo':    'resolvedGeo',
      'routing':        'routing',
      // Thread the geo nodes' captured errors back so they reach the clone state
      // the gather folds — errors flow as DATA across the embedded boundary.
      'capturedErrors': 'capturedErrors',
    },
  })

  // Terminals
  .terminal('resolved', { outcome: 'completed' })

  .build();

export const geoPipelineBundle: DispatcherBundleType<CartographerState, CartographerServices> = {
  'nodes': [routeGeo, applyGeo, validateCoords],
  'dags':  [geoPipelineDAG],
};
// #endregion geo-pipeline-dag
