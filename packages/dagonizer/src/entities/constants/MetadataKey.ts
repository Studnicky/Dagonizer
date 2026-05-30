/**
 * MetadataKey — reserved metadata keys used by the dispatcher.
 *
 *   currentItem    — item injected per-iteration by scatter
 *   gatherResults  — record map injected by the custom gather strategy
 *   itemIndex      — 0-based index of current scatter item
 *   parallelOutputs — output-per-node map set by 'collect' parallel strategy
 */

import type { FromSchema } from 'json-schema-to-ts';

export const MetadataKeySchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/MetadataKey',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['currentItem', 'gatherResults', 'itemIndex', 'parallelOutputs'],
} as const;

/** Union type derived from `MetadataKeySchema` via `json-schema-to-ts`. */
export type MetadataKey = FromSchema<typeof MetadataKeySchema>;
// → 'currentItem' | 'gatherResults' | 'itemIndex' | 'parallelOutputs'

/** Reserved metadata keys used by the dispatcher. */
export const MetadataKey = {
  'CURRENT_ITEM': 'currentItem',
  'GATHER_RESULTS': 'gatherResults',
  'ITEM_INDEX': 'itemIndex',
  'PARALLEL_OUTPUTS': 'parallelOutputs',
} as const satisfies Record<string, MetadataKey>;
