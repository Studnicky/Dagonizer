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
import { ParseJsonNode }     from '../nodes/ingest/parseJson.ts';
import { MapFieldsNode }     from '../nodes/ingest/mapFields.ts';
import { CoerceTypesNode }   from '../nodes/ingest/coerceTypes.ts';
import { ValidateEventNode } from '../nodes/ingest/validateEvent.ts';
import type { CartographerState }    from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer';
import type { DAG }              from '@noocodex/dagonizer/entities';

export const ingestJsonDAG: DAG = new DAGBuilder('ingest-json', '1.0')

  // 1. parse-json: JSON array text → records.
  .node('parse-json', new ParseJsonNode(), {
    'map-fields': 'map-fields',
    'invalid':    'rejected',
  })

  // 2. map-fields: source field names → canonical names (per-source mapping).
  .node('map-fields', new MapFieldsNode(), {
    'coerce-types': 'coerce-types',
  })

  // 3. coerce-types: string cells → number / bool / epoch.
  .node('coerce-types', new CoerceTypesNode(), {
    'validate-event': 'validate-event',
  })

  // 4. validate-event: build CanonicalEvents → state.ingestedEvents.
  .node('validate-event', new ValidateEventNode(), {
    'validated': 'ingested',
  })

  // Terminals
  .terminal('ingested', { outcome: 'completed' })
  .terminal('rejected', { outcome: 'failed' })

  .build();

export const ingestJsonBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [new ParseJsonNode(), new MapFieldsNode(), new CoerceTypesNode(), new ValidateEventNode()],
  'dags':  [ingestJsonDAG],
};
// #endregion ingest-json-dag
