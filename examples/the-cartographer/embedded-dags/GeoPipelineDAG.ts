/**
 * GeoPipelineDAG: the shared geo spine carved out as a standalone embeddable sub-DAG.
 *
 * Encapsulates the full geo routing logic so per-type pipeline DAGs embed a
 * single 'geo-pipeline' call instead of duplicating the three-node spine inline.
 *
 *   route-geo
 *     ├─has-geo──► apply-geo ──(normalize)──► resolved
 *     └─needs-geo─► validate-coords
 *                     ├─valid────► geo-source-resolve (embedded)
 *                     │             ├─success──► resolved
 *                     │             └─error────► resolved
 *                     └─rejected─► geo-source-resolve (embedded)
 *
 * route-geo routes 'has-geo' when the source pre-resolved geo (apply-geo
 * materialises GeoContext from carried geo, skipping the live lookup).
 * validate-coords classifies WGS-84 bounds. Out-of-range coords are NOT silently
 * dropped at a failed terminal — they flow into geo-source-resolve too, where the
 * offline resolver (CoordTimezone) guards the out-of-range RangeError and returns
 * an empty timezone/country, so the resolution degrades to baseline rather than
 * the event vanishing.
 */

// #region geo-pipeline-dag
import { routeGeo } from '../nodes/routeGeo.ts';
import { applyGeo } from '../nodes/applyGeo.ts';
import { validateCoords } from '../nodes/validateCoords.ts';
import { CARTOGRAPHER_IRIS } from '../cartographerIds.ts';
import type { CartographerState } from '../CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

const GEO_PIPELINE_DAG_IRI = CARTOGRAPHER_IRIS.dag.geoPipeline;

export const geoPipelineDAG: DAGType = new DAGBuilder(GEO_PIPELINE_DAG_IRI, '1.0')

  // 1. route-geo: skip the geo lookup when the source pre-resolved location.
  .node(CARTOGRAPHER_IRIS.placementIri(GEO_PIPELINE_DAG_IRI, 'route-geo'), routeGeo, {
    'has-geo':   CARTOGRAPHER_IRIS.placementIri(GEO_PIPELINE_DAG_IRI, 'apply-geo'),
    'needs-geo': CARTOGRAPHER_IRIS.placementIri(GEO_PIPELINE_DAG_IRI, 'validate-coords'),
  })

  // 2. apply-geo (skip path): materialise GeoContext from carried geo.
  .node(CARTOGRAPHER_IRIS.placementIri(GEO_PIPELINE_DAG_IRI, 'apply-geo'), applyGeo, {
    'normalize': CARTOGRAPHER_IRIS.placementIri(GEO_PIPELINE_DAG_IRI, 'resolved'),
  })

  // 3. validate-coords (lookup path): WGS-84 bounds classification. Both valid
  //    and rejected coords flow into geo-source-resolve — rejected ones are NOT dropped;
  //    CoordTimezone guards their out-of-range RangeError and degrades to baseline.
  .node(CARTOGRAPHER_IRIS.placementIri(GEO_PIPELINE_DAG_IRI, 'validate-coords'), validateCoords, {
    'valid':    CARTOGRAPHER_IRIS.placementIri(GEO_PIPELINE_DAG_IRI, 'geo-source-resolve'),
    'rejected': CARTOGRAPHER_IRIS.placementIri(GEO_PIPELINE_DAG_IRI, 'geo-source-resolve'),
  })

  // 4. geo-source-resolve: embedded source-model geo-resolution sub-DAG.
  //    Writes state.geoContext + state.resolvedGeo + routing record.
  .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(GEO_PIPELINE_DAG_IRI, 'geo-source-resolve'), CARTOGRAPHER_IRIS.dag.geoSourceResolve, {
    'success': CARTOGRAPHER_IRIS.placementIri(GEO_PIPELINE_DAG_IRI, 'resolved'),
    'error':   CARTOGRAPHER_IRIS.placementIri(GEO_PIPELINE_DAG_IRI, 'resolved'),
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
  .terminal(CARTOGRAPHER_IRIS.placementIri(GEO_PIPELINE_DAG_IRI, 'resolved'), { outcome: 'completed' })

  .build();

export const geoPipelineBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [routeGeo, applyGeo, validateCoords],
  'dags':  [geoPipelineDAG],
};
// #endregion geo-pipeline-dag
