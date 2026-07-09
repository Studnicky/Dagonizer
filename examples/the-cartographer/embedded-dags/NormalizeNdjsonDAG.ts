/**
 * NormalizeNdjsonDAG: per-format normalization sub-DAG for NDJSON sources.
 *
 * A single-node DAG that maps parsed NDJSON records (state.parsedRecords) through
 * the source's FieldMap by key name, writing state.mappedRecords.
 *
 *   normalize-ndjson-map → normalized  (TerminalNode completed)
 *
 * Embedded in ingest-source between parse-ndjson and coerce-types:
 *   parse-ndjson → { normalized: 'normalize-ndjson' } → coerce-types
 */

// #region normalize-ndjson-dag
import { normalizeNdjson } from '../nodes/ingest/normalizeNdjson.ts';
import { CARTOGRAPHER_IRIS } from '../cartographerIds.ts';

import type { CartographerState }    from '../CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

const NORMALIZE_NDJSON_DAG_IRI = CARTOGRAPHER_IRIS.dag.normalizeNdjson;

export const normalizeNdjsonDAG: DAGType = new DAGBuilder(NORMALIZE_NDJSON_DAG_IRI, '1.0')

  .node(CARTOGRAPHER_IRIS.placementIri(NORMALIZE_NDJSON_DAG_IRI, 'normalize-ndjson-map'), normalizeNdjson, {
    'normalized': CARTOGRAPHER_IRIS.placementIri(NORMALIZE_NDJSON_DAG_IRI, 'normalized'),
  })

  .terminal(CARTOGRAPHER_IRIS.placementIri(NORMALIZE_NDJSON_DAG_IRI, 'normalized'), { outcome: 'completed' })

  .build();

export const normalizeNdjsonBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [normalizeNdjson],
  'dags':  [normalizeNdjsonDAG],
};
// #endregion normalize-ndjson-dag
