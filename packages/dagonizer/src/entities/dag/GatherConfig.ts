/**
 * GatherConfig: how to merge scatter clone results back into the parent state.
 *
 *   map: for each cloneFieldPath → parentPath in `mapping`, read the
 *        field off each clone in source-index order and write to the
 *        parent. One clone ⇒ scalar set. N clones ⇒ array append.
 *   append: flatten the clone's `field` (or the source item when `field`
 *           is absent) across all records into `target`.
 *   partition: bucket records by their `output` token into
 *              `partitions[token]`. The value pushed is the clone's `field`
 *              when set, else the source item.
 *   custom: expose the records under `gatherResults` metadata and invoke
 *           `customNode` through the engine.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { GatherStrategySchema } from '../constants/GatherStrategy.js';

export const GatherConfigSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/GatherConfig',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['strategy'],
  'properties': {
    'strategy': { 'type': 'string', 'enum': GatherStrategySchema.enum },
    'mapping': {
      'type': 'object',
      'additionalProperties': { 'type': 'string' },
    },
    'field': { 'type': 'string' },
    'target': { 'type': 'string' },
    'partitions': {
      'type': 'object',
      'additionalProperties': { 'type': 'string' },
    },
    'customNode': { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `GatherConfigSchema` via `json-schema-to-ts`. */
export type GatherConfig = FromSchema<typeof GatherConfigSchema>;
