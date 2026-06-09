/**
 * ExecutionRequest: wire-safe representation of a DAG execution unit
 * sent from the dispatcher to an isolating container backend.
 *
 * DAG-only: no `kind` discriminant, no `nodeName`. A container runs
 * only whole DAGs, never individual nodes.
 *
 * JSON Schema 2020-12 entity: schema value + FromSchema-derived TypeScript type.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const ExecutionRequestSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ExecutionRequest',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['dagName', 'placementPath', 'stateSnapshot', 'timeoutMs', 'requestId'],
  'properties': {
    'dagName':       { 'type': 'string', 'minLength': 1 },
    'placementPath': { 'type': 'array', 'items': { 'type': 'string' } },
    'stateSnapshot': { 'type': 'object' },
    'timeoutMs':     { 'type': ['number', 'null'] },
    'requestId':     { 'type': 'string', 'minLength': 1 },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ExecutionRequestSchema` via `json-schema-to-ts`. */
export type ExecutionRequest = FromSchema<typeof ExecutionRequestSchema>;
