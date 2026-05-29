/**
 * ScatterNode — isolate a state clone, run a body in it (a single node or a
 * sub-DAG), merge the clone back into the parent, and route on the aggregate
 * outcome.
 *
 * Uses `@type: 'ScatterNode'` as the discriminator. `@id` is the placement
 * URN: `urn:noocodex:dag:<dagName>/node/<name>`.
 *
 * `source` absent ⇒ exactly one clone (the singleton / embedded-DAG pattern).
 * `source` present ⇒ one clone per item in the named array (the generate-
 * collect / fan-out pattern). `itemKey` and `concurrency` are meaningful only
 * with `source`.
 *
 * `projection` seeds the clone before the body runs (parent → clone field copy).
 * `gather` describes how produced clone state is merged back (clone → parent).
 * `reducer` picks the outcome strategy; defaults to `'aggregate'` when
 * `source` is present, `'terminal'` when absent.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { GatherConfigSchema } from './GatherConfig.js';

export const ScatterNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ScatterNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@id', '@type', 'name', 'body', 'outputs'],
  'properties': {
    '@id':         { 'type': 'string', 'minLength': 1 },
    '@type':       { 'type': 'string', 'const': 'ScatterNode' },
    'name':        { 'type': 'string', 'minLength': 1 },
    'body': {
      'oneOf': [
        {
          'type': 'object',
          'required': ['node'],
          'properties': { 'node': { 'type': 'string', 'minLength': 1 } },
          'additionalProperties': false,
        },
        {
          'type': 'object',
          'required': ['dag'],
          'properties': { 'dag': { 'type': 'string', 'minLength': 1 } },
          'additionalProperties': false,
        },
      ],
    },
    'source':      { 'type': 'string', 'minLength': 1 },
    'itemKey':     { 'type': 'string', 'minLength': 1 },
    'concurrency': { 'type': 'integer', 'minimum': 1 },
    'projection': {
      'type': 'object',
      'additionalProperties': { 'type': 'string' },
    },
    'gather': GatherConfigSchema,
    'reducer': { 'type': 'string', 'minLength': 1 },
    'outputs': {
      'type': 'object',
      'additionalProperties': { 'type': ['string', 'null'] },
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ScatterNodeSchema` via `json-schema-to-ts`. */
export type ScatterNode = FromSchema<typeof ScatterNodeSchema>;
