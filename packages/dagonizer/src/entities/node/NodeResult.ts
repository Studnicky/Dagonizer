/**
 * NodeResult: result yielded after each node execution.
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
  'required': ['output', 'skipped', 'nodeName', 'state'],
  'properties': {
    // Routing token the node emitted, or `null` when it emitted none (skipped,
    // phase, or terminal-without-route). Required-with-default: a reader never
    // disambiguates "absent" from "no route".
    'output': { 'type': ['string', 'null'] },
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
 *   - `intermediateResults` is a runtime-only field (not wire data): the
 *     per-step results a composite node (parallel / scatter / embedded-DAG)
 *     produced internally. Required-with-default `[]` for leaf nodes so every
 *     result has one stable object shape (no post-construction mutation).
 */
export interface NodeResultInterface<TState extends NodeStateInterface>
  extends Omit<NodeResult, 'state'> {
  'state': TState;
  'intermediateResults': NodeResultInterface<TState>[];
}
