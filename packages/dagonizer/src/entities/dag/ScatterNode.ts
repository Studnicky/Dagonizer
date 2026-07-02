/**
 * ScatterNode: fork over a source array: one clone per item in the named
 * array, run a body in each clone, gather produced clone state back into the
 * parent, and route on the aggregate outcome.
 *
 * Uses `@type: 'ScatterNode'` as the discriminator. `@id` is the placement
 * URN: `urn:noocodex:dag:<dagName>/node/<name>`.
 *
 * `source` is required; it is the dotted path on state to the array to fork
 * over. For a single nested-DAG invocation (cardinality 1), use `EmbeddedDAGNode`.
 *
 * `stateMapping.input` seeds each clone before its body runs (child-state key →
 * parent-state dotted path), the same seeding concept and orientation as
 * `EmbeddedDAGNode.stateMapping.input`. Scatter has no `stateMapping.output`:
 * the N→1 merge back into the parent is `gather`'s job (a fork reduces, an embed
 * copies). `reducer` picks the outcome strategy; defaults to `'aggregate'`.
 *
 * `container` (optional): logical container role name. Honored ONLY when the
 * body is a `dag` body (a `{dag: string}` body). A node body with `container`
 * set is a validation error — a node body is one node, not a DAG, and cannot be
 * contained. Bound at dispatcher construction via
 * `DagonizerOptionsType.containers`. A declared-but-unbound role throws a
 * `DAGError` at `registerDAG` time.
 *
 * `execution` (optional): how this scatter runs, as ONE discriminated
 * `mode: 'item' | 'reservoir'` structure instead of three independently
 * documented sibling knobs. The schema structurally prevents combining
 * `throttle` with `reservoir` — a consumer cannot even express that
 * combination — because the two are semantically incompatible: `throttle`
 * (`@studnicky/throttle`'s `Throttle`) paces discrete per-item dispatch calls,
 * while reservoir mode dispatches whole batches of variable size (capacity,
 * idle, or flush triggered), a unit `throttle` was never designed to gate.
 *
 * - `{ mode: 'item', concurrency?, throttle? }` (the default when `execution`
 *   is absent, with `concurrency: 1` and no throttle): `concurrency` is an
 *   item-level `Semaphore` permit count — the maximum number of clone bodies
 *   executing at once. `throttle`, when present, wraps dispatch through a
 *   second, independent `Throttle` concurrency window on top of the
 *   semaphore: the semaphore still caps how far the pull loop runs ahead of
 *   dispatch capacity, while `throttle.concurrencyLimit` further paces the
 *   actual item-execution calls.
 * - `{ mode: 'reservoir', concurrency?, reservoir }`: items are buffered by
 *   `reservoir.keyField` and released as a batch per key when `capacity` is
 *   reached, `idleMs` elapses, or the source drains. `concurrency` still
 *   applies here — it is the SAME semaphore concept, but at batch granularity:
 *   the maximum number of released batches dispatched concurrently, not the
 *   maximum number of items. There is no `throttle` field in this mode.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { GatherConfigSchema } from './GatherConfig.js';

export const ScatterNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ScatterNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@id', '@type', 'name', 'body', 'source', 'gather', 'outputs'],
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
          'properties': { 'dag': { 'type': 'string', 'minLength': 1 } },
          'additionalProperties': false,
        },
        {
          // dagFrom: a dotted path read from each ITEM (the source-array element)
          // whose resolved string value names that item's body dag at runtime —
          // each item names its own dag (e.g. a tool call carrying
          // `dagName: 'tool:<name>'`). Resolution precedes the isolation-factory
          // child build. A non-object item, an unresolvable path, or an
          // unregistered name routes the item to `error` (no throw).
          'type': 'object',
          'required': ['dagFrom'],
          'properties': { 'dagFrom': { 'type': 'string', 'minLength': 1 } },
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
    'gather': GatherConfigSchema,
    'reducer': { 'type': 'string', 'minLength': 1 },
    'outputs': {
      'type': 'object',
      'additionalProperties': { 'type': 'string' },
    },
    // Logical container role. Honored only for dag-body scatter.
    // A node-body scatter with container set is a validation error.
    // Bound at dispatcher construction via DagonizerOptionsType.containers.
    'container': { 'type': 'string', 'minLength': 1 },
    // Unified concurrency-limiting policy: ONE discriminated `mode` structure
    // instead of three uncoordinated sibling knobs. See the module doc comment
    // above for the full `item` vs `reservoir` semantics. Absent means
    // `{ mode: 'item', concurrency: 1 }` (today's default-concurrency behavior).
    'execution': {
      'oneOf': [
        {
          'type': 'object',
          'required': ['mode'],
          'properties': {
            'mode': { 'type': 'string', 'const': 'item' },
            // Item-level Semaphore permit count: max clone bodies executing at once.
            'concurrency': { 'type': 'integer', 'minimum': 1 },
            // Second, opt-in concurrency gate wrapping item dispatch, backed by
            // `@studnicky/throttle`'s `Throttle`. Absent means no throttle.
            'throttle': {
              'type': 'object',
              'required': ['concurrencyLimit'],
              'properties': {
                'concurrencyLimit': { 'type': 'integer', 'minimum': 1 },
              },
              'additionalProperties': false,
            },
          },
          'additionalProperties': false,
        },
        {
          'type': 'object',
          'required': ['mode', 'reservoir'],
          'properties': {
            'mode': { 'type': 'string', 'const': 'reservoir' },
            // Batch-level Semaphore permit count: max released batches dispatched
            // concurrently. Same semaphore concept as item mode's `concurrency`,
            // applied at batch instead of item granularity.
            'concurrency': { 'type': 'integer', 'minimum': 1 },
            // Input-batching policy: items are buffered by keyField and released as
            // a batch per key when capacity is reached, idleMs elapses, or the
            // source drains.
            'reservoir': {
              'type': 'object',
              'required': ['keyField', 'capacity'],
              'properties': {
                // Accessor path on the item whose resolved value is the partition key.
                'keyField':  { 'type': 'string', 'minLength': 1 },
                // Release a key's batch when it reaches this size.
                'capacity':  { 'type': 'integer', 'minimum': 1 },
                // Release a key's partial batch after this many milliseconds of idle.
                'idleMs':    { 'type': 'integer', 'minimum': 1 },
              },
              'additionalProperties': false,
            },
          },
          'additionalProperties': false,
        },
      ],
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ScatterNodeSchema` via `json-schema-to-ts`. */
export type ScatterNodeType = FromSchema<typeof ScatterNodeSchema>;

