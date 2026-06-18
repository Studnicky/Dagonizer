/**
 * NormalizeYamlDAG: per-format normalization sub-DAG for YAML sources.
 *
 * A single-node DAG that maps parsed YAML records (state.parsedRecords) through
 * the source's FieldMap by key name, writing state.mappedRecords.
 *
 *   normalize-yaml-map → normalized  (TerminalNode completed)
 *
 * Embedded in ingest-source between parse-yaml and coerce-types:
 *   parse-yaml → { normalized: 'normalize-yaml' } → coerce-types
 */

// #region normalize-yaml-dag
import { normalizeYaml } from '../nodes/ingest/normalizeYaml.ts';

import type { CartographerState }    from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DAG, DispatcherBundle } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

export const normalizeYamlDAG: DAG = new DAGBuilder('normalize-yaml', '1.0')

  .node('normalize-yaml-map', normalizeYaml, {
    'normalized': 'normalized',
  })

  .terminal('normalized', { outcome: 'completed' })

  .build();

export const normalizeYamlBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [normalizeYaml],
  'dags':  [normalizeYamlDAG],
};
// #endregion normalize-yaml-dag
