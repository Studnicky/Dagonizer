/**
 * OpenAiStreamChunk: JSON Schema 2020-12 description of one `data:` line's
 * JSON payload from an OpenAI-compatible `chat/completions` SSE stream
 * (`stream: true`, `stream_options: { include_usage: true }`).
 *
 * Deliberately permissive, mirroring `OpenAiResponseBody`: `choices` is the
 * one required structural invariant (present, possibly empty on the final
 * usage-only chunk); `delta.content` and `finish_reason` are optional/null
 * since intermediate chunks omit them.
 *
 * Compiled once via `Validator.compile` alongside the rest of the
 * OpenAI-compatible wire shapes; never build a new Ajv.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { OpenAiUsageSchema } from './OpenAiResponseBody.js';

/** JSON Schema for the `delta` object inside one streamed choice. */
export const OpenAiStreamDeltaSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'content': { 'type': ['string', 'null'] },
  },
  'additionalProperties': true,
} as const;

/** JSON Schema for one streamed choice (`{ delta, finish_reason }`). */
export const OpenAiStreamChoiceSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'delta': OpenAiStreamDeltaSchema,
    'finish_reason': { 'type': ['string', 'null'] },
  },
  'additionalProperties': true,
} as const;

export const OpenAiStreamChunkSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/OpenAiStreamChunk',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['choices'],
  'properties': {
    'choices': {
      'type': 'array',
      'items': OpenAiStreamChoiceSchema,
    },
    'usage': OpenAiUsageSchema,
  },
  'additionalProperties': true,
} as const;

/** TypeScript type derived from `OpenAiStreamChunkSchema` via `json-schema-to-ts`. */
export type OpenAiStreamChunkType = FromSchema<typeof OpenAiStreamChunkSchema>;
