/**
 * RawShipmentEvent: one messy tracking SCAN in an entity's journey.
 *
 * An entity (a shipment, keyed by `shipmentId`) MOVES across locations over
 * time: its journey is an ordered sequence of scans `scanSeq = 0..M-1` from
 * origin → transit hub(s) → destination, with increasing timestamps and coords
 * along the path. The source feed interleaves scans from many journeys in time
 * order; one scan per scatter item (the scatter spine is unchanged).
 *
 * The scan carries only its raw position; geo-enrichment DERIVES the grid zone,
 * country/region/hub, water bodies, timezone, and jurisdiction from the coords
 * alone (the location-from-coords showcase — a satellite ping is trusted for
 * nothing but its position).
 *
 * Journey context per scan:
 *   - scanSeq: position in this journey (0 = first/origin departure).
 *   - legFromLat/legFromLng: the PREVIOUS scan's coords (for seq 0 = origin),
 *     so each scan can compute its leg distance to the current scan.
 *   - shipment-level constants (basket lineItems, origin, destination promise,
 *     carrier, consent, lawfulBasis, specialCategory) are identical across a
 *     journey's scans.
 *
 * GDPR fields:
 *   - marketingConsent: drives redaction strictness, retention, and marketing-
 *     analytics inclusion — NOT whether the shipment is processed (the lawful
 *     basis for processing a delivery is the contract).
 *   - lawfulBasis: the GDPR Article 6 basis for processing.
 *   - specialCategory: an Article 9 flag. A rare 'health' value with no lawful
 *     basis is the genuine GDPR violation path.
 *   - disruptionReason: free-text reason a scan was disrupted (breakdown /
 *     customs hold / mis-sort / weather), or '' for a clean scan.
 */

// #region raw-shipment-event-entity
import type { FromSchema } from 'json-schema-to-ts';

export const RawShipmentEventSchema = {
  '$id': 'https://noocodec.dev/schemas/cartographer/RawShipmentEvent',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': [
    'shipmentId', 'scanSeq', 'rawTimestamp', 'rawDispatchAt', 'rawStatus', 'carrier',
    'ipAddress', 'localeTag', 'countryCode',
    'latitude', 'longitude', 'legFromLat', 'legFromLng',
    'originLat', 'originLng', 'destLat', 'destLng',
    'weight', 'weightUnit',
    'recipientName', 'recipientEmail', 'recipientPhone',
    'recipientAddress', 'recipientCountry',
    'marketingConsent', 'rawPromisedDeliveryAt',
    'lineItems', 'facilityId',
    'lawfulBasis', 'specialCategory', 'disruptionReason',
  ],
  'properties': {
    'shipmentId':          { 'type': 'string', 'minLength': 1 },
    'scanSeq':             { 'type': 'number', 'minimum': 0 },
    'rawTimestamp':        { 'type': 'string', 'minLength': 1 },
    'rawDispatchAt':       { 'type': 'string', 'minLength': 1 },
    'rawStatus':           { 'type': 'string', 'minLength': 1 },
    'carrier':             { 'type': 'string', 'minLength': 1 },
    // The asset's per-region public gateway IP (the IP modality's signal).
    'ipAddress':           { 'type': 'string' },
    // Source-supplied locale tag (BCP-47) and ISO-2 country code (when available).
    'localeTag':           { 'type': 'string' },
    'countryCode':         { 'type': 'string' },
    'latitude':            { 'type': 'number' },
    'longitude':           { 'type': 'number' },
    'legFromLat':          { 'type': 'number' },
    'legFromLng':          { 'type': 'number' },
    'originLat':           { 'type': 'number' },
    'originLng':           { 'type': 'number' },
    'destLat':             { 'type': 'number' },
    'destLng':             { 'type': 'number' },
    'weight':              { 'type': 'number' },
    'weightUnit':          { 'type': 'string', 'enum': ['lb', 'kg', 'g', 'oz'] },
    'recipientName':       { 'type': 'string', 'minLength': 1 },
    'recipientEmail':      { 'type': 'string', 'minLength': 1 },
    'recipientPhone':      { 'type': 'string', 'minLength': 1 },
    'recipientAddress':    { 'type': 'string', 'minLength': 1 },
    'recipientCountry':    { 'type': 'string', 'minLength': 1 },
    'marketingConsent':    { 'type': 'boolean' },
    'rawPromisedDeliveryAt': { 'type': 'string', 'minLength': 1 },
    'lineItems': {
      'type': 'array',
      'minItems': 1,
      'maxItems': 4,
      'items': {
        'type': 'object',
        'required': ['productId', 'quantity'],
        'properties': {
          'productId': { 'type': 'string', 'minLength': 1 },
          'quantity':  { 'type': 'number', 'minimum': 1 },
        },
        'additionalProperties': false,
      },
    },
    'facilityId': { 'type': 'string', 'minLength': 1 },
    'lawfulBasis': { 'type': 'string', 'enum': ['contract', 'consent', 'legitimate-interest', 'none'] },
    'specialCategory': { 'type': 'string', 'enum': ['none', 'health'] },
    'disruptionReason': { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

export type RawShipmentEvent = FromSchema<typeof RawShipmentEventSchema>;
// #endregion raw-shipment-event-entity
