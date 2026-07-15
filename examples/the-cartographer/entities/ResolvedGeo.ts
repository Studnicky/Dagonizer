/**
 * ResolvedGeo: the final location output of the geo-source-resolve sub-DAG,
 * assembled by a layered-consensus node chain (`resolve-country-consensus` →
 * `verify-point-containment` → `assemble-resolved-geo`) from every resolved
 * signal candidate. All valid signal modalities are scored and resolved in
 * parallel; the chain groups candidates by agreement rather than crowning a
 * single highest-weight winner, verifies the best available point against the
 * consensus country, and writes this record.
 *
 * Fields:
 *   - country / countryName : ISO-2 code + human name (empty over open water).
 *   - region / locality     : subdivision + place name (back-filled from the
 *                             next-highest-weight candidate that AGREES with
 *                             the consensus country).
 *   - lat / lng             : the verified point (or consensus-country
 *                             centroid fallback when no point candidate
 *                             resolved).
 *   - status                : land | water | coastal (water → high seas).
 *   - jurisdiction          : privacy regime derived from the consensus
 *                             country (international-waters over open water,
 *                             baseline when no country resolved).
 *   - confidence            : a noisy-OR combination of the consensus group's
 *                             member weights (`1 - Π(1 - weight)`), so several
 *                             independent agreeing signals score higher than
 *                             one strong signal alone; reduced by 0.7× when
 *                             point verification found a conflicting country.
 *   - provenance            : contributing source kinds, ordered highest-weight
 *                             first, de-duplicated.
 *   - modalities            : 'gps' if any contributing source is 'coords';
 *                             'ip' if any is 'ip'.
 */

// #region resolved-geo-entity
import type { FromSchema } from 'json-schema-to-ts';

export const ResolvedGeoSchema = {
  '$id': 'https://noocodec.dev/schemas/cartographer/ResolvedGeo',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': [
    'country', 'countryName', 'continent', 'region', 'locality',
    'lat', 'lng', 'status', 'jurisdiction', 'confidence', 'modalities', 'locale', 'provenance',
  ],
  'properties': {
    'country':      { 'type': 'string' },
    'countryName':  { 'type': 'string' },
    // Macro continent (from a real API) — the insights table buckets by this.
    'continent':    { 'type': 'string' },
    'region':       { 'type': 'string' },
    'locality':     { 'type': 'string' },
    'locale':       { 'type': 'string' },
    'lat':          { 'type': 'number' },
    'lng':          { 'type': 'number' },
    'status':       { 'type': 'string', 'enum': ['land', 'water', 'coastal'] },
    'jurisdiction': { 'type': 'string', 'enum': ['GDPR', 'UK-GDPR', 'CCPA', 'LGPD', 'APPI', 'baseline', 'international-waters'] },
    'confidence':   { 'type': 'number', 'minimum': 0, 'maximum': 1 },
    'modalities':   { 'type': 'array', 'items': { 'type': 'string', 'enum': ['gps', 'ip'] } },
    'provenance':   { 'type': 'array', 'items': { 'type': 'string' } },
  },
  'additionalProperties': false,
} as const;

export type ResolvedGeo = FromSchema<typeof ResolvedGeoSchema>;
// #endregion resolved-geo-entity
