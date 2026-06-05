/**
 * PricedOrder: the pricing result for a shipment's basket of line items.
 *
 * Produced by the `enrich-pricing` node via PricingCatalog.order.
 * Money is integer minor units (cents) throughout; subtotalUsdMinor is the
 * FX-normalised base regardless of the original currency.
 */

// #region priced-order-entity
import type { FromSchema } from 'json-schema-to-ts';

export const PricedOrderSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/PricedOrder',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['lines', 'subtotalMinor', 'currency', 'subtotalUsdMinor', 'fxRate'],
  'properties': {
    'lines': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': ['productId', 'name', 'category', 'quantity', 'unitPriceMinor', 'currency', 'lineTotalMinor'],
        'properties': {
          'productId':      { 'type': 'string', 'minLength': 1 },
          'name':           { 'type': 'string', 'minLength': 1 },
          'category':       { 'type': 'string', 'minLength': 1 },
          'quantity':       { 'type': 'number', 'minimum': 1 },
          'unitPriceMinor': { 'type': 'number', 'minimum': 0 },
          'currency':       { 'type': 'string', 'minLength': 3, 'maxLength': 3 },
          'lineTotalMinor': { 'type': 'number', 'minimum': 0 },
        },
        'additionalProperties': false,
      },
    },
    'subtotalMinor':    { 'type': 'number', 'minimum': 0 },
    'currency':         { 'type': 'string', 'minLength': 3, 'maxLength': 3 },
    'subtotalUsdMinor': { 'type': 'number', 'minimum': 0 },
    'fxRate':           { 'type': 'number', 'minimum': 0 },
  },
  'additionalProperties': false,
} as const;

export type PricedOrder = FromSchema<typeof PricedOrderSchema>;
// #endregion priced-order-entity
