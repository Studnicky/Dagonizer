/**
 * ResolvedGeo: the fused output of the geo-resolve sub-DAG — a location resolved
 * from a signal (GPS coords + optional gateway IP), fused across modalities.
 *
 * No curated lookup tables produce this. The GPS modality reverse-geocodes the
 * coords OFFLINE via `@rapideditor/country-coder` (country + ISO-2; continent
 * from the static ISO-2 → continent map); the IP modality geolocates the gateway
 * via freeipapi.com (city-level region/locality). The `fuse-geo` node combines
 * them — country/continent from GPS, region/locality filled from IP.
 *
 * Fields:
 *   - country / countryName : ISO-2 code + human name (empty over open water).
 *   - region / locality     : subdivision + place name (from IP; maritime label over water).
 *   - lat / lng             : the resolved position (GPS, the accurate modality).
 *   - status                : land | water | coastal (water → high seas).
 *   - jurisdiction          : privacy regime from the country (international-waters over water).
 *   - confidence            : 0..1 — high when GPS + IP agree on the country.
 *   - modalities            : which signals contributed ('gps', 'ip').
 */

// #region resolved-geo-entity
import type { FromSchema } from 'json-schema-to-ts';

export const ResolvedGeoSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/ResolvedGeo',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': [
    'country', 'countryName', 'continent', 'region', 'locality',
    'lat', 'lng', 'status', 'jurisdiction', 'confidence', 'modalities',
  ],
  'properties': {
    'country':      { 'type': 'string' },
    'countryName':  { 'type': 'string' },
    // Macro continent (from a real API) — the insights table buckets by this.
    'continent':    { 'type': 'string' },
    'region':       { 'type': 'string' },
    'locality':     { 'type': 'string' },
    'lat':          { 'type': 'number' },
    'lng':          { 'type': 'number' },
    'status':       { 'type': 'string', 'enum': ['land', 'water', 'coastal'] },
    'jurisdiction': { 'type': 'string', 'enum': ['GDPR', 'UK-GDPR', 'CCPA', 'LGPD', 'APPI', 'baseline', 'international-waters'] },
    'confidence':   { 'type': 'number', 'minimum': 0, 'maximum': 1 },
    'modalities':   { 'type': 'array', 'items': { 'type': 'string', 'enum': ['gps', 'ip'] } },
  },
  'additionalProperties': false,
} as const;

export type ResolvedGeo = FromSchema<typeof ResolvedGeoSchema>;
// #endregion resolved-geo-entity
