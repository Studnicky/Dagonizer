/**
 * PhaseNode: lifecycle-attached placement in JSON-LD canonical form.
 *
 * Uses `@type: 'PhaseNode'` as the discriminator. `@id` is the placement
 * URN: `urn:noocodec:dag:<dagName>/node/<name>`.
 *
 * A PhaseNode wraps the main DAG loop with side-effect work that runs
 * BEFORE the entrypoint (`phase: 'pre'`) or AFTER the main loop drains
 * (`phase: 'post'`). Pre-phase placements run in DAG declaration order
 * and a thrown error aborts the run (lifecycle becomes `failed`, the
 * main loop never executes). Post-phase placements run in declaration
 * order on every exit path (completion, abort, timeout, terminal-failed,
 * node throw); a thrown error is collected as a warning on state and
 * does not change the already-set lifecycle.
 *
 * PhaseNode placements have no `outputs`; they cannot route to other
 * placements. They reference a registered `NodeInterface` by node IRI and
 * mutate state in place.
 *
 * Naming: the placement interface is distinct from `NodeInterface` (the
 * adapter contract consumers implement). A "node" is the registered unit
 * of work; a "placement" is its appearance inside a `DAG`.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const PhaseNodeSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/PhaseNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@id', '@type', 'name', 'node', 'phase'],
  'properties': {
    '@id':   { 'type': 'string', 'minLength': 1 },
    '@type': { 'type': 'string', 'const': 'PhaseNode' },
    'name':  { 'type': 'string', 'minLength': 1 },
    'node':  { 'type': 'string', 'minLength': 1 },
    'phase': { 'type': 'string', 'enum': ['pre', 'post'] },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `PhaseNodeSchema` via `json-schema-to-ts`. */
export type PhaseNodeType = FromSchema<typeof PhaseNodeSchema>;
