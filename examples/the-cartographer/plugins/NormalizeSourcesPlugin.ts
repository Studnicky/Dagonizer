/**
 * NormalizeSourcesPlugin: plugin-packaged source normalization DAGs for the
 * Cartographer ingest pipeline.
 *
 * IngestSourceDAG embeds normalize-csv / normalize-json / normalize-ndjson /
 * normalize-yaml by DAG IRI. The plugin registers those child DAGs and their
 * nodes through the same dispatcher registry used by direct bundles.
 */

// #region cartographer-normalize-plugin
import { defineDagonizerPlugin } from '@studnicky/dagonizer/plugin';

import { normalizeCsv } from '../nodes/ingest/normalizeCsv.ts';
import { normalizeJson } from '../nodes/ingest/normalizeJson.ts';
import { normalizeNdjson } from '../nodes/ingest/normalizeNdjson.ts';
import { normalizeYaml } from '../nodes/ingest/normalizeYaml.ts';
import { normalizeCsvDAG } from '../embedded-dags/NormalizeCsvDAG.ts';
import { normalizeJsonDAG } from '../embedded-dags/NormalizeJsonDAG.ts';
import { normalizeNdjsonDAG } from '../embedded-dags/NormalizeNdjsonDAG.ts';
import { normalizeYamlDAG } from '../embedded-dags/NormalizeYamlDAG.ts';
import { CARTOGRAPHER_IRIS } from '../cartographerIds.ts';

export const normalizeSourcesPlugin = defineDagonizerPlugin({
  'id': '@studnicky/dagonizer-cartographer-normalize-sources',
  'context': {
    'plugin': 'urn:noocodec:dagonizer:cartographer:normalize-sources',
  },
  'nodes': [
    normalizeCsv,
    normalizeJson,
    normalizeNdjson,
    normalizeYaml,
  ],
  'dags': [
    normalizeCsvDAG,
    normalizeJsonDAG,
    normalizeNdjsonDAG,
    normalizeYamlDAG,
  ],
  'exports': {
    'csv':    CARTOGRAPHER_IRIS.dag.normalizeCsv,
    'json':   CARTOGRAPHER_IRIS.dag.normalizeJson,
    'ndjson': CARTOGRAPHER_IRIS.dag.normalizeNdjson,
    'yaml':   CARTOGRAPHER_IRIS.dag.normalizeYaml,
  },
});
// #endregion cartographer-normalize-plugin
