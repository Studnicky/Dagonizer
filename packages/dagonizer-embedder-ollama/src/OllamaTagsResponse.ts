/**
 * OllamaTagsResponse: JSON Schema 2020-12 description of the Ollama native
 * `GET /api/tags` response wire format — the daemon's installed-model list.
 *
 *   → { "models": [ { "name": "nomic-embed-text:latest", ... }, ... ] }
 *
 * Permissive in the style of `OllamaEmbedResponseSchema`: `additionalProperties`
 * is open on both the envelope and each model entry, and `required` covers only
 * the structurally critical path (`models`, and each entry's `name`). Every other
 * field the daemon returns (`model`, `size`, `digest`, `details`, …) is carried
 * through untyped.
 *
 * Schema `$id` is namespaced to this package (distinct from the adapter package's
 * schema, which lives at `…/dagonizer/OllamaTagsResponse`) so the two can coexist
 * in the same shared Ajv instance without collision.
 *
 * The validator is compiled once at module load through the framework's shared
 * Ajv via `Validator.compile`; the embedder never instantiates its own Ajv.
 */

import { Validator } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export const OllamaTagsResponseSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/embedder/ollama/OllamaTagsResponse',
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
          'size': { 'type': 'number' },
        },
        'additionalProperties': true,
      },
    },
  },
  'additionalProperties': true,
} as const;

/** TypeScript type derived from `OllamaTagsResponseSchema` via `json-schema-to-ts`. */
export type OllamaTagsResponseType = FromSchema<typeof OllamaTagsResponseSchema>;

/** Module-load validator compiled through the framework's shared Ajv. */
export const OllamaTagsResponseValidator = Validator.compile<OllamaTagsResponseType>(
  OllamaTagsResponseSchema,
);
