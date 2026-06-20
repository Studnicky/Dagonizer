/**
 * GeminiModelsResponse: JSON Schema 2020-12 description of the Gemini
 * `GET /v1beta/models` response wire format — the provider's available-model list.
 *
 *   → { "models": [ { "name": "models/gemini-2.0-flash", "supportedGenerationMethods": [...] }, ... ] }
 *
 * Permissive in the same style as `GeminiResponseBodySchema`: `additionalProperties`
 * is open on both the envelope and each model entry, and `required` covers only
 * the structurally critical path `listModels()` reads (`models`, and each
 * entry's `name`). `supportedGenerationMethods` is the provider wire field name
 * and is preserved exactly as the Gemini REST surface returns it.
 *
 * The validator is compiled once at module load through the framework's shared
 * Ajv via `Validator.compile`; the adapter never instantiates its own Ajv.
 */

import { Validator } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export const GeminiModelsResponseSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/gemini/GeminiModelsResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['models'],
  'properties': {
    'models': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': ['name'],
        'properties': {
          'name': { 'type': 'string' },
          'supportedGenerationMethods': {
            'type': 'array',
            'items': { 'type': 'string' },
          },
        },
        'additionalProperties': true,
      },
    },
  },
  'additionalProperties': true,
} as const;

/** TypeScript type derived from `GeminiModelsResponseSchema` via `json-schema-to-ts`. */
export type GeminiModelsResponseType = FromSchema<typeof GeminiModelsResponseSchema>;

/** Module-load validator compiled through the framework's shared Ajv. */
export const GeminiModelsResponseValidator = Validator.compile<GeminiModelsResponseType>(
  GeminiModelsResponseSchema,
);
