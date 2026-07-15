/**
 * NodeStateData: pure wire/data shape of the shared node state.
 *
 * Captures the serializable fields: errors, warnings, metadata, retry
 * counters, and the lifecycle wire shape (DAGLifecycleStateData). The runtime
 * `NodeStateInterface`
 * does NOT extend this entity; its `lifecycle` field carries an in-memory
 * `Error` on the `failed` branch, which is not JSON-expressible. Instead,
 * `NodeStateInterface` is documented to reference this shape as the persistence
 * form represented by the node graph's JSON-LD intermediate document.
 *
 * The NodeError and NodeWarning item shapes reference the single-source
 * `NodeErrorProperties`/`NodeWarningProperties` consts and their schemas'
 * `required` arrays structurally; `json-schema-to-ts` reads the literal at
 * compile time, so the derived types are identical to inline copies while
 * field changes propagate from one place.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { NodeErrorProperties, NodeErrorSchema } from './NodeError.js';
import { NodeWarningProperties, NodeWarningSchema } from './NodeWarning.js';

export const NodeStateDataSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/NodeStateData',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['errors', 'warnings', 'metadata', 'retries'],
  'properties': {
    'errors': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': NodeErrorSchema.required,
        'properties': NodeErrorProperties,
        'additionalProperties': false,
      },
    },
    'warnings': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': NodeWarningSchema.required,
        'properties': NodeWarningProperties,
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
export type NodeStateDataType = FromSchema<typeof NodeStateDataSchema>;
