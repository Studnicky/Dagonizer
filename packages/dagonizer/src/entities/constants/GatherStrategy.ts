/**
 * GatherStrategy: strategies for merging scatter clone results.
 *
 *   map: for each cloneFieldPath → parentPath, read the field off
 *        each clone in source-index order and write to the parent.
 *        One clone ⇒ scalar set. N clones ⇒ array append.
 *   append: flatten the clone's `field` (or the source item) across all
 *           records into `target`.
 *   partition: bucket records by their output token into named target paths.
 *   custom: invoke a custom node with `gatherResults` metadata.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const GatherStrategySchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/GatherStrategy',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['append', 'custom', 'map', 'partition'],
} as const;

/** Union type derived from `GatherStrategySchema` via `json-schema-to-ts`. */
export type GatherStrategyName = FromSchema<typeof GatherStrategySchema>;
// → 'append' | 'custom' | 'map' | 'partition'

/** Gather strategy names; discriminator values used by `GatherConfig.strategy`. */
export const GatherStrategyName = {
  'APPEND': 'append',
  'CUSTOM': 'custom',
  'MAP': 'map',
  'PARTITION': 'partition',
} as const satisfies Record<string, GatherStrategyName>;
