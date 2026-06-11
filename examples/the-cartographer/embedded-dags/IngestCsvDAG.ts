/**
 * IngestCsvDAG: per-format ingestion sub-DAG for CSV sources.
 *
 * Composes the SHARED ingest nodes for the CSV format:
 *
 *   parse-csv → map-fields → coerce-types → validate-event → ingested
 *
 * Embedded by IngestSourceDAG when selectSource routes 'csv'.
 * validate-event writes state.ingestedEvents; the parent scatter's `append`
 * gather concatenates each source's ingestedEvents into state.ingestBuckets.
 *
 * Terminals: ingested (completed), rejected (failed — no header row).
 */

// #region ingest-csv-dag
import { parseCsv }      from '../nodes/ingest/parseCsv.ts';
import { mapFields }     from '../nodes/ingest/mapFields.ts';
import { coerceTypes }   from '../nodes/ingest/coerceTypes.ts';
import { validateEvent } from '../nodes/ingest/validateEvent.ts';
import type { CartographerState }    from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder }            from '@noocodex/dagonizer/builder';
import type { DAG }              from '@noocodex/dagonizer/entities';

export const ingestCsvDAG: DAG = new DAGBuilder('ingest-csv', '1.0')

  // 1. parse-csv: CSV text → records.
  .node('parse-csv', parseCsv, {
    'map-fields': 'map-fields',
    'invalid':    'rejected',
  })

  // 2. map-fields: source field names → canonical names (per-source mapping).
  .node('map-fields', mapFields, {
    'coerce-types': 'coerce-types',
  })

  // 3. coerce-types: string cells → number / bool / epoch.
  .node('coerce-types', coerceTypes, {
    'validate-event': 'validate-event',
  })

  // 4. validate-event: build CanonicalEvents → state.ingestedEvents.
  .node('validate-event', validateEvent, {
    'validated': 'ingested',
  })

  // Terminals
  .terminal('ingested', { outcome: 'completed' })
  .terminal('rejected', { outcome: 'failed' })

  .build();

export const ingestCsvBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [parseCsv, mapFields, coerceTypes, validateEvent],
  'dags':  [ingestCsvDAG],
};
// #endregion ingest-csv-dag
