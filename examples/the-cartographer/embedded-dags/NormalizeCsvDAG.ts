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

import type { CartographerState }    from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DAG, DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer';

export const normalizeCsvDAG: DAG = new DAGBuilder('normalize-csv', '1.0')

  .node('normalize-csv-map', normalizeCsv, {
    'normalized': 'normalized',
  })

  .terminal('normalized', { outcome: 'completed' })

  .build();

export const normalizeCsvBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [normalizeCsv],
  'dags':  [normalizeCsvDAG],
};
// #endregion normalize-csv-dag
