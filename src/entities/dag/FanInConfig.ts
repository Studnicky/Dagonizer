/**
 * FanInConfig — how to merge fan-out results.
 *
 *   append    — flatten everything into a target path
 *   partition — route items by their output name into named target paths
 *   custom    — invoke a custom operation with `fanInResults` metadata
 *
 * jsontology migration note: today the derived type uses `FromSchema`.
 * When the `jsontology` workspace package lands, replace the
 * `FromSchema<typeof FanInConfigSchema>` with
 * `EntityType<typeof FanInConfigSchema['$id']>` from `entities/types.ts`.
 * The schema body and `$id` do not change.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const FanInConfigSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/FanInConfig',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['strategy'],
  'properties': {
    'strategy': { 'type': 'string', 'enum': ['append', 'partition', 'custom'] },
    'target': { 'type': 'string' },
    'partitions': {
      'type': 'object',
      'additionalProperties': { 'type': 'string' },
    },
    'customNode': { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `FanInConfigSchema` via `json-schema-to-ts`. */
export type FanInConfig = FromSchema<typeof FanInConfigSchema>;
