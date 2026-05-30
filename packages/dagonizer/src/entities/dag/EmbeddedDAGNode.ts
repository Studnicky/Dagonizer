/**
 * EmbeddedDAGNode: invoke a nested DAG with optional state mapping,
 * in JSON-LD canonical form.
 *
 * Uses `@type: 'EmbeddedDAGNode'` as the discriminator. `@id` is the placement
 * URN: `urn:noocodex:dag:<dagName>/node/<name>`. Cardinality is always 1;
 * exactly one child execution runs. To fork (one clone per source item),
 * use `ScatterNode` with `source`.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const EmbeddedDAGNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/EmbeddedDAGNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@id', '@type', 'name', 'dag', 'outputs'],
  'properties': {
    '@id':   { 'type': 'string', 'minLength': 1 },
    '@type': { 'type': 'string', 'const': 'EmbeddedDAGNode' },
    'name':  { 'type': 'string', 'minLength': 1 },
    'dag':   { 'type': 'string', 'minLength': 1 },
    'outputs': {
      'type': 'object',
      'additionalProperties': { 'type': ['string', 'null'] },
    },
    'stateMapping': {
      'type': 'object',
      'properties': {
        // input: seed the child before it runs (child-state key → parent-state dotted path).
        'input':  { 'type': 'object', 'additionalProperties': { 'type': 'string' }, 'description': 'child-state key -> parent-state dotted path; copied into the child before it runs' },
        // output: copy back after the child completes (parent-state dotted path → child-state key).
        'output': { 'type': 'object', 'additionalProperties': { 'type': 'string' }, 'description': 'parent-state dotted path -> child-state key; copied into the parent after the child completes' },
      },
      'additionalProperties': false,
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `EmbeddedDAGNodeSchema` via `json-schema-to-ts`. */
export type EmbeddedDAGNode = FromSchema<typeof EmbeddedDAGNodeSchema>;
