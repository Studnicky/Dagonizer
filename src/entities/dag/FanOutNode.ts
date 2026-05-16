/**
 * FanOutNode — execute one node per item in a source array, then
 * collect results via a `FanInConfig`.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { FanInConfigSchema } from './FanInConfig.js';

export const FanOutNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/FanOutNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['name', 'node', 'source', 'fanIn', 'outputs', 'type'],
  'properties': {
    'type': { 'type': 'string', 'const': 'fan-out' },
    'name': { 'type': 'string', 'minLength': 1 },
    'node': { 'type': 'string', 'minLength': 1 },
    'source': { 'type': 'string', 'minLength': 1 },
    'itemKey': { 'type': 'string', 'minLength': 1 },
    'concurrency': { 'type': 'integer', 'minimum': 1 },
    'fanIn': FanInConfigSchema,
    'outputs': {
      'type': 'object',
      'additionalProperties': { 'type': ['string', 'null'] },
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `FanOutNodeSchema` via `json-schema-to-ts`. */
export type FanOutNode = FromSchema<typeof FanOutNodeSchema>;
