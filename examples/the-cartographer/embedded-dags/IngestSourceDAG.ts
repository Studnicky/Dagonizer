/**
 * IngestSourceDAG: thin per-source router — the scatter body of the top-level
 * ingestion fan-in. One run per source feed; routes by format to the correct
 * per-format embedded sub-DAG, then threads state.ingestedEvents back to the
 * parent so the `append` gather works.
 *
 *   select-source ─(json)──► [ingest-json]      ──► ingested
 *                 ─(csv)───► [ingest-csv]        ──► ingested
 *                 ─(gz)────► [ingest-ndjson-gz]  ──► ingested
 *                 ─(invalid)──────────────────────► rejected
 *
 * Each embedded sub-DAG composes the SHARED ingest nodes for its format and
 * ends at its own `ingested` terminal. The output mapping threads
 * state.ingestedEvents back so the parent scatter's `append` gather
 * concatenates each source bucket into state.ingestBuckets.
 *
 * Terminals: ingested (completed), rejected (failed — unselectable / bad payload).
 */

// #region ingest-source-dag
import { SelectSourceNode } from '../nodes/ingest/selectSource.ts';
import { DecompressNode }   from '../nodes/ingest/decompress.ts';
import { ParseCsvNode }     from '../nodes/ingest/parseCsv.ts';
import { ParseJsonNode }    from '../nodes/ingest/parseJson.ts';
import { ParseNdjsonNode }  from '../nodes/ingest/parseNdjson.ts';
import { MapFieldsNode }    from '../nodes/ingest/mapFields.ts';
import { CoerceTypesNode }  from '../nodes/ingest/coerceTypes.ts';
import { ValidateEventNode } from '../nodes/ingest/validateEvent.ts';

import { ingestJsonDAG }     from './IngestJsonDAG.ts';
import { ingestCsvDAG }      from './IngestCsvDAG.ts';
import { ingestNdjsonGzDAG } from './IngestNdjsonGzDAG.ts';

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DAG, DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer';

export const ingestSourceDAG: DAG = new DAGBuilder('ingest-source', '1.0')

  // 1. select-source: read source feed from metadata; route by format.
  .node('select-source', new SelectSourceNode(), {
    'json':    'json',
    'csv':     'csv',
    'gz':      'gz',
    'invalid': 'rejected',
  })

  // 2a. json: embedded sub-DAG for JSON array sources.
  .embeddedDAG<CartographerState, CartographerState>('json', 'ingest-json', {
    'success': 'ingested',
    'error':   'rejected',
  }, {
    'outputs': {
      'ingestedEvents': 'ingestedEvents',
    },
  })

  // 2b. csv: embedded sub-DAG for CSV sources.
  .embeddedDAG<CartographerState, CartographerState>('csv', 'ingest-csv', {
    'success': 'ingested',
    'error':   'rejected',
  }, {
    'outputs': {
      'ingestedEvents': 'ingestedEvents',
    },
  })

  // 2c. gz: embedded sub-DAG for gzip NDJSON sources.
  .embeddedDAG<CartographerState, CartographerState>('gz', 'ingest-ndjson-gz', {
    'success': 'ingested',
    'error':   'rejected',
  }, {
    'outputs': {
      'ingestedEvents': 'ingestedEvents',
    },
  })

  // Terminals
  .terminal('ingested', { outcome: 'completed' })
  .terminal('rejected', { outcome: 'failed' })

  .build();

export const ingestSourceBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  // All unique ingest nodes: select-source (router) + all format-specific parse nodes
  // + the shared transform nodes (map-fields, coerce-types, validate-event).
  // Register this bundle as the single ingest registration point. Do NOT also register
  // the per-format bundles (IngestJsonDAG, IngestCsvDAG, IngestNdjsonGzDAG) — they
  // share map-fields / coerce-types / validate-event and would cause duplicate-node errors.
  'nodes': [new SelectSourceNode(), new DecompressNode(), new ParseCsvNode(), new ParseJsonNode(), new ParseNdjsonNode(), new MapFieldsNode(), new CoerceTypesNode(), new ValidateEventNode()],
  // Format sub-DAGs must be registered before ingest-source (which embeds them).
  'dags':  [ingestJsonDAG, ingestCsvDAG, ingestNdjsonGzDAG, ingestSourceDAG],
};
// #endregion ingest-source-dag
