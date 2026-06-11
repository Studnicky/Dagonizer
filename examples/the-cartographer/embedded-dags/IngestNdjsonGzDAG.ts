/**
 * IngestNdjsonGzDAG: per-format ingestion sub-DAG for gzip NDJSON sources.
 *
 * Composes the SHARED ingest nodes for the ndjson.gz format:
 *
 *   decompress → parse-ndjson → map-fields → coerce-types → validate-event → ingested
 *
 * Embedded by IngestSourceDAG when selectSource routes 'gz'.
 * validate-event writes state.ingestedEvents; the parent scatter's `append`
 * gather concatenates each source's ingestedEvents into state.ingestBuckets.
 *
 * Terminals: ingested (completed), rejected (failed — invalid gzip or no lines).
 */

// #region ingest-ndjson-gz-dag
import { decompress }    from '../nodes/ingest/decompress.ts';
import { parseNdjson }   from '../nodes/ingest/parseNdjson.ts';
import { mapFields }     from '../nodes/ingest/mapFields.ts';
import { coerceTypes }   from '../nodes/ingest/coerceTypes.ts';
import { validateEvent } from '../nodes/ingest/validateEvent.ts';
import type { CartographerState }    from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder }            from '@noocodex/dagonizer/builder';
import type { DAG }              from '@noocodex/dagonizer/entities';

export const ingestNdjsonGzDAG: DAG = new DAGBuilder('ingest-ndjson-gz', '1.0')

  // 1. decompress: gzip bytes → NDJSON text.
  .node('decompress', decompress, {
    'parse-ndjson': 'parse-ndjson',
    'invalid':      'rejected',
  })

  // 2. parse-ndjson: NDJSON text → records.
  .node('parse-ndjson', parseNdjson, {
    'map-fields': 'map-fields',
    'invalid':    'rejected',
  })

  // 3. map-fields: source field names → canonical names (per-source mapping).
  .node('map-fields', mapFields, {
    'coerce-types': 'coerce-types',
  })

  // 4. coerce-types: string cells → number / bool / epoch.
  .node('coerce-types', coerceTypes, {
    'validate-event': 'validate-event',
  })

  // 5. validate-event: build CanonicalEvents → state.ingestedEvents.
  .node('validate-event', validateEvent, {
    'validated': 'ingested',
  })

  // Terminals
  .terminal('ingested', { outcome: 'completed' })
  .terminal('rejected', { outcome: 'failed' })

  .build();

export const ingestNdjsonGzBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [decompress, parseNdjson, mapFields, coerceTypes, validateEvent],
  'dags':  [ingestNdjsonGzDAG],
};
// #endregion ingest-ndjson-gz-dag
