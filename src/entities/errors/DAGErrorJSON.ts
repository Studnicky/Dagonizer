/**
 * DAGErrorJSON — the serialized form returned by `DAGError.toJSON()`.
 *
 * This is the wire shape for DAGError at JSON boundaries. The runtime
 * `DAGErrorInterface` extends `Error` and carries a `Date` timestamp and
 * Error-typed `cause` — none of which are JSON-expressible. `DAGErrorJSON`
 * is the persistence/transport equivalent with an ISO-8601 string timestamp.
 *
 * `context` is typed as `{ type: 'object' }` (opaque) because its contents
 * vary by error site. `cause` and `stack` are optional.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const DAGErrorJSONSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/DAGErrorJSON',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['code', 'message', 'name', 'timestamp'],
  'properties': {
    'cause': {},
    'code': { 'type': 'string' },
    'context': { 'type': 'object' },
    'message': { 'type': 'string' },
    'name': { 'type': 'string' },
    'stack': { 'type': 'string' },
    'timestamp': { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `DAGErrorJSONSchema` via `json-schema-to-ts`. */
export type DAGErrorJSON = FromSchema<typeof DAGErrorJSONSchema>;
