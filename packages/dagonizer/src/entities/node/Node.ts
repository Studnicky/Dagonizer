/**
 * Node: a discrete unit of work in a flow.
 *
 * Describes the node's identity (`name`) and the output ports it can return
 * (`outputs`). This is the wire/registration shape; behavioral members
 * (execute, destroy, validate) live on `NodeInterface<TState, TOutput>`.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const NodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/Node',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['name', 'outputs'],
  'properties': {
    'name': { 'type': 'string', 'minLength': 1 },
    'outputs': {
      'type': 'array',
      'items': { 'type': 'string', 'minLength': 1 },
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `NodeSchema` via `json-schema-to-ts`. */
export type NodeUnionType = FromSchema<typeof NodeSchema>;
