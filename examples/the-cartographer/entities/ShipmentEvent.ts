/**
 * ShipmentEvent: raw wire event ingested from the event stream.
 *
 * Schema-derived entity (JSON Schema 2020-12 + FromSchema) per CLAUDE.md.
 * Carries the scan location (raw WGS-84), the carrier/facility, and the
 * recipient PII fields that the GDPR sub-pipeline will classify and redact.
 */

// #region shipment-event-entity
import type { FromSchema } from 'json-schema-to-ts';

export const ShipmentEventSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/ShipmentEvent',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': [
    'shipmentId', 'timestamp', 'eventType',
    'latitude', 'longitude',
    'carrier', 'facilityId',
    'recipientName', 'recipientEmail', 'recipientPhone',
    'recipientAddress', 'recipientCountry',
    'marketingConsent', 'promisedDeliveryAt',
  ],
  'properties': {
    'shipmentId':        { 'type': 'string', 'minLength': 1 },
    'timestamp':         { 'type': 'string', 'minLength': 1 },
    'eventType':         { 'type': 'string', 'enum': ['SCAN', 'DEPARTURE', 'ARRIVAL', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'] },
    'latitude':          { 'type': 'number' },
    'longitude':         { 'type': 'number' },
    'carrier':           { 'type': 'string', 'minLength': 1 },
    'facilityId':        { 'type': 'string', 'minLength': 1 },
    'recipientName':     { 'type': 'string', 'minLength': 1 },
    'recipientEmail':    { 'type': 'string', 'minLength': 1 },
    'recipientPhone':    { 'type': 'string', 'minLength': 1 },
    'recipientAddress':  { 'type': 'string', 'minLength': 1 },
    'recipientCountry':  { 'type': 'string', 'minLength': 1 },
    'marketingConsent':  { 'type': 'boolean' },
    'promisedDeliveryAt': { 'type': 'string', 'minLength': 1 },
  },
  'additionalProperties': false,
} as const;

export type ShipmentEvent = FromSchema<typeof ShipmentEventSchema>;
// #endregion shipment-event-entity
