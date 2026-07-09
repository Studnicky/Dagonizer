/**
 * NormalizeJsonDAG: per-format normalization sub-DAG for JSON sources.
 *
 * A single-node DAG that maps parsed JSON records (state.parsedRecords) through
 * the source's FieldMap by key name, writing state.mappedRecords.
 *
 *   normalize-json-map → normalized  (TerminalNode completed)
 *
 * Embedded in ingest-source between parse-json and coerce-types:
 *   parse-json → { normalized: 'normalize-json' } → coerce-types
 */

// #region normalize-json-dag
import { normalizeJson } from '../nodes/ingest/normalizeJson.ts';
import { CARTOGRAPHER_IRIS } from '../cartographerIds.ts';

import type { CartographerState }    from '../CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

const NORMALIZE_JSON_DAG_IRI = CARTOGRAPHER_IRIS.dag.normalizeJson;

export const normalizeJsonDAG: DAGType = new DAGBuilder(NORMALIZE_JSON_DAG_IRI, '1.0')

  .node(CARTOGRAPHER_IRIS.placementIri(NORMALIZE_JSON_DAG_IRI, 'normalize-json-map'), normalizeJson, {
    'normalized': CARTOGRAPHER_IRIS.placementIri(NORMALIZE_JSON_DAG_IRI, 'normalized'),
  })

  .terminal(CARTOGRAPHER_IRIS.placementIri(NORMALIZE_JSON_DAG_IRI, 'normalized'), { outcome: 'completed' })

  .build();

export const normalizeJsonBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [normalizeJson],
  'dags':  [normalizeJsonDAG],
};
// #endregion normalize-json-dag
