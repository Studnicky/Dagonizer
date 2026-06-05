/**
 * NormalizedShipment: the canonical form of a raw tracking scan.
 *
 * Produced by the `normalize` node from a RawShipmentEvent, AFTER geo-context
 * (geo runs first so normalize can use the scan's timezone for local time).
 * Timestamps are epoch ms + UTC ISO + LOCAL ISO/offset at the scan's zone,
 * carrier aliases are resolved, country is ISO-3, weight is grams. Classify
 * fills eventType/serviceTier/sizeTier afterward.
 *
 * Journey fields (`scanSeq`, leg coords, origin/dest) carry through so the
 * leg-distance node and per-journey aggregation can reconstruct the path.
 */

// #region normalized-shipment-entity
import type { FromSchema } from 'json-schema-to-ts';

export const NormalizedShipmentSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/NormalizedShipment',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': [
    'shipmentId', 'scanSeq', 'epochMs', 'dispatchEpochMs', 'isoTimestamp', 'localIso', 'utcOffset',
    'carrierId', 'carrierName',
    'countryIso3', 'weightGrams',
    'eventType', 'serviceTier', 'sizeTier',
    'lineItems', 'facilityId',
    'latitude', 'longitude', 'legFromLat', 'legFromLng',
    'originLat', 'originLng', 'destLat', 'destLng',
    'recipientName', 'recipientEmail', 'recipientPhone',
    'recipientAddress', 'recipientCountry',
    'marketingConsent', 'promisedEpochMs', 'disruptionHours', 'disruptionReason',
  ],
  'properties': {
    'shipmentId':       { 'type': 'string', 'minLength': 1 },
    'scanSeq':          { 'type': 'number', 'minimum': 0 },
    'epochMs':          { 'type': 'number' },
    'dispatchEpochMs':  { 'type': 'number' },
    'isoTimestamp':     { 'type': 'string', 'minLength': 1 },
    'localIso':         { 'type': 'string', 'minLength': 1 },
    'utcOffset':        { 'type': 'string', 'minLength': 1 },
    'carrierId':        { 'type': 'string', 'minLength': 1 },
    'carrierName':      { 'type': 'string', 'minLength': 1 },
    'countryIso3':      { 'type': 'string', 'minLength': 3, 'maxLength': 3 },
    'weightGrams':      { 'type': 'number', 'minimum': 0 },
    'eventType':        { 'type': 'string', 'enum': ['SCAN', 'DEPARTURE', 'ARRIVAL', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'] },
    'serviceTier':      { 'type': 'string', 'enum': ['express', 'standard', 'economy'] },
    'sizeTier':         { 'type': 'string', 'enum': ['envelope', 'small', 'medium', 'large', 'freight'] },
    'lineItems': {
      'type': 'array',
      'minItems': 1,
      'items': {
        'type': 'object',
        'required': ['productId', 'quantity'],
        'properties': {
          'productId': { 'type': 'string' },
          'quantity':  { 'type': 'number' },
        },
        'additionalProperties': false,
      },
    },
    'facilityId':       { 'type': 'string', 'minLength': 1 },
    'latitude':         { 'type': 'number' },
    'longitude':        { 'type': 'number' },
    'legFromLat':       { 'type': 'number' },
    'legFromLng':       { 'type': 'number' },
    'originLat':        { 'type': 'number' },
    'originLng':        { 'type': 'number' },
    'destLat':          { 'type': 'number' },
    'destLng':          { 'type': 'number' },
    'recipientName':    { 'type': 'string', 'minLength': 1 },
    'recipientEmail':   { 'type': 'string', 'minLength': 1 },
    'recipientPhone':   { 'type': 'string', 'minLength': 1 },
    'recipientAddress': { 'type': 'string', 'minLength': 1 },
    'recipientCountry': { 'type': 'string', 'minLength': 1 },
    'marketingConsent': { 'type': 'boolean' },
    'promisedEpochMs':  { 'type': 'number' },
    'disruptionHours':  { 'type': 'number', 'minimum': 0 },
    'disruptionReason': { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

export type NormalizedShipment = FromSchema<typeof NormalizedShipmentSchema>;
// #endregion normalized-shipment-entity
