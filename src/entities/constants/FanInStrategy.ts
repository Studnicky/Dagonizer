/**
 * FanInStrategy — strategies for merging fan-out results.
 *
 *   append    — flatten everything into a target path
 *   partition — route items by their output name into named target paths
 *   custom    — invoke a custom operation with `fanInResults` metadata
 */

import type { FromSchema } from 'json-schema-to-ts';

export const FanInStrategySchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/FanInStrategy',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['append', 'custom', 'partition'],
} as const;

/** Union type derived from `FanInStrategySchema` via `json-schema-to-ts`. */
export type FanInStrategyName = FromSchema<typeof FanInStrategySchema>;
// → 'append' | 'custom' | 'partition'

/** Fan-in strategy names — discriminator values used by `FanInConfig.strategy`. */
export const FanInStrategyName = {
  'APPEND': 'append',
  'CUSTOM': 'custom',
  'PARTITION': 'partition',
} as const satisfies Record<string, FanInStrategyName>;
