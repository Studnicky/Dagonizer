/**
 * OllamaEmbedResponse: JSON Schema 2020-12 description of the Ollama
 * native `/api/embeddings` response wire format.
 *
 *   → { "embedding": number[] }
 *
 * Permissive in the style of `OpenAiResponseBodySchema`: `additionalProperties`
 * is open and `required` is set only on the structurally critical path
 * (`embedding`). The empty-`embedding` case is rejected by the embedder
 * after validation, not by the schema.
 *
 * The validator is compiled once at module load through the framework's
 * shared Ajv via `Validator.compile`; the embedder never instantiates its
 * own Ajv.
 */

import { Validator } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export const OllamaEmbedResponseSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/OllamaEmbedResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['embedding'],
  'properties': {
    'embedding': {
      'type': 'array',
      'items': { 'type': 'number' },
    },
  },
  'additionalProperties': true,
} as const;

/** TypeScript type derived from `OllamaEmbedResponseSchema` via `json-schema-to-ts`. */
export type OllamaEmbedResponseType = FromSchema<typeof OllamaEmbedResponseSchema>;

/** Module-load validator compiled through the framework's shared Ajv. */
export const OllamaEmbedResponseValidator = Validator.compile<OllamaEmbedResponseType>(
  OllamaEmbedResponseSchema,
);
