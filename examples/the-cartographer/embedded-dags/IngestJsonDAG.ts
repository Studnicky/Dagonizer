/**
 * IngestJsonDAG: per-format ingestion sub-DAG for JSON array sources.
 *
 * Composes the SHARED ingest nodes for the JSON format:
 *
 *   parse-json → map-fields → coerce-types → validate-event → ingested
 *
 * Embedded by IngestSourceDAG when selectSource routes 'json'.
 * validate-event writes state.ingestedEvents; the parent scatter's `append`
 * gather concatenates each source's ingestedEvents into state.ingestBuckets.
 *
 * Terminals: ingested (completed), rejected (failed — unparseable payload).
 */

// #region ingest-json-dag
import { parseJson }     from '../nodes/ingest/parseJson.ts';
import { mapFields }     from '../nodes/ingest/mapFields.ts';
import { coerceTypes }   from '../nodes/ingest/coerceTypes.ts';
import { validateEvent } from '../nodes/ingest/validateEvent.ts';
import type { CartographerState }    from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder }            from '@noocodex/dagonizer/builder';
import type { DAG }              from '@noocodex/dagonizer/entities';

export const ingestJsonDAG: DAG = new DAGBuilder('ingest-json', '1.0')

  // 1. parse-json: JSON array text → records.
  .node('parse-json', parseJson, {
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

export const ingestJsonBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [parseJson, mapFields, coerceTypes, validateEvent],
  'dags':  [ingestJsonDAG],
};
// #endregion ingest-json-dag
