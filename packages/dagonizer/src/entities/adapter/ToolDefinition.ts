/**
 * ToolDefinition: a tool the model can choose to invoke.
 *
 * `inputSchema` resolves to `Record<string, unknown>` from `{ type: 'object' }`
 * without `additionalProperties:false` — identical to the previous hand-written field.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const ToolDefinitionSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/adapter/ToolDefinition',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['name', 'description', 'inputSchema', 'strict'],
  'properties': {
    'name': { 'type': 'string', 'minLength': 1 },
    'description': { 'type': 'string' },
    'inputSchema': { 'type': 'object' },
    'strict': { 'type': 'boolean' },
  },
  'additionalProperties': false,
} as const;

/**
 * Tool definition the model can choose to invoke.
 * `inputSchema` resolves to `Record<string, unknown>` from `{ type: 'object' }`
 * without `additionalProperties:false` — identical to the previous hand-written field.
 */
export type ToolDefinition = FromSchema<typeof ToolDefinitionSchema>;
