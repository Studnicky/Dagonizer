/**
 * ScatterNode: fork over a source array: one clone per item in the named
 * array, run a body in each clone, emit clone outcome records for downstream
 * first-class gather nodes, and route on the aggregate outcome.
 *
 * Uses `@type: 'ScatterNode'` as the discriminator. `@id` is the placement
 * URN: `urn:noocodec:dag:<dagName>/node/<name>`.
 *
 * `source` is required; it is the dotted path on state to the array to fork
 * over. For a single nested-DAG invocation (cardinality 1), use `EmbeddedDAGNode`.
 *
 * `stateMapping.input` seeds each clone before its body runs (child-state key →
 * parent-state dotted path), the same seeding concept and orientation as
 * `EmbeddedDAGNode.stateMapping.input`. Scatter has no N→1 merge config:
 * fan-in is always expressed by routing to a first-class `GatherNode`.
 * `reducer` picks the outcome strategy; defaults to `'aggregate'`.
 *
 * `container` (optional): logical container role name. Honored ONLY when the
 * body is a `dag` body (a `{dag: string}` body). A node body with `container`
 * set is a validation error — a node body is one node, not a DAG, and cannot be
 * contained. Bound at dispatcher construction via
 * `DagonizerOptionsType.containers`. A declared-but-unbound role throws a
 * `DAGError` at `registerDAG` time.
 *
 * `configuration.execution.batching` controls how this scatter runs. The
 * dispatcher resolves it from dispatcher, DAG, and placement tiers at
 * registration. Omitted fields inherit independently; the resolved policy is
 * discriminated by `mode: 'item' | 'reservoir'`. Inactive settings can remain
 * in a broader tier for a more specific mode swap, but do not enter the
 * resolved policy for the selected mode.
 *
 * - `{ mode: 'item', concurrency?, throttle? }` (the default when batching
 *   configuration is absent, with `concurrency: 1` and no throttle): `concurrency` is an
 *   item-level `Semaphore` permit count — the maximum number of clone bodies
 *   executing at once. `throttle`, when present, wraps dispatch through a
 *   second, independent `Throttle` concurrency window on top of the
 *   semaphore: the semaphore still caps how far the pull loop runs ahead of
 *   dispatch capacity, while `throttle.concurrencyLimit` further paces the
 *   actual item-execution calls. `throttle.adaptive`, when present, passes
 *   substrate adaptive concurrency tuning directly to `Throttle`.
 * - `{ mode: 'reservoir', concurrency?, reservoir }`: items are buffered by
 *   `reservoir.keyField` and released as a batch per key when `capacity` is
 *   reached, `idleMs` elapses, or the source drains. `concurrency` still
 *   applies here — it is the SAME semaphore concept, but at batch granularity:
 *   the maximum number of released batches dispatched concurrently, not the
 *   maximum number of items. The resolved reservoir policy has no throttle.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { DagConfiguration } from '../configuration/DagConfiguration.js';

import { DagReferenceShapeSchema } from './DagReference.js';

export const ScatterNodeSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/ScatterNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@id', '@type', 'name', 'body', 'source', 'outputs'],
  'properties': {
    '@id':         { 'type': 'string', 'minLength': 1 },
    '@type':       { 'type': 'string', 'const': 'ScatterNode' },
    'name':        { 'type': 'string', 'minLength': 1 },
    'body': {
      'oneOf': [
        {
          'type': 'object',
          'required': ['node'],
          'properties': { 'node': { 'type': 'string', 'minLength': 1 } },
          'additionalProperties': false,
        },
        {
          'type': 'object',
          'required': ['dag'],
          'properties': { 'dag': DagReferenceShapeSchema },
          'additionalProperties': false,
        },
      ],
    },
    'source':      { 'type': 'string', 'minLength': 1 },
    'itemKey':     { 'type': 'string', 'minLength': 1 },
    'stateMapping': {
      'type': 'object',
      'properties': {
        // input: seed each clone before its body runs (child-state key → parent-state dotted path).
        'input': { 'type': 'object', 'additionalProperties': { 'type': 'string' }, 'description': 'child-state key -> parent-state dotted path; seeds each clone before its body runs' },
      },
      'additionalProperties': false,
    },
    'reducer': { 'type': 'string', 'minLength': 1 },
    'outputs': {
      'type': 'object',
      'additionalProperties': { 'type': 'string' },
    },
    // Logical container role. Honored only for dag-body scatter.
    // A node-body scatter with container set is a validation error.
    // Bound at dispatcher construction via DagonizerOptionsType.containers.
    'container': { 'type': 'string', 'minLength': 1 },
    'configuration': DagConfiguration.Schema,
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ScatterNodeSchema` via `json-schema-to-ts`. */
export type ScatterNodeType = FromSchema<typeof ScatterNodeSchema>;

/** Empty state-mapping input: the default when `stateMapping` is absent on a `ScatterNode`. */
const SCATTER_EMPTY_INPUT: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Default-filling helpers for `ScatterNode` fields that are optional in the
 * wire schema but must be present for engine-internal processing.
 *
 * Callers resolve once at entry and never optional-chain afterward.
 */
export class ScatterNodeDefaults {
  private constructor() { /* static-only */ }

  /**
   * Return the `stateMapping.input` map, defaulting to an empty mapping when
   * `stateMapping` is absent.
   */
  static inputMapping(node: ScatterNodeType): Readonly<Record<string, string>> {
    return node.stateMapping?.input ?? SCATTER_EMPTY_INPUT;
  }

}
