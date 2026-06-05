/**
 * DeliveryEstimate: the ETA calculation for a shipment.
 *
 * Produced by the `enrich-eta` node via EtaEstimator.estimate.
 * transitHours = total carrier transit time (distance ÷ speed + handling).
 * onTime = etaEpochMs ≤ promisedEpochMs.
 * delayHours > 0 when late; 0 when on-time.
 */

// #region delivery-estimate-entity
import type { FromSchema } from 'json-schema-to-ts';

export const DeliveryEstimateSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/DeliveryEstimate',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['transitHours', 'etaEpochMs', 'etaIso', 'promisedEpochMs', 'onTime', 'delayHours'],
  'properties': {
    'transitHours':    { 'type': 'number', 'minimum': 0 },
    'etaEpochMs':      { 'type': 'number' },
    'etaIso':          { 'type': 'string', 'minLength': 1 },
    'promisedEpochMs': { 'type': 'number' },
    'onTime':          { 'type': 'boolean' },
    'delayHours':      { 'type': 'number', 'minimum': 0 },
  },
  'additionalProperties': false,
} as const;

export type DeliveryEstimate = FromSchema<typeof DeliveryEstimateSchema>;
// #endregion delivery-estimate-entity
