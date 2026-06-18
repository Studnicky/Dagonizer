/**
 * IngestSourceDAG: orthogonal-compression, per-format-normalize ingestion DAG.
 *
 * Compression is a pre-step independent of format; each format has its own
 * parse node and normalization sub-DAG; all converge on the shared coerce/validate tail.
 *
 *   select-source ─compressed──► decompress ──► route-format
 *                 ─plain─────────────────────► route-format
 *                 ─invalid──────────────────────────────────► rejected
 *
 *   route-format ─csv────► parse-csv    ► [normalize-csv]    ─┐
 *                ─json───► parse-json   ► [normalize-json]   ─┤
 *                ─ndjson─► parse-ndjson ► [normalize-ndjson] ─┤─► coerce-types ─► validate-event ─► ingested
 *                ─yaml───► parse-yaml   ► [normalize-yaml]   ─┘
 *                ─invalid──────────────────────────────────────► rejected
 *
 * Terminals: ingested (completed), rejected (failed — unselectable / bad payload).
 */

// #region ingest-source-dag
import { selectSource }   from '../nodes/ingest/selectSource.ts';
import { decompress }     from '../nodes/ingest/decompress.ts';
import { routeFormat }    from '../nodes/ingest/routeFormat.ts';
import { parseCsv }       from '../nodes/ingest/parseCsv.ts';
import { parseJson }      from '../nodes/ingest/parseJson.ts';
import { parseNdjson }    from '../nodes/ingest/parseNdjson.ts';
import { parseYaml }      from '../nodes/ingest/parseYaml.ts';
import { normalizeCsv }   from '../nodes/ingest/normalizeCsv.ts';
import { normalizeJson }  from '../nodes/ingest/normalizeJson.ts';
import { normalizeNdjson } from '../nodes/ingest/normalizeNdjson.ts';
import { normalizeYaml }  from '../nodes/ingest/normalizeYaml.ts';
import { coerceTypes }    from '../nodes/ingest/coerceTypes.ts';
import { validateEvent }  from '../nodes/ingest/validateEvent.ts';

import { normalizeCsvDAG }   from './NormalizeCsvDAG.ts';
import { normalizeJsonDAG }  from './NormalizeJsonDAG.ts';
import { normalizeNdjsonDAG } from './NormalizeNdjsonDAG.ts';
import { normalizeYamlDAG }  from './NormalizeYamlDAG.ts';

import type { CartographerState }    from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DAG, DispatcherBundle } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

