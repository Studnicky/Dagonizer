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
import { coerceTypes }    from '../nodes/ingest/coercion.ts';
import { validateEvent }  from '../nodes/ingest/validateEvent.ts';

import { normalizeCsvDAG }   from './NormalizeCsvDAG.ts';
import { normalizeJsonDAG }  from './NormalizeJsonDAG.ts';
import { normalizeNdjsonDAG } from './NormalizeNdjsonDAG.ts';
import { normalizeYamlDAG }  from './NormalizeYamlDAG.ts';

import type { CartographerState }    from '../CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

const ingestSourceDagIri = 'urn:noocodec:dag:ingest-source' as const;
const normalizeCsvDagIri = 'urn:noocodec:dag:normalize-csv' as const;
const normalizeJsonDagIri = 'urn:noocodec:dag:normalize-json' as const;
const normalizeNdjsonDagIri = 'urn:noocodec:dag:normalize-ndjson' as const;
const normalizeYamlDagIri = 'urn:noocodec:dag:normalize-yaml' as const;
const placement = (placementIdentifier: string): string =>
  `${ingestSourceDagIri}/node/${placementIdentifier}`;

export const ingestSourceDAG: DAGType = new DAGBuilder(ingestSourceDagIri, '1.0')

  // 1. select-source: read source from scatter metadata; route by compression.
  .node(placement('select-source'), selectSource, {
    'compressed': placement('decompress'),
    'plain':      placement('route-format'),
    'invalid':    placement('rejected'),
  })

  // 2. decompress: base64-decode + gunzip → plain text in state.decodedText.
  //    Format-agnostic: any gzipped format passes through here to route-format.
  .node(placement('decompress'), decompress, {
    'route-format': placement('route-format'),
    'invalid':      placement('rejected'),
  })

  // 3. route-format: dispatch to the format-specific parser.
  .node(placement('route-format'), routeFormat, {
    'csv':     placement('parse-csv'),
    'json':    placement('parse-json'),
    'ndjson':  placement('parse-ndjson'),
    'yaml':    placement('parse-yaml'),
    'invalid': placement('rejected'),
  })

  // 4a. parse-csv: CSV text → state.parsedRecords.
  .node(placement('parse-csv'), parseCsv, {
    'normalized': placement('normalize-csv'),
    'invalid':    placement('rejected'),
  })

  // 4b. parse-json: JSON array → state.parsedRecords.
  .node(placement('parse-json'), parseJson, {
    'normalized': placement('normalize-json'),
    'invalid':    placement('rejected'),
  })

  // 4c. parse-ndjson: NDJSON text → state.parsedRecords.
  .node(placement('parse-ndjson'), parseNdjson, {
    'normalized': placement('normalize-ndjson'),
    'invalid':    placement('rejected'),
  })

  // 4d. parse-yaml: YAML sequence → state.parsedRecords.
  .node(placement('parse-yaml'), parseYaml, {
    'normalized': placement('normalize-yaml'),
    'invalid':    placement('rejected'),
  })

  // 5a. normalize-csv: embedded sub-DAG — apply FieldMap by header name.
  //     The FieldMap is name-keyed, so shuffled CSV column order aligns correctly.
  .embed<CartographerState, CartographerState>(placement('normalize-csv'), normalizeCsvDagIri, {
    'success': placement('coerce-types'),
    'error':   placement('rejected'),
  }, {
    // Embedded DAGs run in an isolated state clone: thread the parsed records
    // and the current source (for its mappingKey) IN, and the aligned records
    // back OUT, or the normalize node sees empty input and nothing merges back.
    'inputs':  { 'parsedRecords': 'parsedRecords', 'currentSource': 'currentSource' },
    'outputs': { 'mappedRecords': 'mappedRecords' },
  })

  // 5b. normalize-json: embedded sub-DAG — apply FieldMap by key name.
  .embed<CartographerState, CartographerState>(placement('normalize-json'), normalizeJsonDagIri, {
    'success': placement('coerce-types'),
    'error':   placement('rejected'),
  }, {
    // Embedded DAGs run in an isolated state clone: thread the parsed records
    // and the current source (for its mappingKey) IN, and the aligned records
    // back OUT, or the normalize node sees empty input and nothing merges back.
    'inputs':  { 'parsedRecords': 'parsedRecords', 'currentSource': 'currentSource' },
    'outputs': { 'mappedRecords': 'mappedRecords' },
  })

  // 5c. normalize-ndjson: embedded sub-DAG — apply FieldMap by key name.
  .embed<CartographerState, CartographerState>(placement('normalize-ndjson'), normalizeNdjsonDagIri, {
    'success': placement('coerce-types'),
    'error':   placement('rejected'),
  }, {
    // Embedded DAGs run in an isolated state clone: thread the parsed records
    // and the current source (for its mappingKey) IN, and the aligned records
    // back OUT, or the normalize node sees empty input and nothing merges back.
    'inputs':  { 'parsedRecords': 'parsedRecords', 'currentSource': 'currentSource' },
    'outputs': { 'mappedRecords': 'mappedRecords' },
  })

  // 5d. normalize-yaml: embedded sub-DAG — apply FieldMap by key name.
  .embed<CartographerState, CartographerState>(placement('normalize-yaml'), normalizeYamlDagIri, {
    'success': placement('coerce-types'),
    'error':   placement('rejected'),
  }, {
    // Embedded DAGs run in an isolated state clone: thread the parsed records
    // and the current source (for its mappingKey) IN, and the aligned records
    // back OUT, or the normalize node sees empty input and nothing merges back.
    'inputs':  { 'parsedRecords': 'parsedRecords', 'currentSource': 'currentSource' },
    'outputs': { 'mappedRecords': 'mappedRecords' },
  })

  // 6. coerce-types: string cells → number / bool / epoch. Shared tail.
  .node(placement('coerce-types'), coerceTypes, {
    'validate-event': placement('validate-event'),
  })

  // 7. validate-event: build CanonicalEvents → state.ingestedEvents. Shared tail.
  .node(placement('validate-event'), validateEvent, {
    'validated': placement('ingested'),
  })

  // Terminals
  .terminal(placement('ingested'), { outcome: 'completed' })
  .terminal(placement('rejected'), { outcome: 'failed' })

  .build();

export const ingestSourceBundle: DispatcherBundleType<CartographerState> = {
  // Normalize DAGs registered FIRST so the embedded-DAG placements above resolve.
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
