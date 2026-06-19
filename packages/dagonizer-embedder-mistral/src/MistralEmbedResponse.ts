/**
 * MistralEmbedResponse: JSON Schema 2020-12 description of the Mistral
 * la Plateforme `/v1/embeddings` response wire format.
 *
 *   → { "data": [ { "embedding": number[] } ] }
 *
 * Permissive in the style of `OpenAiResponseBodySchema`: `additionalProperties`
 * is open and `required` is set only on the structurally critical path
 * (`data[].embedding`). The empty-`data`/empty-`embedding` cases are
 * rejected by the embedder after validation, not by the schema.
 *
 * The validator is compiled once at module load through the framework's
 * shared Ajv via `Validator.compile`; the embedder never instantiates its
 * own Ajv.
 */

import { Validator } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export const MistralEmbedResponseSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/MistralEmbedResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['data'],
  'properties': {
    'data': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': ['embedding'],
        'properties': {
          'embedding': {
            'type': 'array',
            'items': { 'type': 'number' },
          },
        },
        'additionalProperties': true,
      },
    },
  },
  'additionalProperties': true,
} as const;

/** TypeScript type derived from `MistralEmbedResponseSchema` via `json-schema-to-ts`. */
export type MistralEmbedResponseType = FromSchema<typeof MistralEmbedResponseSchema>;

/** Module-load validator compiled through the framework's shared Ajv. */
export const MistralEmbedResponseValidator = Validator.compile<MistralEmbedResponseType>(
  MistralEmbedResponseSchema,
);