export const ingestSourceDAG: DAG = new DAGBuilder('ingest-source', '1.0')

  // 1. select-source: read source from scatter metadata; route by compression.
  .node('select-source', selectSource, {
    'compressed': 'decompress',
    'plain':      'route-format',
    'invalid':    'rejected',
  })

  // 2. decompress: base64-decode + gunzip → plain text in state.decodedText.
  //    Format-agnostic: any gzipped format passes through here to route-format.
  .node('decompress', decompress, {
    'route-format': 'route-format',
    'invalid':      'rejected',
  })

  // 3. route-format: dispatch to the format-specific parser.
  .node('route-format', routeFormat, {
    'csv':    'parse-csv',
    'json':   'parse-json',
    'ndjson': 'parse-ndjson',
    'yaml':   'parse-yaml',
    'invalid': 'rejected',
  })

  // 4a. parse-csv: CSV text → state.parsedRecords.
  .node('parse-csv', parseCsv, {
    'normalized': 'normalize-csv',
    'invalid':    'rejected',
  })

  // 4b. parse-json: JSON array → state.parsedRecords.
  .node('parse-json', parseJson, {
    'normalized': 'normalize-json',
    'invalid':    'rejected',
  })

  // 4c. parse-ndjson: NDJSON text → state.parsedRecords.
  .node('parse-ndjson', parseNdjson, {
    'normalized': 'normalize-ndjson',
    'invalid':    'rejected',
  })

  // 4d. parse-yaml: YAML sequence → state.parsedRecords.
  .node('parse-yaml', parseYaml, {
    'normalized': 'normalize-yaml',
    'invalid':    'rejected',
  })

  // 5a. normalize-csv: embedded sub-DAG — apply FieldMap by header name.
  //     The FieldMap is name-keyed, so shuffled CSV column order aligns correctly.
  .embeddedDAG<CartographerState, CartographerState>('normalize-csv', 'normalize-csv', {
    'success': 'coerce-types',
    'error':   'rejected',
  }, {
    // Embedded DAGs run in an isolated state clone: thread the parsed records
    // and the current source (for its mappingKey) IN, and the aligned records
    // back OUT, or the normalize node sees empty input and nothing merges back.
    'inputs':  { 'parsedRecords': 'parsedRecords', 'currentSource': 'currentSource' },
    'outputs': { 'mappedRecords': 'mappedRecords' },
  })

  // 5b. normalize-json: embedded sub-DAG — apply FieldMap by key name.
  .embeddedDAG<CartographerState, CartographerState>('normalize-json', 'normalize-json', {
    'success': 'coerce-types',
    'error':   'rejected',
  }, {
    // Embedded DAGs run in an isolated state clone: thread the parsed records
    // and the current source (for its mappingKey) IN, and the aligned records
    // back OUT, or the normalize node sees empty input and nothing merges back.
    'inputs':  { 'parsedRecords': 'parsedRecords', 'currentSource': 'currentSource' },
    'outputs': { 'mappedRecords': 'mappedRecords' },
  })

  // 5c. normalize-ndjson: embedded sub-DAG — apply FieldMap by key name.
  .embeddedDAG<CartographerState, CartographerState>('normalize-ndjson', 'normalize-ndjson', {
    'success': 'coerce-types',
    'error':   'rejected',
  }, {
    // Embedded DAGs run in an isolated state clone: thread the parsed records
    // and the current source (for its mappingKey) IN, and the aligned records
    // back OUT, or the normalize node sees empty input and nothing merges back.
    'inputs':  { 'parsedRecords': 'parsedRecords', 'currentSource': 'currentSource' },
    'outputs': { 'mappedRecords': 'mappedRecords' },
  })

  // 5d. normalize-yaml: embedded sub-DAG — apply FieldMap by key name.
  .embeddedDAG<CartographerState, CartographerState>('normalize-yaml', 'normalize-yaml', {
    'success': 'coerce-types',
    'error':   'rejected',
  }, {
    // Embedded DAGs run in an isolated state clone: thread the parsed records
    // and the current source (for its mappingKey) IN, and the aligned records
    // back OUT, or the normalize node sees empty input and nothing merges back.
    'inputs':  { 'parsedRecords': 'parsedRecords', 'currentSource': 'currentSource' },
    'outputs': { 'mappedRecords': 'mappedRecords' },
  })

  // 6. coerce-types: string cells → number / bool / epoch. Shared tail.
  .node('coerce-types', coerceTypes, {
    'validate-event': 'validate-event',
  })

  // 7. validate-event: build CanonicalEvents → state.ingestedEvents. Shared tail.
  .node('validate-event', validateEvent, {
    'validated': 'ingested',
  })

  // Terminals
  .terminal('ingested', { outcome: 'completed' })
  .terminal('rejected', { outcome: 'failed' })

  .build();

export const ingestSourceBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  // Normalize DAGs registered FIRST so the embeddedDAG placements above resolve.
  'nodes': [
    selectSource, decompress, routeFormat,
    parseCsv, parseJson, parseNdjson, parseYaml,
    normalizeCsv, normalizeJson, normalizeNdjson, normalizeYaml,
    coerceTypes, validateEvent,
  ],
  'dags': [
    normalizeCsvDAG, normalizeJsonDAG, normalizeNdjsonDAG, normalizeYamlDAG,
    ingestSourceDAG,
  ],
};
// #endregion ingest-source-dag
