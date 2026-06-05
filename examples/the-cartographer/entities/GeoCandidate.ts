/**
 * GeoCandidate: one MODALITY's view of a location — the output of a single
 * transport lookup (`reverse-geocode` from GPS coords, or `ip-geolocate` from a
 * gateway IP). The `fuse-geo` node fans two candidates into one ResolvedGeo.
 *
 * A candidate is deliberately NOT a final ResolvedGeo: it carries only what one
 * signal observed, so the fusion node can compare modalities (agreement →
 * confidence) before committing to a jurisdiction/status.
 *
 * Fields:
 *   - modality      : which signal produced this ('gps' | 'ip').
 *   - resolved      : whether the lookup returned a usable location.
 *   - country       : ISO-2 code (empty over open water / on failure).
 *   - countryName   : human country name (empty over open water).
 *   - region        : subdivision / state (empty from the offline GPS modality;
 *                     populated by the IP modality).
 *   - locality      : place name ('International Waters' over open water from GPS;
 *                     the gateway city from the IP modality).
 *   - lat / lng      : the position this modality reports.
 *   - water         : whether this modality classifies the point as open water.
 */

// #region geo-candidate-entity
import type { FromSchema } from 'json-schema-to-ts';

export const GeoCandidateSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/GeoCandidate',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['modality', 'resolved', 'country', 'countryName', 'continent', 'region', 'locality', 'lat', 'lng', 'water'],
  'properties': {
    'modality':    { 'type': 'string', 'enum': ['gps', 'ip'] },
    'resolved':    { 'type': 'boolean' },
    'country':     { 'type': 'string' },
    'countryName': { 'type': 'string' },
    // The CONTINENT for the macro insights rollup. For GPS, from the static
    // ISO-2 → continent map; for IP, from the freeipapi response. Empty over
    // open water / on failure.
    'continent':   { 'type': 'string' },
    'region':      { 'type': 'string' },
    'locality':    { 'type': 'string' },
    'lat':         { 'type': 'number' },
    'lng':         { 'type': 'number' },
    'water':       { 'type': 'boolean' },
  },
  'additionalProperties': false,
} as const;

export type GeoCandidate = FromSchema<typeof GeoCandidateSchema>;
// #endregion geo-candidate-entity
