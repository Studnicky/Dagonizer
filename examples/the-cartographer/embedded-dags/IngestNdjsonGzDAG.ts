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
import { DecompressNode }    from '../nodes/ingest/decompress.ts';
import { ParseNdjsonNode }   from '../nodes/ingest/parseNdjson.ts';
import { MapFieldsNode }     from '../nodes/ingest/mapFields.ts';
import { CoerceTypesNode }   from '../nodes/ingest/coerceTypes.ts';
import { ValidateEventNode } from '../nodes/ingest/validateEvent.ts';
import type { CartographerState }    from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer';
import type { DAG }              from '@noocodex/dagonizer/entities';

export const ingestNdjsonGzDAG: DAG = new DAGBuilder('ingest-ndjson-gz', '1.0')

  // 1. decompress: gzip bytes → NDJSON text.
  .node('decompress', new DecompressNode(), {
    'parse-ndjson': 'parse-ndjson',
    'invalid':      'rejected',
  })

  // 2. parse-ndjson: NDJSON text → records.
  .node('parse-ndjson', new ParseNdjsonNode(), {
    'map-fields': 'map-fields',
    'invalid':    'rejected',
  })

  // 3. map-fields: source field names → canonical names (per-source mapping).
  .node('map-fields', new MapFieldsNode(), {
    'coerce-types': 'coerce-types',
  })

  // 4. coerce-types: string cells → number / bool / epoch.
  .node('coerce-types', new CoerceTypesNode(), {
    'validate-event': 'validate-event',
  })

  // 5. validate-event: build CanonicalEvents → state.ingestedEvents.
  .node('validate-event', new ValidateEventNode(), {
    'validated': 'ingested',
  })

  // Terminals
  .terminal('ingested', { outcome: 'completed' })
  .terminal('rejected', { outcome: 'failed' })

  .build();

export const ingestNdjsonGzBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [new DecompressNode(), new ParseNdjsonNode(), new MapFieldsNode(), new CoerceTypesNode(), new ValidateEventNode()],
  'dags':  [ingestNdjsonGzDAG],
};
// #endregion ingest-ndjson-gz-dag
