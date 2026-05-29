/**
 * NodeType — node type identifiers used in flow configurations.
 *
 *   single   — a single node placement
 *   parallel — a group of nodes executing concurrently
 *   scatter  — a body executed per item of a source set (one clone when no source)
 */

import type { FromSchema } from 'json-schema-to-ts';

export const NodeTypeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/NodeType',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['parallel', 'scatter', 'single'],
} as const;

/** Union type derived from `NodeTypeSchema` via `json-schema-to-ts`. */
export type NodeType = FromSchema<typeof NodeTypeSchema>;
// → 'parallel' | 'scatter' | 'single'

/** Node type identifiers. */
export const NodeType = {
  'PARALLEL': 'parallel',
  'SCATTER': 'scatter',
  'SINGLE': 'single',
} as const satisfies Record<string, NodeType>;
