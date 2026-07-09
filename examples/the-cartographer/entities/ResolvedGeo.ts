/**
 * ResolvedGeo: the final location output of the geo-source-resolve sub-DAG,
 * materialised by the `geo-weighted-fusion` gather from the highest-weight
 * resolved signal candidate. All valid signal modalities are scored and
 * resolved in parallel; the gather picks the winner by weight, back-fills
 * empty fields from lower-weight candidates, and writes this record.
 *
 * Fields:
 *   - country / countryName : ISO-2 code + human name (empty over open water).
 *   - region / locality     : subdivision + place name (back-filled from the
 *                             next-highest-weight candidate when the winner's
 *                             field is empty).
 *   - lat / lng             : the resolved position (from the winning candidate).
 *   - status                : land | water | coastal (water → high seas).
 *   - jurisdiction          : privacy regime derived from the winning country
 *                             (international-waters over open water, baseline
 *                             when no country resolved).
 *   - confidence            : the winning signal's base weight (0..1). Override:
 *                             when a `code` and a `locale` candidate both resolve
 *                             and agree on the same ISO-2 country, confidence is
 *                             max(winnerWeight, 0.45) (composite code+locale).
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
