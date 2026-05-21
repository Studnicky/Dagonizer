/**
 * MetadataKey — reserved metadata keys used by the dispatcher.
 *
 *   currentItem    — item injected per-iteration by fan-out
 *   fanInResults   — result map injected by custom fan-in strategy
 *   itemIndex      — 0-based index of current fan-out item
 *   parallelOutputs — output-per-node map set by 'collect' parallel strategy
 */

import type { FromSchema } from 'json-schema-to-ts';

export const MetadataKeySchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/MetadataKey',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['currentItem', 'fanInResults', 'itemIndex', 'parallelOutputs'],
} as const;

/** Union type derived from `MetadataKeySchema` via `json-schema-to-ts`. */
export type MetadataKey = FromSchema<typeof MetadataKeySchema>;
// → 'currentItem' | 'fanInResults' | 'itemIndex' | 'parallelOutputs'

/** Reserved metadata keys used by the dispatcher. */
export const MetadataKey = {
  'CURRENT_ITEM': 'currentItem',
  'FAN_IN_RESULTS': 'fanInResults',
  'ITEM_INDEX': 'itemIndex',
  'PARALLEL_OUTPUTS': 'parallelOutputs',
} as const satisfies Record<string, MetadataKey>;
