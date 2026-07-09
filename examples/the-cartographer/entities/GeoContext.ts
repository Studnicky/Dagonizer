/**
 * GeoContext: the geo-enrichment result for a scan location.
 *
 * Produced by the geo-grid → geo-context node pair. The `gridZone` is the
 * UTM-style zone key (e.g. "10S") that keys into the lookup table.
 * `status` indicates whether the grid zone maps to land, water, coastal,
 * or is unmapped (no entry in the table). `waterBodies` carries ocean/sea
 * names when status is 'water' or 'coastal'.
 *
 * Location also drives time and privacy:
 *   - `timezone`: IANA zone for the scan coords (via tz-lookup). Cross-zone
 *     journeys show different local times/offsets per scan.
 *   - `jurisdiction`: the privacy regime governing this scan's location
 *     (GDPR / UK-GDPR / CCPA / LGPD / APPI / baseline / international-waters).
 *     A border-crossing journey changes jurisdiction mid-path; a maritime ping
 *     over the high seas resolves to `international-waters` (no regional regime).
 */

// #region geo-context-entity
import type { FromSchema } from 'json-schema-to-ts';

export const GeoContextSchema = {
  '$id': 'https://noocodec.dev/schemas/cartographer/GeoContext',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['gridZone', 'country', 'continent', 'countries', 'region', 'hub', 'status', 'waterBodies', 'timezone', 'jurisdiction'],
  'properties': {
    'gridZone':   { 'type': 'string', 'minLength': 1 },
    'country':    { 'type': 'string', 'minLength': 1 },
    // Macro continent (from a real API) — the insights table buckets by this.
    'continent':  { 'type': 'string', 'minLength': 1 },
    'countries':  { 'type': 'array', 'items': { 'type': 'string' } },
    'region':     { 'type': 'string', 'minLength': 1 },
    'hub':        { 'type': 'string', 'minLength': 1 },
    'status':     { 'type': 'string', 'enum': ['land', 'water', 'coastal', 'unmapped'] },
    'waterBodies': { 'type': 'array', 'items': { 'type': 'string' } },
    'timezone':     { 'type': 'string', 'minLength': 1 },
    'jurisdiction': { 'type': 'string', 'enum': ['GDPR', 'UK-GDPR', 'CCPA', 'LGPD', 'APPI', 'baseline', 'international-waters'] },
  },
  'additionalProperties': false,
} as const;

export type GeoContext = FromSchema<typeof GeoContextSchema>;
// #endregion geo-context-entity
