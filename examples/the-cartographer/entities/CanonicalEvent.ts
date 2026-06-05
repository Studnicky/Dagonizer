/**
 * CanonicalEvent: the unified, schema-derived event model that every source
 * fans into. Heterogeneous on-the-wire formats (JSON API, CSV dump, gzipped
 * NDJSON, customs/delivery) decode into this one shape so the downstream
 * enrichment scatter processes a single collection.
 *
 * Discriminated on `kind`:
 *   - 'position-ping'         — a moving asset's satellite position fix
 *   - 'facility-scan'         — a parcel scanned at a depot/facility
 *   - 'sensor-reading'        — cold-chain telemetry (temp / humidity / shock)
 *   - 'customs-event'         — a customs clearance / hold event
 *   - 'delivery-confirmation' — proof-of-delivery (the single terminal)
 *
 * Common header: `assetId`/`shipmentId`, `eventId`, `epochMs`, `kind`.
 *
 * Per-kind body (`body`) carries the fields a kind needs (coords, sensor
 * channels, customs status, recipient PII for delivery, etc.). Modelled as a
 * single object so the canonical collection is one V8-stable shape regardless
 * of kind; absent sub-fields are explicit at the ingest boundary.
 *
 * OPTIONAL pre-resolved fields some sources supply (Stage 2 branches on these;
 * Stage 1 ingests them but the enrichment runs the same regardless):
 *   - `geo?`            — RICH sources (JSON API) already carry resolved geo
 *                         (country / region; coords present) → skip geo-lookup.
 *   - `consentHandled?` — a source that already handled consent/PII flags it so
 *                         redaction can be skipped.
 *   - `pii?`            — whether the event carries recipient PII at all.
 *
 * These three are genuine ingest-boundary optionals: present from sources that
 * pre-resolve, absent from raw sources. They enter once at ingestion and are
 * narrowed immediately.
 */

// #region canonical-event-entity
import type { FromSchema } from 'json-schema-to-ts';

export const CanonicalEventSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/CanonicalEvent',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['shipmentId', 'eventId', 'epochMs', 'kind', 'sourceId', 'sourceFormat', 'body'],
  'properties': {
    'shipmentId':   { 'type': 'string', 'minLength': 1 },
    'eventId':      { 'type': 'string', 'minLength': 1 },
    'epochMs':      { 'type': 'number' },
    'kind': {
      'type': 'string',
      'enum': ['position-ping', 'facility-scan', 'sensor-reading', 'customs-event', 'delivery-confirmation'],
    },
    // Provenance: which source + format this event was decoded from.
    'sourceId':     { 'type': 'string', 'minLength': 1 },
    'sourceFormat': { 'type': 'string', 'enum': ['json', 'csv', 'ndjson.gz'] },
    // Per-kind body. One object shape (V8-stable); a kind populates the fields
    // it owns and zeroes/defaults the rest.
    'body': {
      'type': 'object',
      'required': [
        'scanSeq', 'latitude', 'longitude', 'ipAddress',
        'legFromLat', 'legFromLng', 'originLat', 'originLng', 'destLat', 'destLng',
        'carrier', 'facilityId', 'status',
        'weight', 'weightUnit', 'lineItems',
        'rawTimestamp', 'rawDispatchAt', 'rawPromisedDeliveryAt', 'disruptionReason',
        'tempC', 'humidityPct', 'shockG',
        'customsStatus', 'delivered',
        'recipientName', 'recipientEmail', 'recipientPhone', 'recipientAddress', 'recipientCountry',
        'marketingConsent', 'lawfulBasis', 'specialCategory',
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
        'facilityId':       { 'type': 'string' },
        'status':           { 'type': 'string' },
        // parcel + basket
        'weight':           { 'type': 'number' },
        'weightUnit':       { 'type': 'string', 'enum': ['lb', 'kg', 'g', 'oz'] },
        'lineItems': {
          'type': 'array',
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
        // raw timestamps (scan / dispatch / SLA promise) for normalization + ETA
        'rawTimestamp':           { 'type': 'string' },
        'rawDispatchAt':          { 'type': 'string' },
        'rawPromisedDeliveryAt':  { 'type': 'string' },
        'disruptionReason':       { 'type': 'string' },
        // sensor-reading channels (cold-chain telemetry)
        'tempC':            { 'type': 'number' },
        'humidityPct':      { 'type': 'number' },
        'shockG':           { 'type': 'number' },
        // customs-event
        'customsStatus':    { 'type': 'string' },
        // delivery-confirmation
        'delivered':        { 'type': 'boolean' },
        // recipient PII (delivery / facility scans carry it raw)
        'recipientName':    { 'type': 'string' },
        'recipientEmail':   { 'type': 'string' },
        'recipientPhone':   { 'type': 'string' },
        'recipientAddress': { 'type': 'string' },
        'recipientCountry': { 'type': 'string' },
        'marketingConsent': { 'type': 'boolean' },
        'lawfulBasis':      { 'type': 'string', 'enum': ['contract', 'consent', 'legitimate-interest', 'none'] },
        'specialCategory':  { 'type': 'string', 'enum': ['none', 'health'] },
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

export type CanonicalEvent = FromSchema<typeof CanonicalEventSchema>;
// #endregion canonical-event-entity
