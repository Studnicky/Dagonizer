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

import type { CartographerState }    from '../CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

export const normalizeNdjsonDAG: DAGType = new DAGBuilder('normalize-ndjson', '1.0')

  .node('normalize-ndjson-map', normalizeNdjson, {
    'normalized': 'normalized',
  })

  .terminal('normalized', { outcome: 'completed' })

  .build();

export const normalizeNdjsonBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [normalizeNdjson],
  'dags':  [normalizeNdjsonDAG],
};
// #endregion normalize-ndjson-dag
