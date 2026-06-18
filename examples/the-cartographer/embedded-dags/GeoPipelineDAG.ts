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
 *                     └─rejected──► rejected
 *
 * route-geo routes 'has-geo' when the source pre-resolved geo (apply-geo
 * materialises GeoContext from carried geo, skipping the live lookup).
 * validate-coords enforces WGS-84 bounds before delegating to geo-resolve.
 * geo-resolve's own nodes ship in geoResolveBundle, registered separately.
 */

// #region geo-pipeline-dag
import { routeGeo } from '../nodes/routeGeo.ts';
import { applyGeo } from '../nodes/applyGeo.ts';
import { validateCoords } from '../nodes/validateCoords.ts';
import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DAG, DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer';

export const geoPipelineDAG: DAG = new DAGBuilder('geo-pipeline', '1.0')

  // 1. route-geo: skip the geo lookup when the source pre-resolved location.
  .node('route-geo', routeGeo, {
    'has-geo':   'apply-geo',
    'needs-geo': 'validate-coords',
  })

  // 2. apply-geo (skip path): materialise GeoContext from carried geo.
  .node('apply-geo', applyGeo, {
    'normalize': 'resolved',
  })

  // 3. validate-coords (lookup path): WGS-84 bounds check on the scan coords.
  .node('validate-coords', validateCoords, {
    'valid':    'geo-resolve',
    'rejected': 'rejected',
  })

  // 4. geo-resolve: embedded multi-modal geo-resolution sub-DAG.
  //    Writes state.geoContext + state.resolvedGeo + routing record.
  .embeddedDAG<CartographerState, CartographerState>('geo-resolve', 'geo-resolve', {
    'success': 'resolved',
    'error':   'resolved',
  }, {
    'inputs': {
      'raw':       'raw',
      'canonical': 'canonical',
      'routing':   'routing',
    },
    'outputs': {
      'geoContext':  'geoContext',
      'resolvedGeo': 'resolvedGeo',
      'routing':     'routing',
    },
  })

  // Terminals
  .terminal('resolved', { outcome: 'completed' })
  .terminal('rejected', { outcome: 'failed' })

  .build();

export const geoPipelineBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [routeGeo, applyGeo, validateCoords],
  'dags':  [geoPipelineDAG],
};
// #endregion geo-pipeline-dag
