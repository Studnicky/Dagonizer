/**
 * NodeType — node type identifiers used in flow configurations.
 *
 *   single   — a single node placement
 *   parallel — a group of nodes executing concurrently
 *   fan-out  — one node executed per item in a source array
 *   sub-flow — a nested flow invocation
 */

import type { FromSchema } from 'json-schema-to-ts';

export const NodeTypeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/NodeType',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['fan-out', 'parallel', 'single', 'sub-flow'],
} as const;

/** Union type derived from `NodeTypeSchema` via `json-schema-to-ts`. */
export type NodeType = FromSchema<typeof NodeTypeSchema>;
// → 'fan-out' | 'parallel' | 'single' | 'sub-flow'

/** Node type identifiers. */
export const NodeType = {
  'FAN_OUT': 'fan-out',
  'PARALLEL': 'parallel',
  'SINGLE': 'single',
  'SUB_FLOW': 'sub-flow',
} as const satisfies Record<string, NodeType>;
