/**
 * ParallelNode — multiple single nodes running concurrently with a
 * combine strategy, in JSON-LD canonical form.
 *
 * Uses `@type: 'ParallelNode'` as the discriminator. `@id` is the placement
 * URN: `urn:noocodex:dag:<dagName>/node/<name>`.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const ParallelNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ParallelNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@id', '@type', 'name', 'nodes', 'combine', 'outputs'],
  'properties': {
    '@id':     { 'type': 'string', 'minLength': 1 },
    '@type':   { 'type': 'string', 'const': 'ParallelNode' },
    'name':    { 'type': 'string', 'minLength': 1 },
    'nodes':   { 'type': 'array', 'items': { 'type': 'string', 'minLength': 1 }, 'minItems': 1 },
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
