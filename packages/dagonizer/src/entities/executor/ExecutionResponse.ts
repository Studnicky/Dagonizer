/**
 * ExecutionResponse: wire-safe result returned from an isolating container
 * backend to the dispatcher after completing a whole embedded DAG.
 *
 * `terminalOutput` (renamed from `output` in the reference branch) is the
 * routing output the child DAG's terminal outcome resolved to.
 *
 * The NodeError shape is inlined here (same approach as NodeOutput which
 * inlines it). The standalone NodeErrorSchema is authoritative for that
 * shape; this is a structural copy to avoid $ref resolution at compile time.
 *
 * The ExecutorIntermediate shape is also inlined here (same structural-copy
 * pattern). ExecutorIntermediate.ts is the canonical source of truth.
 *
 * JSON Schema 2020-12 entity: schema value + FromSchema-derived TypeScript type.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const ExecutionResponseSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ExecutionResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['correlationId', 'terminalOutput', 'errors', 'stateSnapshot', 'intermediates'],
  'properties': {
    'correlationId':  { 'type': 'string', 'minLength': 1 },
    'terminalOutput': { 'type': 'string' },
    'errors': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': ['code', 'message', 'operation', 'recoverable', 'timestamp'],
        'properties': {
          'code':        { 'type': 'string' },
          'context':     { 'type': 'object' },
          'message':     { 'type': 'string' },
          'operation':   { 'type': 'string' },
          'recoverable': { 'type': 'boolean' },
          'timestamp':   { 'type': 'string' },
        },
        'additionalProperties': false,
      },
    },
    'stateSnapshot': { 'type': ['object', 'null'] },
    'intermediates': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': ['output', 'skipped', 'nodeName'],
        'properties': {
          'output':   { 'type': ['string', 'null'] },
          'skipped':  { 'type': 'boolean' },
          'nodeName': { 'type': 'string' },
        },
        'additionalProperties': false,
      },
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ExecutionResponseSchema` via `json-schema-to-ts`. */
export type ExecutionResponse = FromSchema<typeof ExecutionResponseSchema>;
