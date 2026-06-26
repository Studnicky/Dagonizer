/**
 * PositionPingEvent: a moving asset's satellite position fix.
 *
 * The leanest of the five canonical event variants. Its `eventType` is pinned
 * to 'position-ping', and its `body` carries ONLY the shared journey geometry
 * (coords, leg/origin/dest, carrier, status, raw timestamp) — no parcel,
 * sensor, customs, delivery, or recipient-PII fields.
 *
 * Same envelope and ingest-boundary optionals as every other variant:
 *   - envelope: shipmentId, eventId, epochMs, eventType, source provenance.
 *   - optionals: geo / consentHandled / pii (pre-resolved at ingest).
 */

// #region position-ping-event-entity
import type { FromSchema } from 'json-schema-to-ts';

export const PositionPingEventSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/events/PositionPingEvent',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['shipmentId', 'eventId', 'epochMs', 'eventType', 'sourceId', 'sourceFormat', 'sourceCompression', 'body'],
  'properties': {
    'shipmentId':   { 'type': 'string', 'minLength': 1 },
    'eventId':      { 'type': 'string', 'minLength': 1 },
    'epochMs':      { 'type': 'number' },
    'eventType':    { 'const': 'position-ping' },
    // Provenance: which source, format, and compression this event was decoded from.
    'sourceId':          { 'type': 'string', 'minLength': 1 },
    'sourceFormat':      { 'type': 'string', 'enum': ['csv', 'json', 'ndjson', 'yaml'] },
    'sourceCompression': { 'type': 'string', 'enum': ['none', 'gzip'] },
    // Per-type body: shared journey geometry only.
    'body': {
      'type': 'object',
      'required': [
        'scanSeq', 'latitude', 'longitude', 'ipAddress', 'localeTag', 'countryCode',
        'legFromLat', 'legFromLng', 'originLat', 'originLng', 'destLat', 'destLng',
        'carrier', 'status', 'rawTimestamp', 'address', 'phone',
      ],
      'properties': {
        'scanSeq':          { 'type': 'number' },
        'latitude':         { 'type': 'number' },
        'longitude':        { 'type': 'number' },
        // The asset's per-region public gateway IP (the IP modality's signal).
        'ipAddress':        { 'type': 'string' },
        // Source-supplied locale tag (BCP-47) and ISO-2 country code (when available).
        'localeTag':        { 'type': 'string' },
        'countryCode':      { 'type': 'string' },
        // journey geometry (previous-scan + shipment-level origin/destination)
        'legFromLat':       { 'type': 'number' },
        'legFromLng':       { 'type': 'number' },
        'originLat':        { 'type': 'number' },
        'originLng':        { 'type': 'number' },
        'destLat':          { 'type': 'number' },
        'destLng':          { 'type': 'number' },
        'carrier':          { 'type': 'string' },
        'status':           { 'type': 'string' },
        'rawTimestamp':     { 'type': 'string' },
        'address':          { 'type': 'string' },
        'phone':            { 'type': 'string' },
      },
      'additionalProperties': false,
    },
    // OPTIONAL pre-resolved fields (ingest-boundary; Stage 2 branches on them).
    'geo': {
      'type': 'object',
      'required': ['country', 'continent', 'region'],
      'properties': {
        'country':   { 'type': 'string' },
        'continent': { 'type': 'string' },
        'region':    { 'type': 'string' },
      },
      'additionalProperties': false,
    },
    'consentHandled': { 'type': 'boolean' },
    'pii':            { 'type': 'boolean' },
  },
  'additionalProperties': false,
} as const;

export type PositionPingEvent = FromSchema<typeof PositionPingEventSchema>;
// #endregion position-ping-event-entity
