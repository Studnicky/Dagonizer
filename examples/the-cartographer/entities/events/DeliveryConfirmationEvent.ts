/**
 * DeliveryConfirmationEvent: proof-of-delivery (the single terminal event).
 *
 * Its `eventType` is pinned to 'delivery-confirmation'. The `body` carries the
 * shared journey geometry PLUS the `delivered` flag, the SLA-promise raw
 * timestamp + disruption reason, and the recipient-PII block
 * (name/email/phone/address/country, consent, lawful basis, special category)
 * that proof-of-delivery carries raw.
 *
 * Same envelope and ingest-boundary optionals as every other variant:
 *   - envelope: shipmentId, eventId, epochMs, eventType, source provenance.
 *   - optionals: geo / consentHandled / pii (pre-resolved at ingest).
 */

// #region delivery-confirmation-event-entity
import type { FromSchema } from 'json-schema-to-ts';

export const DeliveryConfirmationEventSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/events/DeliveryConfirmationEvent',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['shipmentId', 'eventId', 'epochMs', 'eventType', 'sourceId', 'sourceFormat', 'sourceCompression', 'body'],
  'properties': {
    'shipmentId':   { 'type': 'string', 'minLength': 1 },
    'eventId':      { 'type': 'string', 'minLength': 1 },
    'epochMs':      { 'type': 'number' },
    'eventType':    { 'const': 'delivery-confirmation' },
    // Provenance: which source, format, and compression this event was decoded from.
    'sourceId':          { 'type': 'string', 'minLength': 1 },
    'sourceFormat':      { 'type': 'string', 'enum': ['csv', 'json', 'ndjson', 'yaml'] },
    'sourceCompression': { 'type': 'string', 'enum': ['none', 'gzip'] },
    // Per-type body: shared journey geometry + delivery flag + SLA + recipient PII.
    'body': {
      'type': 'object',
      'required': [
        'scanSeq', 'latitude', 'longitude', 'ipAddress', 'localeTag', 'countryCode',
        'legFromLat', 'legFromLng', 'originLat', 'originLng', 'destLat', 'destLng',
        'carrier', 'status', 'rawTimestamp',
        'delivered', 'rawPromisedDeliveryAt', 'disruptionReason',
        'recipientName', 'recipientEmail', 'recipientPhone', 'recipientAddress', 'recipientCountry',
        'marketingConsent', 'lawfulBasis', 'specialCategory', 'address', 'phone',
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
        // delivery-confirmation
        'delivered':        { 'type': 'boolean' },
        // raw timestamps (SLA promise) for normalization + ETA
        'rawPromisedDeliveryAt':  { 'type': 'string' },
        'disruptionReason':       { 'type': 'string' },
        // recipient PII (delivery / facility scans carry it raw)
        'recipientName':    { 'type': 'string' },
        'recipientEmail':   { 'type': 'string' },
        'recipientPhone':   { 'type': 'string' },
        'recipientAddress': { 'type': 'string' },
        'recipientCountry': { 'type': 'string' },
        'marketingConsent': { 'type': 'boolean' },
        'lawfulBasis':      { 'type': 'string', 'enum': ['contract', 'consent', 'legitimate-interest', 'none'] },
        'specialCategory':  { 'type': 'string', 'enum': ['none', 'health'] },
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

export type DeliveryConfirmationEvent = FromSchema<typeof DeliveryConfirmationEventSchema>;
// #endregion delivery-confirmation-event-entity
