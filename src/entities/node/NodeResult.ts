/**
 * NodeResult — result yielded after each node execution.
 *
 * The `state` field is opaque (`{ type: 'object' }`) at the JSON boundary.
 * `NodeResultInterface<TState>` extends this via `Omit<NodeResult, 'state'>`
 * and narrows `state` to the concrete `TState` generic.
 */

import type { FromSchema } from 'json-schema-to-ts';

import type { NodeStateInterface } from '../../NodeStateBase.js';

export const NodeResultSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/NodeResult',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['skipped', 'nodeName', 'state'],
  'properties': {
    'output': { 'type': 'string' },
    'skipped': { 'type': 'boolean' },
    'nodeName': { 'type': 'string' },
    'state': { 'type': 'object' },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `NodeResultSchema` via `json-schema-to-ts`. */
export type NodeResult = FromSchema<typeof NodeResultSchema>;

/**
 * Result yielded after each node execution.
 *
 * Extends `NodeResult` entity via `Omit<NodeResult, 'state'>`:
 *   - `state` is narrowed from `object` to the concrete `TState` generic
 */
export interface NodeResultInterface<TState extends NodeStateInterface>
  extends Omit<NodeResult, 'state'> {
  'state': TState;
}
