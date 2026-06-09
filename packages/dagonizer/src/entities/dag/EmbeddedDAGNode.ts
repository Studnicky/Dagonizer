/**
 * EmbeddedDAGNode: invoke a nested DAG with optional state mapping,
 * in JSON-LD canonical form.
 *
 * Uses `@type: 'EmbeddedDAGNode'` as the discriminator. `@id` is the placement
 * URN: `urn:noocodex:dag:<dagName>/node/<name>`. Cardinality is always 1;
 * exactly one child execution runs. To fork (one clone per source item),
 * use `ScatterNode` with `source`.
 *
 * `container` (optional): logical container role name. The dispatcher binds
 * role names to `DagContainerInterface` instances at construction via
 * `DagonizerOptionsInterface.containers`. When declared but unbound, the
 * placement resolves to in-process and fires a `contractWarning`. When absent,
 * the embedded DAG always runs in-process.
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
    // Logical container role. Bound at dispatcher construction via
    // DagonizerOptionsInterface.containers. Absent = always in-process.
    'container': { 'type': 'string', 'minLength': 1 },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `EmbeddedDAGNodeSchema` via `json-schema-to-ts`. */
export type EmbeddedDAGNode = FromSchema<typeof EmbeddedDAGNodeSchema>;
