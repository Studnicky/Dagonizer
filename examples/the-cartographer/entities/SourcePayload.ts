/**
 * SourcePayload: one heterogeneous-format source feed placed on state before
 * ingestion. The generator emits a small fixed list of these (one per source);
 * each carries an on-the-wire `payload` in its native `format`.
 *
 * Formats (≥3 real encodings, per §B0.2):
 *   - 'json'      — a JSON array string (position-pings; RICH, may carry geo)
 *   - 'csv'       — a CSV string, header + rows (facility-scans; RAW PII)
 *   - 'ndjson.gz' — base64 of gzip(NDJSON) bytes (sensor-readings; cold-chain)
 *   - 'json'/'csv' — customs/delivery (customs-events + delivery-confirmations)
 *
 * Gzip bytes are carried base64-encoded so the payload stays a JSON-safe string
 * (state must round-trip through snapshot/restore as JSON); the `decompress`
 * node base64-decodes via atob then decompresses via the Web Streams
 * DecompressionStream API ('gzip'), compatible with Node 18+ and browsers.
 *
 * `mappingKey` selects the per-source field-name → canonical-field mapping the
 * shared `map-fields` node applies (parameterised ingestion, not a monolith).
 */

// #region source-payload-entity
import type { FromSchema } from 'json-schema-to-ts';

export const SourcePayloadSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/SourcePayload',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['sourceId', 'format', 'mappingKey', 'kind', 'payload'],
  'properties': {
    'sourceId':   { 'type': 'string', 'minLength': 1 },
    'format':     { 'type': 'string', 'enum': ['json', 'csv', 'ndjson.gz'] },
    'mappingKey': { 'type': 'string', 'minLength': 1 },
    'kind': {
      'type': 'string',
      'enum': ['position-ping', 'facility-scan', 'sensor-reading', 'customs-event', 'delivery-confirmation'],
    },
    'payload':    { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

export type SourcePayload = FromSchema<typeof SourcePayloadSchema>;
// #endregion source-payload-entity
