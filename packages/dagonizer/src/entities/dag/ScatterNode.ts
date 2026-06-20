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
          // dagFrom: a dotted state path on the per-item clone state whose
          // resolved string value names the dag at runtime.
          // Unregistered resolved names route the item to `error` (no throw).
          'type': 'object',
          'required': ['dagFrom'],
          'properties': { 'dagFrom': { 'type': 'string', 'minLength': 1 } },
          'additionalProperties': false,
        },
      ],
    },
    'source':      { 'type': 'string', 'minLength': 1 },
    'itemKey':     { 'type': 'string', 'minLength': 1 },
    'concurrency': { 'type': 'integer', 'minimum': 1 },
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
    // Input-batching policy. When present, the scatter buffers items by keyField
    // and releases a batch per key when capacity is reached or idleMs elapses.
    // Absent means batch-size-1 (today's behavior unchanged).
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
