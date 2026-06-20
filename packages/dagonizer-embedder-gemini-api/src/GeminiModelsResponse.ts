/**
 * GeminiModelsResponse: JSON Schema 2020-12 description of the Google
 * AI Studio REST `GET /v1beta/models` response wire format — the provider's
 * available-model list.
 *
 *   → { "models": [ { "name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"], ... }, ... ] }
 *
 * Permissive in style: `additionalProperties` is open on both the envelope
 * and each model entry; `required` covers only the structurally critical path
 * (`models`, and each entry's `name`). The `supportedGenerationMethods`
 * array is optional — providers may omit it for models with no inference
 * surface. Every other field the API returns is carried through untyped.
 *
 * Uses a distinct `$id` from the adapter sibling package to avoid Ajv
 * registration conflicts when both packages are loaded in the same process.
 *
 * The validator is compiled once at module load through the framework's shared
 * Ajv via `Validator.compile`; the embedder never instantiates its own Ajv.
 */

import { Validator } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export const GeminiModelsResponseSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/gemini/GeminiApiEmbedderModelsResponse',
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
