/**
 * SingleNode: single-node placement in JSON-LD canonical form.
 *
 * Uses `@type: 'SingleNode'` as the discriminator (replacing the flat `type`
 * key). `@id` is the placement URN: `urn:noocodex:dag:<dagName>/node/<name>`.
 *
 * Compile-time consumers may use `SingleNodePlacementType<TOutput>` for
 * exhaustiveness-checked output routing. The schema itself is necessarily
 * generic-free: `outputs` is a `Record<string, string>` at the JSON boundary.
 * All output routes must target named placements; null routes are not permitted.
 *
 * Naming: the placement interface is distinct from `NodeInterface` (the adapter
 * contract consumers implement). A "node" is the registered unit of work; a
 * "placement" is its appearance inside a `DAG`.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const SingleNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/SingleNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@id', '@type', 'name', 'node', 'outputs'],
  'properties': {
    '@id':   { 'type': 'string', 'minLength': 1 },
    '@type': { 'type': 'string', 'const': 'SingleNode' },
    'name':  { 'type': 'string', 'minLength': 1 },
    'node':  { 'type': 'string', 'minLength': 1 },
    'outputs': {
      'type': 'object',
      'additionalProperties': { 'type': 'string' },
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `SingleNodeSchema` via `json-schema-to-ts`. */
export type SingleNodeType = FromSchema<typeof SingleNodeSchema>;

/**
 * Single node placement.
 * Routes to next node(s) based on the node's output.
 *
 * Extends `SingleNodeType` entity via `Omit<SingleNodeType, 'outputs'>`:
 *   - `outputs` is narrowed from `Record<string, string | null>` to
 *     `Record<TOutput, null | string>` for exhaustiveness-checking at
 *     compile time when `TOutput` is a narrow union.
 */
export type SingleNodePlacementType<TOutput extends string = string> = Omit<SingleNodeType, 'outputs'> & {
  /**
   * Output routing - maps node outputs to next placement names.
   * Key: output name from node (e.g., 'success', 'error', 'retry')
   * Value: next placement name — must target a named placement in the DAG.
   *        To end a branch, route to a named TerminalNode placement.
   *
   * All node outputs must be wired (validated at registration).
   * When `TOutput` is narrowed, TypeScript will compile-fail any missing
   * routes.
   */
  'outputs': Record<TOutput, string>;
};
