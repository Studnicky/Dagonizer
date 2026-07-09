/**
 * SingleNode: single-node placement in JSON-LD canonical form.
 *
 * Uses `@type: 'SingleNode'` as the discriminator (replacing the flat `type`
 * key). `@id` is the placement URN: `urn:noocodec:dag:<dagName>/node/<name>`.
 *
 * Compile-time consumers may use `SingleNodePlacementType<TOutput>` for
 * exhaustiveness-checked output routing. The schema itself is necessarily
 * generic-free: `outputs` is a `Record<string, string>` at the JSON boundary.
 * All output routes must target canonical placement IRIs; null routes are not permitted.
 *
 * Naming: the placement interface is distinct from `NodeInterface` (the adapter
 * contract consumers implement). A "node" is the registered unit of work; a
 * "placement" is its appearance inside a `DAG`.
 */

import type { FromSchema } from 'json-schema-to-ts';

import type { RetryPolicyOptionsType } from '../../contracts/RetryPolicyOptionsType.js';

export const SingleNodeSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/SingleNode',
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
    'retry': {
      'type': 'object',
      'properties': {
        'maxAttempts':  { 'type': 'integer', 'minimum': 1 },
        'strategy':     { 'type': 'string', 'enum': ['constant', 'linear', 'exponential', 'decorrelated-jitter'] },
        'baseDelay':    { 'type': 'integer', 'minimum': 0 },
        'maxDelay':     { 'type': 'integer', 'minimum': 0 },
        'multiplier':   { 'type': 'number' },
        'jitterFactor': { 'type': 'number' },
        'on': {
          'type': 'array',
          'items': { 'type': 'string' },
        },
      },
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `SingleNodeSchema` via `json-schema-to-ts`. */
export type SingleNodeType = FromSchema<typeof SingleNodeSchema>;

/**
 * The no-retry sentinel: exactly one attempt, no backoff.
 * Used as the default when a `SingleNodePlacementType` carries no `retry` field.
 */
export const NO_RETRY: RetryPolicyOptionsType = { 'maxAttempts': 1 };

/**
 * Single node placement.
 * Routes to next node(s) based on the node's output.
 *
 * Extends `SingleNodeType` entity via `Omit<SingleNodeType, 'outputs' | 'retry'>`:
 *   - `outputs` is narrowed from `Record<string, string | null>` to
 *     `Record<TOutput, null | string>` for exhaustiveness-checking at
 *     compile time when `TOutput` is a narrow union.
 *   - `retry` carries the runtime `RetryPolicyOptionsType` (which includes
 *     `ErrorConstructorType[]` for `retryOn`/`abortOn`).
 */
export type SingleNodePlacementType<TOutput extends string = string> = Omit<SingleNodeType, 'outputs' | 'retry'> & {
  /**
   * Output routing - maps node outputs to next placement IRIs.
   * Key: output name from node (e.g., 'success', 'error', 'retry')
   * Value: next placement IRI — must target a placement in the DAG.
   *        To end a branch, route to a TerminalNode placement IRI.
   *
   * All node outputs must be wired (validated at registration).
   * When `TOutput` is narrowed, TypeScript will compile-fail any missing
   * routes.
   */
  'outputs': Record<TOutput, string>;
  /**
   * Retry policy for this placement. When absent, the dispatcher defaults to
   * `NO_RETRY` (exactly one attempt). When set, `RetryPolicy.from(retry).run(...)`
   * wraps each `node.execute()` call with the configured backoff and filtering.
   */
  'retry'?: RetryPolicyOptionsType;
};
