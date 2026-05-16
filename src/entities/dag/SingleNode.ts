/**
 * SingleNode — single-node placement.
 *
 * Compile-time consumers may use the `SingleNodePlacementInterface<TOutput>`
 * generic for exhaustiveness-checked output routing. The schema itself is
 * necessarily generic-free: `outputs` is a `Record<string, string | null>`
 * at the JSON boundary.
 *
 * Naming: the placement interface is distinct from `NodeInterface` (the
 * adapter contract consumers implement). A "node" is the registered unit of
 * work; a "placement" is its appearance inside a `DAG`.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const SingleNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/SingleNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['name', 'node', 'outputs', 'type'],
  'properties': {
    'type': { 'type': 'string', 'const': 'single' },
    'name': { 'type': 'string', 'minLength': 1 },
    'node': { 'type': 'string', 'minLength': 1 },
    'outputs': {
      'type': 'object',
      'additionalProperties': { 'type': ['string', 'null'] },
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `SingleNodeSchema` via `json-schema-to-ts`. */
export type SingleNode = FromSchema<typeof SingleNodeSchema>;

/**
 * Single node placement.
 * Routes to next node(s) based on the node's output.
 *
 * Extends `SingleNode` entity via `Omit<SingleNode, 'outputs'>`:
 *   - `outputs` is narrowed from `Record<string, string | null>` to
 *     `Record<TOutput, null | string>` for exhaustiveness-checking at
 *     compile time when `TOutput` is a narrow union.
 */
export interface SingleNodePlacementInterface<TOutput extends string = string>
  extends Omit<SingleNode, 'outputs'> {
  /**
   * Output routing - maps node outputs to next nodes.
   * Key: output name from node (e.g., 'success', 'error', 'retry')
   * Value: next node name, or null to end flow on this path
   *
   * All node outputs must be wired (validated at registration).
   * When `TOutput` is narrowed, TypeScript will compile-fail any missing
   * routes.
   */
  'outputs': Record<TOutput, null | string>;
}
