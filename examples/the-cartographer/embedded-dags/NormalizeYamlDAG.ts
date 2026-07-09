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
import { CARTOGRAPHER_IRIS } from '../cartographerIds.ts';

import type { CartographerState }    from '../CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

const NORMALIZE_YAML_DAG_IRI = CARTOGRAPHER_IRIS.dag.normalizeYaml;

export const normalizeYamlDAG: DAGType = new DAGBuilder(NORMALIZE_YAML_DAG_IRI, '1.0')

  .node(CARTOGRAPHER_IRIS.placementIri(NORMALIZE_YAML_DAG_IRI, 'normalize-yaml-map'), normalizeYaml, {
    'normalized': CARTOGRAPHER_IRIS.placementIri(NORMALIZE_YAML_DAG_IRI, 'normalized'),
  })

  .terminal(CARTOGRAPHER_IRIS.placementIri(NORMALIZE_YAML_DAG_IRI, 'normalized'), { outcome: 'completed' })

  .build();

export const normalizeYamlBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [normalizeYaml],
  'dags':  [normalizeYamlDAG],
};
// #endregion normalize-yaml-dag
