/**
 * ExecutionResponse: wire-safe result returned from an isolating container
 * backend to the dispatcher after completing a whole embedded DAG.
 *
 * `items` carries one per-item result `{ id, snapshot, terminalOutcome }`.
 * Single-item responses (N=1) use `items[0]`; multi-item batch responses
 * (N>1) carry one entry per item in the original request. The per-item
 * `terminalOutcome` is the routing output the child DAG resolved to for
 * that item. The per-item `snapshot` is the terminal state snapshot; null
 * when the item's DAG failed before producing a snapshot.
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
  'required': ['correlationId', 'items', 'errors', 'intermediates'],
  'properties': {
    'correlationId': { 'type': 'string', 'minLength': 1 },
    'items': {
      'type': 'array',
      'minItems': 1,
      'items': {
        'type': 'object',
        'required': ['id', 'snapshot', 'terminalOutcome'],
        'properties': {
          'id':              { 'type': 'string', 'minLength': 1 },
          'snapshot':        { 'type': ['object', 'null'] },
          'terminalOutcome': { 'type': 'string' },
        },
        'additionalProperties': false,
      },
    },
    'errors': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': ['code', 'context', 'message', 'operation', 'recoverable', 'timestamp'],
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
