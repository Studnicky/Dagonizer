/**
 * NormalizeCsvDAG: per-format normalization sub-DAG for CSV sources.
 *
 * A single-node DAG that maps parsed CSV records (state.parsedRecords) through
 * the source's FieldMap by HEADER NAME, writing state.mappedRecords. Because
 * CSV column order may be shuffled intentionally, the normalize node aligns by
 * header name — the FieldMap keys are source header names, not positions.
 *
 *   normalize-csv-map → normalized  (TerminalNode completed)
 *
 * Embedded in ingest-source between parse-csv and coerce-types:
 *   parse-csv → { normalized: 'normalize-csv' } → coerce-types
 */

// #region normalize-csv-dag
import { normalizeCsv } from '../nodes/ingest/normalizeCsv.ts';
import { CARTOGRAPHER_IRIS } from '../cartographerIds.ts';

import type { CartographerState }    from '../CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

const NORMALIZE_CSV_DAG_IRI = CARTOGRAPHER_IRIS.dag.normalizeCsv;

export const normalizeCsvDAG: DAGType = new DAGBuilder(NORMALIZE_CSV_DAG_IRI, '1.0')

  .node(CARTOGRAPHER_IRIS.placementIri(NORMALIZE_CSV_DAG_IRI, 'normalize-csv-map'), normalizeCsv, {
    'normalized': CARTOGRAPHER_IRIS.placementIri(NORMALIZE_CSV_DAG_IRI, 'normalized'),
  })

  .terminal(CARTOGRAPHER_IRIS.placementIri(NORMALIZE_CSV_DAG_IRI, 'normalized'), { outcome: 'completed' })

  .build();

export const normalizeCsvBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [normalizeCsv],
  'dags':  [normalizeCsvDAG],
};
// #endregion normalize-csv-dag
