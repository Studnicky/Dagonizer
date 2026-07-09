/**
 * GeoCandidate: the transport-layer location view for the IP and address
 * modalities. Produced by `IpGeolocator.lookup` (ip modality) and
 * `AddressGeocoder.geocode` (address modality); carried as the outcome
 * candidate through `GeoLookupOutcomeType`.
 *
 * `resolve-ip` and `resolve-address` convert a resolved candidate into a
 * `GeoResolution` (the scatter-gather wire shape). The first-class
 * `geo-weighted-fusion` gather folds all clones' `GeoResolution` values by
 * weight into the final `ResolvedGeo`.
 *
 * A candidate carries only what the transport observed. Jurisdiction,
 * confidence, and back-fill from other modalities are computed in the gather.
 *
 * Fields:
 *   - modality      : which signal produced this ('gps' | 'ip' | 'address').
 *   - resolved      : whether the transport returned a usable location.
 *   - country       : ISO-2 code (empty over open water / on failure).
 *   - countryName   : human country name (empty over open water).
 *   - region        : subdivision / state (from transport; empty when absent).
 *   - locality      : place name (gateway city from IP; forward-geocoded
 *                     city from address).
 *   - lat / lng     : the position this modality reports.
 *   - water         : whether this modality classifies the point as open water.
 */

// #region geo-candidate-entity
import type { FromSchema } from 'json-schema-to-ts';

export const GeoCandidateSchema = {
  '$id': 'https://noocodec.dev/schemas/cartographer/GeoCandidate',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['modality', 'resolved', 'country', 'countryName', 'continent', 'region', 'locality', 'lat', 'lng', 'water'],
  'properties': {
    'modality':    { 'type': 'string', 'enum': ['gps', 'ip', 'address'] },
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
