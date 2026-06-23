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

/**
 * Per-placement retry configuration. Extends `RetryPolicyOptionsType` (all
 * numeric/strategy fields) with an `on` field: the list of output names
 * produced by the node that trigger a retry. When `on` is absent, the engine
 * retries on any node throw. When `on` is present, only throws that correspond
 * to a listed output name trigger the retry loop.
 *
 * Maps 1-to-1 with `RetryPolicyOptionsType`; the `on` field is the only
 * addition. Kept in this file (co-located with the placement it extends) to
 * avoid circular imports between `entities/dag/` and `contracts/`.
 */
export type PlacementRetryConfigType = {
  /** Maximum number of total attempts (initial + retries). */
  maxAttempts?: number;
  /** Backoff strategy. Defaults to `'exponential'`. */
  strategy?: 'constant' | 'linear' | 'exponential' | 'decorrelated-jitter';
  /** Base delay in milliseconds before the first retry. */
  baseDelay?: number;
  /** Upper bound on the computed delay in milliseconds. */
  maxDelay?: number;
  /** Exponential growth factor. */
  multiplier?: number;
  /** Fractional jitter applied to computed delay; `0` = no jitter. */
  jitterFactor?: number;
  /**
   * Output names produced by the node that trigger a retry. When absent,
   * the engine retries on any node throw. When present, only throws where
   * the node's output name matches an entry here trigger the retry loop.
   *
   * Example: `['error']` — retries when the node throws on its `error` path;
   * a throw on `timeout` would not retry.
   */
  on?: string[];
};

/** Inline JSON Schema for the `retry` property in `SingleNodeSchema`. */
const PLACEMENT_RETRY_SCHEMA = {
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
      'description': 'Output names that trigger retry. Absent = retry on any throw.',
    },
  },
} as const;

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
    'retry': PLACEMENT_RETRY_SCHEMA,
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `SingleNodeSchema` via `json-schema-to-ts`. */
export type SingleNodeType = FromSchema<typeof SingleNodeSchema>;

/**
 * Single node placement.
 * Routes to next node(s) based on the node's output.
 *
 * Extends `SingleNodeType` entity via `Omit<SingleNodeType, 'outputs' | 'retry'>`:
 *   - `outputs` is narrowed from `Record<string, string | null>` to
 *     `Record<TOutput, null | string>` for exhaustiveness-checking at
 *     compile time when `TOutput` is a narrow union.
 *   - `retry` is narrowed from the schema-derived shape to
 *     `PlacementRetryConfigType` which carries `readonly string[]` on `on`.
 */
export type SingleNodePlacementType<TOutput extends string = string> = Omit<SingleNodeType, 'outputs' | 'retry'> & {
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
  /**
   * Optional declarative retry policy for this placement. When present, the
   * engine automatically re-fires the node on throw, applying backoff delays
   * between attempts. The `on` field filters which output names (as thrown
   * errors are routed) trigger a retry; absent means retry on any throw.
   */
  retry?: PlacementRetryConfigType;
};
