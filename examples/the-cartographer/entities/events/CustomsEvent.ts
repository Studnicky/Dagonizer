/**
 * CustomsEvent: a customs clearance / hold event.
 *
 * Its `eventType` is pinned to 'customs-event'. The `body` carries the shared
 * journey geometry PLUS the single `customsStatus` field — no parcel, sensor,
 * delivery, or recipient-PII fields.
 *
 * Same envelope and ingest-boundary optionals as every other variant:
 *   - envelope: shipmentId, eventId, epochMs, eventType, source provenance.
 *   - optionals: geo / consentHandled / pii (pre-resolved at ingest).
 */

// #region customs-event-entity
import type { FromSchema } from 'json-schema-to-ts';

export const CustomsEventSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/events/CustomsEvent',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['shipmentId', 'eventId', 'epochMs', 'eventType', 'sourceId', 'sourceFormat', 'sourceCompression', 'body'],
  'properties': {
    'shipmentId':   { 'type': 'string', 'minLength': 1 },
    'eventId':      { 'type': 'string', 'minLength': 1 },
    'epochMs':      { 'type': 'number' },
    'eventType':    { 'const': 'customs-event' },
    // Provenance: which source, format, and compression this event was decoded from.
    'sourceId':          { 'type': 'string', 'minLength': 1 },
    'sourceFormat':      { 'type': 'string', 'enum': ['csv', 'json', 'ndjson', 'yaml'] },
    'sourceCompression': { 'type': 'string', 'enum': ['none', 'gzip'] },
    // Per-type body: shared journey geometry + customs clearance status.
    'body': {
      'type': 'object',
      'required': [
        'scanSeq', 'latitude', 'longitude', 'ipAddress',
        'legFromLat', 'legFromLng', 'originLat', 'originLng', 'destLat', 'destLng',
        'carrier', 'status', 'rawTimestamp',
        'customsStatus',
      ],
      'properties': {
        'scanSeq':          { 'type': 'number' },
        'latitude':         { 'type': 'number' },
        'longitude':        { 'type': 'number' },
        // The asset's per-region public gateway IP (the IP modality's signal).
        'ipAddress':        { 'type': 'string' },
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
        // customs-event
        'customsStatus':    { 'type': 'string' },
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

export type CustomsEvent = FromSchema<typeof CustomsEventSchema>;
// #endregion customs-event-entity
