/**
 * GeminiResponseBody: JSON Schema 2020-12 description of the Google AI
 * Studio `generateContent` response wire format.
 *
 * Mirrors `packages/dagonizer/src/adapter/OpenAiResponseBody.ts`: every
 * external wire shape is a `*Schema` const with its TypeScript type
 * derived via `json-schema-to-ts` `FromSchema`. The schema is
 * deliberately permissive (`additionalProperties: true`, no top-level
 * `required`) because Gemini omits `candidates`/`usageMetadata` on empty
 * or blocked responses; `#decodeResponse` handles the absent cases
 * explicitly. The single structural invariant — `candidates` is an array
 * when present — is expressed by the schema and enforced by the
 * compiled validator on `geminiResponseBodyValidator`.
 *
 * The validator is compiled once at module load via the engine's shared
 * `Validator.compile` (`@studnicky/dagonizer/validation`); the package
 * never instantiates its own Ajv.
 */

import type { EntityValidatorInterface } from '@studnicky/dagonizer/validation';
import { Validator } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export const GeminiFunctionCallSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['name'],
  'properties': {
    'name': { 'type': 'string' },
    'args': { 'type': 'object', 'additionalProperties': true },
  },
  'additionalProperties': true,
} as const;

export const GeminiPartSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'text': { 'type': 'string' },
    'functionCall': GeminiFunctionCallSchema,
  },
  'additionalProperties': true,
} as const;

export const GeminiContentSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'parts': {
      'type': 'array',
      'items': GeminiPartSchema,
    },
  },
  'additionalProperties': true,
} as const;

export const GeminiCandidateSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'content': GeminiContentSchema,
    'finishReason': { 'type': 'string' },
  },
  'additionalProperties': true,
} as const;

export const GeminiUsageMetadataSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'promptTokenCount': { 'type': 'number' },
    'candidatesTokenCount': { 'type': 'number' },
  },
  'additionalProperties': true,
} as const;

export const GeminiResponseBodySchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer-adapter-gemini-api/GeminiResponseBody',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'candidates': {
      'type': 'array',
      'items': GeminiCandidateSchema,
    },
    'usageMetadata': GeminiUsageMetadataSchema,
  },
  'additionalProperties': true,
} as const;

/** TypeScript type derived from `GeminiResponseBodySchema` via `json-schema-to-ts`. */
export type GeminiResponseBodyType = FromSchema<typeof GeminiResponseBodySchema>;

/**
 * Validator for the Gemini `generateContent` response body, compiled once
 * at module load through the engine's shared Ajv (`Validator.compile`).
 * `#performChat` narrows the `unknown` HTTP body through `.is(value)` at
 * the network boundary.
 */
export const geminiResponseBodyValidator: EntityValidatorInterface<GeminiResponseBodyType> =
  Validator.compile<GeminiResponseBodyType>(GeminiResponseBodySchema);
