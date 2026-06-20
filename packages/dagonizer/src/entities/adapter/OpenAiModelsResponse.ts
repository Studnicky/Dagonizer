/**
 * OpenAiModelsResponse: JSON Schema 2020-12 description of the OpenAI
 * `GET /v1/models` response wire format.
 *
 * Deliberately permissive (`additionalProperties: true` at every level) —
 * providers add extra fields (owned_by, created, …) that we ignore.
 * The only invariant is that `data` is an array of objects each carrying
 * an `id` string.
 *
 * Compiled once via `Validator.openAiModelsResponse` at module load.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const OpenAiModelsResponseSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/adapter/OpenAiModelsResponse',
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

/** TypeScript type derived from `OpenAiModelsResponseSchema` via `json-schema-to-ts`. */
export type OpenAiModelsResponseType = FromSchema<typeof OpenAiModelsResponseSchema>;
