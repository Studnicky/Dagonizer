/**
 * AnthropicModelsResponse: JSON Schema 2020-12 description of the Anthropic
 * `GET /v1/models` response wire format.
 *
 *   → { "data": [ { "id": "claude-3-5-sonnet-20241022", "type": "model", ... } ], ... }
 *
 * Permissive: `additionalProperties` is open on both the envelope and each
 * model entry. `required` covers only `data` (the envelope) and `id` (each
 * entry) — the only fields the discovery picker reads. All other fields
 * Anthropic returns (`display_name`, `created_at`, `type`, …) are carried
 * through untyped.
 *
 * The validator is compiled once at module load through the framework's
 * shared Ajv via `Validator.compile`; this module never instantiates its
 * own Ajv.
 */

import { Validator } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export const AnthropicModelsResponseSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/AnthropicModelsResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['data'],
  'properties': {
    'data': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': ['id'],
        'properties': {
          'id': { 'type': 'string' },
        },
        'additionalProperties': true,
      },
    },
  },
  'additionalProperties': true,
} as const;

/** TypeScript type derived from `AnthropicModelsResponseSchema` via `json-schema-to-ts`. */
export type AnthropicModelsResponseType = FromSchema<typeof AnthropicModelsResponseSchema>;

/** Module-load validator compiled through the framework's shared Ajv. */
export const AnthropicModelsResponseValidator = Validator.compile<AnthropicModelsResponseType>(
  AnthropicModelsResponseSchema,
);
