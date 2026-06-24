/**
 * OpenAiResponseBody: JSON Schema 2020-12 description of the OpenAI
 * `chat/completions` response wire format shared by all OpenAI-compatible
 * providers (Groq, Cerebras, Mistral, OpenRouter, Together, …).
 *
 * The schema is deliberately permissive where providers deviate from the
 * canonical spec (all top-level fields are optional; string/null unions
 * where some providers omit nullability). The required structural
 * invariant is that `choices` is an array when present — `#decodeResponse`
 * handles the empty-array and missing-field cases explicitly.
 *
 * Compiled once via `Validator.compile` on `OpenAiCompatibleAdapter`
 * module load; never build a new Ajv.
 */

import type { FromSchema } from 'json-schema-to-ts';

/** JSON Schema for the `function` object nested inside an OpenAI tool-call choice. */
export const OpenAiToolCallFunctionSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['name', 'arguments'],
  'properties': {
    'name': { 'type': 'string' },
    'arguments': { 'type': 'string' },
  },
  'additionalProperties': true,
} as const;

/** JSON Schema for a single OpenAI-style tool call (`{ id, type: 'function', function: … }`). */
export const OpenAiToolCallSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['id', 'type', 'function'],
  'properties': {
    'id': { 'type': 'string' },
    'type': { 'type': 'string', 'const': 'function' },
    'function': OpenAiToolCallFunctionSchema,
  },
  'additionalProperties': true,
} as const;

/** JSON Schema for the `message` object inside a chat completion choice. */
export const OpenAiChoiceMessageSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'content': { 'type': ['string', 'null'] },
    'tool_calls': {
      'type': 'array',
      'items': OpenAiToolCallSchema,
    },
  },
  'additionalProperties': true,
} as const;

/** JSON Schema for a single chat completion choice (`{ message, finish_reason }`). */
export const OpenAiChoiceSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'message': OpenAiChoiceMessageSchema,
    'finish_reason': { 'type': 'string' },
  },
  'additionalProperties': true,
} as const;

/** JSON Schema for the `usage` block (`{ prompt_tokens, completion_tokens }`). */
export const OpenAiUsageSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'prompt_tokens': { 'type': 'number' },
    'completion_tokens': { 'type': 'number' },
  },
  'additionalProperties': true,
} as const;

export const OpenAiResponseBodySchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/OpenAiResponseBody',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'choices': {
      'type': 'array',
      'items': OpenAiChoiceSchema,
    },
    'usage': OpenAiUsageSchema,
  },
  'additionalProperties': true,
} as const;

/** TypeScript type derived from `OpenAiResponseBodySchema` via `json-schema-to-ts`. */
export type OpenAiResponseBodyType = FromSchema<typeof OpenAiResponseBodySchema>;
