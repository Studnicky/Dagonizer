/**
 * ToolCall: a tool invocation emitted by the model.
 *
 * `arguments` resolves to `Record<string, unknown>` from `{ type: 'object' }`
 * without `additionalProperties:false` — identical to the previous hand-written field.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const ToolCallSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/adapter/ToolCall',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['id', 'name', 'arguments'],
  'properties': {
    'id': { 'type': 'string', 'minLength': 1 },
    'name': { 'type': 'string', 'minLength': 1 },
    'arguments': { 'type': 'object' },
  },
  'additionalProperties': false,
} as const;

/**
 * A tool invocation emitted by the model. `arguments` resolves to
 * `Record<string, unknown>` from `{ type: 'object' }` without
 * `additionalProperties: false`.
 */
export type ToolCallType = FromSchema<typeof ToolCallSchema>;
