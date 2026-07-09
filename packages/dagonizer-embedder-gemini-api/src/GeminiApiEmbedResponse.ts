/**
 * GeminiApiEmbedResponse: JSON Schema 2020-12 description of the Google
 * AI Studio REST `:embedContent` response wire format.
 *
 *   → { "embedding": { "values": number[] } }
 *
 * Permissive in the style of `OpenAiResponseBodySchema`: `additionalProperties`
 * is open and `required` is set only on the structurally critical path
 * (`embedding.values`). The empty-`values` case is rejected by the embedder
 * after validation, not by the schema.
 *
 * The validator is compiled once at module load through the framework's
 * shared Ajv via `Validator.compile`; the embedder never instantiates its
 * own Ajv.
 */

import { Validator } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export const GeminiApiEmbedResponseSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/GeminiApiEmbedResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['embedding'],
  'properties': {
    'embedding': {
      'type': 'object',
      'required': ['values'],
      'properties': {
        'values': {
          'type': 'array',
          'items': { 'type': 'number' },
        },
      },
      'additionalProperties': true,
    },
  },
  'additionalProperties': true,
} as const;

/** TypeScript type derived from `GeminiApiEmbedResponseSchema` via `json-schema-to-ts`. */
export type GeminiApiEmbedResponseType = FromSchema<typeof GeminiApiEmbedResponseSchema>;

/** Module-load validator compiled through the framework's shared Ajv. */
export const GeminiApiEmbedResponseValidator = Validator.compile<GeminiApiEmbedResponseType>(
  GeminiApiEmbedResponseSchema,
);
