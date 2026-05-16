/**
 * ParallelNode — multiple single nodes running concurrently with a
 * combine strategy.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const ParallelNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ParallelNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['name', 'nodes', 'combine', 'outputs', 'type'],
  'properties': {
    'type': { 'type': 'string', 'const': 'parallel' },
    'name': { 'type': 'string', 'minLength': 1 },
    'nodes': { 'type': 'array', 'items': { 'type': 'string', 'minLength': 1 }, 'minItems': 1 },
    'combine': { 'type': 'string', 'enum': ['all-success', 'any-success', 'collect'] },
    'outputs': {
      'type': 'object',
      'additionalProperties': { 'type': ['string', 'null'] },
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ParallelNodeSchema` via `json-schema-to-ts`. */
export type ParallelNode = FromSchema<typeof ParallelNodeSchema>;
