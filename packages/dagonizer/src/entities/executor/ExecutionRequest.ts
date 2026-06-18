/**
 * ExecutionRequest: wire-safe representation of a DAG execution unit
 * sent from the dispatcher to an isolating container backend.
 *
 * DAG-only: no `kind` discriminant, no `nodeName`. A container runs
 * only whole DAGs, never individual nodes.
 *
 * `items` carries one or more `{ id, snapshot }` pairs. Single-item
 * requests (N=1) use `items[0]`; multi-item batch requests (N>1) run
 * all items through the same DAG in one transport round-trip. The
 * `correlationId` identifies the request envelope; individual item ids
 * are contained in `items[*].id`.
 *
 * JSON Schema 2020-12 entity: schema value + FromSchema-derived TypeScript type.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const ExecutionRequestSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ExecutionRequest',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['dagName', 'placementPath', 'items', 'timeoutMs', 'correlationId'],
  'properties': {
    'dagName':       { 'type': 'string', 'minLength': 1 },
    'placementPath': { 'type': 'array', 'items': { 'type': 'string' } },
    'items': {
      'type': 'array',
      'minItems': 1,
      'items': {
        'type': 'object',
        'required': ['id', 'snapshot'],
        'properties': {
          'id':       { 'type': 'string', 'minLength': 1 },
          'snapshot': { 'type': 'object' },
        },
        'additionalProperties': false,
      },
    },
    'timeoutMs':     { 'type': ['number', 'null'] },
    'correlationId': { 'type': 'string', 'minLength': 1 },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ExecutionRequestSchema` via `json-schema-to-ts`. */
export type ExecutionRequest = FromSchema<typeof ExecutionRequestSchema>;
