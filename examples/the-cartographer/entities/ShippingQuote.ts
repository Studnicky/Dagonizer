/**
 * ShippingQuote: the cost estimate for transporting a shipment.
 *
 * Produced by the `enrich-shipping` node via ShippingCalculator.quote.
 * distanceKm is the haversine distance between origin and scan coordinates.
 * costUsdMinor is the total shipping cost in USD cents (integer minor units).
 */

// #region shipping-quote-entity
import type { FromSchema } from 'json-schema-to-ts';

export const ShippingQuoteSchema = {
  '$id': 'https://noocodec.dev/schemas/cartographer/ShippingQuote',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['distanceKm', 'costUsdMinor', 'breakdown'],
  'properties': {
    'distanceKm':   { 'type': 'number', 'minimum': 0 },
    'costUsdMinor': { 'type': 'number', 'minimum': 0 },
    'breakdown': {
      'type': 'object',
      'required': ['baseMinor', 'perKmMinor', 'perKgMinor', 'tierMultiplier'],
      'properties': {
        'baseMinor':       { 'type': 'number', 'minimum': 0 },
        'perKmMinor':      { 'type': 'number', 'minimum': 0 },
        'perKgMinor':      { 'type': 'number', 'minimum': 0 },
        'tierMultiplier':  { 'type': 'number', 'minimum': 0 },
      },
      'additionalProperties': false,
    },
  },
  'additionalProperties': false,
} as const;

export type ShippingQuote = FromSchema<typeof ShippingQuoteSchema>;
// #endregion shipping-quote-entity