/** Wire shape of `ScatterNode.execution` (the `oneOf` union member). */
export type ScatterExecutionOptionsType = NonNullable<ScatterNodeType['execution']>;

/** Empty state-mapping input: the default when `stateMapping` is absent on a `ScatterNode`. */
const SCATTER_EMPTY_INPUT: Readonly<Record<string, string>> = Object.freeze({});

/** Default scatter concurrency when `execution.concurrency` is not specified. */
const SCATTER_CONCURRENCY_DEFAULT = 1;

/**
 * Engine-internal shape of a resolved `ScatterNode.execution.throttle` option.
 * `null` is the canonical "no throttle" sentinel — the required-with-defaults
 * counterpart of the wire schema's optional `throttle` field.
 */
export type ScatterThrottleOptionsType = {
  concurrencyLimit: number;
} | null;

/**
 * Engine-internal, fully-resolved shape of `ScatterNode.execution`: every
 * field a caller needs is present, with `null` sentinels for the
 * genuinely-absent case, so `ScatterExecutor` never repeats an `?? default`
 * guard. The two modes are a discriminated union — `reservoir` is a
 * different execution model, not just another concurrency knob, so it has no
 * `throttle` field and `item` has no `reservoir` field.
 */
export type ScatterExecutionPolicyType =
  | { mode: 'item'; concurrency: number; throttle: ScatterThrottleOptionsType }
  | { mode: 'reservoir'; concurrency: number; reservoir: { keyField: string; capacity: number; idleMs: number | null } };

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

  /**
   * Resolve the fully-defaulted `execution` policy for a `ScatterNode`.
   * Absence of `execution` on the wire node means `{ mode: 'item',
   * concurrency: 1, throttle: null }` — the pre-`execution` default behavior
   * (item-level dispatch, no second throttle gate, no reservoir batching).
   */
  static executionPolicy(node: ScatterNodeType): ScatterExecutionPolicyType {
    const execution = node.execution;
    if (execution === undefined || execution.mode === 'item') {
      return {
        'mode': 'item',
        'concurrency': execution?.concurrency ?? SCATTER_CONCURRENCY_DEFAULT,
        'throttle': execution?.throttle !== undefined ? { 'concurrencyLimit': execution.throttle.concurrencyLimit } : null,
      };
    }
    return {
      'mode': 'reservoir',
      'concurrency': execution.concurrency ?? SCATTER_CONCURRENCY_DEFAULT,
      'reservoir': {
        'keyField': execution.reservoir.keyField,
        'capacity': execution.reservoir.capacity,
        'idleMs': execution.reservoir.idleMs ?? null,
      },
    };
  }
}
