/**
 * NodeStateData — pure wire/data shape of the shared node state.
 *
 * Captures the serializable fields: errors, warnings, metadata, retry
 * counters, and the lifecycle wire shape (DAGLifecycleStateData). The runtime
 * `NodeStateInterface`
 * does NOT extend this entity — its `lifecycle` field carries an in-memory
 * `Error` on the `failed` branch, which is not JSON-expressible. Instead,
 * `NodeStateInterface` is documented to reference this shape as the persistence
 * form returned by `NodeStateBase.snapshot()`.
 *
 * The NodeError and NodeWarning shapes are inlined here to avoid $ref
 * resolution complexity (same pattern as DAGSchema inlining GatherConfig).
 */

import type { FromSchema } from 'json-schema-to-ts';

export const NodeStateDataSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/NodeStateData',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['errors', 'warnings', 'metadata', 'retries'],
  'properties': {
    'errors': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': ['code', 'message', 'operation', 'recoverable', 'timestamp'],
        'properties': {
          'code': { 'type': 'string' },
          'context': { 'type': 'object' },
          'message': { 'type': 'string' },
          'operation': { 'type': 'string' },
          'recoverable': { 'type': 'boolean' },
          'timestamp': { 'type': 'string' },
        },
        'additionalProperties': false,
      },
    },
    'warnings': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': ['code', 'message', 'operation', 'timestamp'],
        'properties': {
          'code': { 'type': 'string' },
          'message': { 'type': 'string' },
          'operation': { 'type': 'string' },
          'timestamp': { 'type': 'string' },
        },
        'additionalProperties': false,
      },
    },
    'metadata': { 'type': 'object' },
    'retries': {
      'type': 'object',
      'additionalProperties': { 'type': 'number' },
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `NodeStateDataSchema` via `json-schema-to-ts`. */
export type NodeStateData = FromSchema<typeof NodeStateDataSchema>;
