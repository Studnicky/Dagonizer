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
 * `DagonizerOptionsInterface.containers`. When declared but unbound, the scatter
 * dag-body resolves to in-process and fires a `contractWarning`.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { GatherConfigSchema } from './GatherConfig.js';

export const ScatterNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ScatterNode',
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
          'properties': { 'dag': { 'type': 'string', 'minLength': 1 } },
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
      'additionalProperties': { 'type': ['string', 'null'] },
    },
    // Logical container role. Honored only for dag-body scatter.
    // A node-body scatter with container set is a validation error.
    // Bound at dispatcher construction via DagonizerOptionsInterface.containers.
    'container': { 'type': 'string', 'minLength': 1 },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ScatterNodeSchema` via `json-schema-to-ts`. */
export type ScatterNode = FromSchema<typeof ScatterNodeSchema>;
