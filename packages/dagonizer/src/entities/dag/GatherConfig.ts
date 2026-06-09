/**
 * GatherConfig: how to merge scatter clone results back into the parent state.
 *
 * Built-in strategies (see `GatherStrategyName` for the names):
 *   append:    flatten the clone's `field` (or the source item when `field`
 *              is absent) across all records into `target`.
 *   collect:   collect each clone's output token (or its `field` value)
 *              into `target` in source-index order.
 *   custom:    expose records under `gatherResults` metadata and invoke
 *              `customNode` through the engine.
 *   discard:   no-op; clones run for side-effects, nothing folds back.
 *   map:       for each cloneFieldPath → parentPath in `mapping`, read the
 *              field off each clone in source-index order and write to the
 *              parent. One clone ⇒ scalar set. N clones ⇒ array append.
 *   partition: bucket records by their `output` token into
 *              `partitions[token]`.
 *
 * Custom strategies are registered via `GatherStrategies.register(...)` and
 * referenced by name. The `strategy` field accepts any string; unknown names
 * throw at runtime via `GatherStrategies.resolve(name)`.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const GatherConfigSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/GatherConfig',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['strategy'],
  'properties': {
    'strategy': { 'type': 'string', 'minLength': 1 },
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
