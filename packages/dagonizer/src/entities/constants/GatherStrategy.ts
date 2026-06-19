/**
 * GatherStrategy: strategies for merging scatter clone results.
 *
 *   append: flatten the clone's `field` (or the source item) across all
 *           records into `target`.
 *   collect: collect each clone's output token (and/or its `field` value)
 *            into a target collection on the parent in source-index order.
 *   custom: invoke a custom node with `gatherResults` metadata.
 *   discard: no-op merge; clones run for side-effects, nothing folds into
 *            the parent. Use this when the scatter body is purely effectful
 *            and no clone state needs to flow back to the parent.
 *   map: for each cloneFieldPath → parentPath, read the field off
 *        each clone in source-index order and write to the parent.
 *        One clone ⇒ scalar set. N clones ⇒ array append.
 *   partition: bucket records by their output token into named target paths.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const GatherStrategySchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/GatherStrategy',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['append', 'collect', 'custom', 'discard', 'map', 'partition'],
} as const;

/** Union type derived from `GatherStrategySchema` via `json-schema-to-ts`. */
export type GatherStrategyNameType = FromSchema<typeof GatherStrategySchema>;
// → 'append' | 'collect' | 'custom' | 'discard' | 'map' | 'partition'

/** Gather strategy names; discriminator values used by `GatherConfig.strategy`. */
export const GatherStrategyNames = {
  'APPEND':    'append',
  'COLLECT':   'collect',
  'CUSTOM':    'custom',
  'DISCARD':   'discard',
  'MAP':       'map',
  'PARTITION': 'partition',
} as const satisfies Record<string, GatherStrategyNameType>;
