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

import type { CartographerState }    from '../CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

export const normalizeJsonDAG: DAGType = new DAGBuilder('normalize-json', '1.0')

  .node('normalize-json-map', normalizeJson, {
    'normalized': 'normalized',
  })

  .terminal('normalized', { outcome: 'completed' })

  .build();

export const normalizeJsonBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [normalizeJson],
  'dags':  [normalizeJsonDAG],
};
// #endregion normalize-json-dag
