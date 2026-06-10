/**
 * TerminalNode: explicit terminal placement in JSON-LD canonical form.
 *
 * Uses `@type: 'TerminalNode'` as the discriminator. `@id` is the placement
 * URN: `urn:noocodex:dag:<dagName>/node/<name>`.
 *
 * A TerminalNode ends the flow when reached. The `outcome` field declares
 * whether the flow should be marked `completed` or `failed`. This is the
 * explicit alternative to routing a prior placement's output to `null`
 * (which implicitly means `completed`).
 *
 * Naming: the placement interface is distinct from `NodeInterface` (the adapter
 * contract consumers implement). A "node" is the registered unit of work; a
 * "placement" is its appearance inside a `DAG`. TerminalNodes are placement-only
 * constructs; they have no backing `NodeInterface`.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const TerminalNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/TerminalNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@id', '@type', 'name', 'outcome'],
  'properties': {
    '@id':     { 'type': 'string', 'minLength': 1 },
    '@type':   { 'type': 'string', 'const': 'TerminalNode' },
    'name':    { 'type': 'string', 'minLength': 1 },
    'outcome': { 'type': 'string', 'enum': ['completed', 'failed'] },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `TerminalNodeSchema` via `json-schema-to-ts`. */
export type TerminalNode = FromSchema<typeof TerminalNodeSchema>;

