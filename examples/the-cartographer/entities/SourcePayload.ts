/**
 * SourcePayload: one heterogeneous-format source feed placed on state before
 * ingestion. The generator emits one payload per configured feed entry; each
 * carries an on-the-wire `payload` in its native `format` with orthogonal
 * `compression`.
 *
 * Formats:
 *   - 'json'   — a JSON array string
 *   - 'csv'    — a CSV string, header + rows
 *   - 'ndjson' — newline-delimited JSON (one object per line)
 *   - 'yaml'   — a YAML sequence of mappings
 *
 * Compression is orthogonal to format:
 *   - 'none'  — payload is the raw encoded text
 *   - 'gzip'  — payload is base64(gzip(text)); the `decompress` node
 *               base64-decodes via atob then decompresses via the Web Streams
 *               DecompressionStream API ('gzip'), compatible with Node 18+ and
 *               browsers.
 *
 * `mappingKey` selects the per-source field-name → canonical-field mapping the
 * format-specific normalize nodes apply (parameterised ingestion, not a monolith).
 */

// #region source-payload-entity
import type { FromSchema } from 'json-schema-to-ts';

export const SourcePayloadSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/SourcePayload',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['sourceId', 'format', 'compression', 'mappingKey', 'eventType', 'payload'],
  'properties': {
    'sourceId':     { 'type': 'string', 'minLength': 1 },
    'format':       { 'type': 'string', 'enum': ['csv', 'json', 'ndjson', 'yaml'] },
    'compression':  { 'type': 'string', 'enum': ['none', 'gzip'] },
    'mappingKey':   { 'type': 'string', 'minLength': 1 },
    'eventType': {
      'type': 'string',
      'enum': ['position-ping', 'facility-scan', 'sensor-reading', 'customs-event', 'delivery-confirmation'],
    },
    'payload':      { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

export type SourcePayload = FromSchema<typeof SourcePayloadSchema>;
// #endregion source-payload-entity
