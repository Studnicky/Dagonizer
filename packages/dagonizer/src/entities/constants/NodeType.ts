/**
 * NodeType — node type identifiers used in flow configurations.
 *
 *   embedded — a nested DAG invocation with optional state mapping; cardinality 1
 *   single   — a single node placement
 *   parallel — a group of nodes executing concurrently
 *   scatter  — a body forked over a source array (one clone per item)
 */

import type { FromSchema } from 'json-schema-to-ts';

export const NodeTypeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/NodeType',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['embedded', 'parallel', 'scatter', 'single'],
} as const;

/** Union type derived from `NodeTypeSchema` via `json-schema-to-ts`. */
export type NodeType = FromSchema<typeof NodeTypeSchema>;
// → 'embedded' | 'parallel' | 'scatter' | 'single'

/** Node type identifiers. */
export const NodeType = {
  'EMBEDDED': 'embedded',
  'PARALLEL': 'parallel',
  'SCATTER': 'scatter',
  'SINGLE': 'single',
} as const satisfies Record<string, NodeType>;
