/**
 * WikipediaSummaryResponse: JSON Schema 2020-12 description of the Wikipedia
 * REST `page/summary` response wire shape, plus its `FromSchema`-derived type
 * and a module-load-compiled `EntityValidatorInterface`.
 *
 * The parsed JSON body crosses a foreign boundary (`HttpTransport.getJson`
 * returns it narrowed by `WikipediaSummaryResponseValidator`). The schema is
 * permissive (`additionalProperties: true`); the tool reads only `title`,
 * `description`, `extract`, `type`, `content_urls`, and `thumbnail`.
 *
 * Compiled once at module load through `Validator.compile` (the package's
 * single shared Ajv instance) — never a hand-written predicate, never a
 * per-package Ajv.
 */

import { Validator } from '@studnicky/dagonizer/validation';
import type { EntityValidatorInterface } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export const WikipediaSummaryResponseSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer-tool-wikipedia/WikipediaSummaryResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'title':       { 'type': 'string' },
    'description': { 'type': 'string' },
    'extract':     { 'type': 'string' },
    'type':        { 'type': 'string' },
    'content_urls': {
      'type': 'object',
      'properties': {
        'desktop': {
          'type': 'object',
          'properties': { 'page': { 'type': 'string' } },
          'additionalProperties': true,
        },
      },
      'additionalProperties': true,
    },
    'thumbnail': {
      'type': 'object',
      'properties': { 'source': { 'type': 'string' } },
      'additionalProperties': true,
    },
  },
  'additionalProperties': true,
} as const;

/** TypeScript type derived from `WikipediaSummaryResponseSchema` via `json-schema-to-ts`. */
export type WikipediaSummaryResponseType = FromSchema<typeof WikipediaSummaryResponseSchema>;

/**
 * Module-load-compiled validator for the Wikipedia summary response.
 * Narrows the `unknown` HTTP body to `WikipediaSummaryResponseType` via the
 * framework's shared Ajv (`Validator.compile`); `HttpTransport.getJson`
 * consumes it.
 */
export const WikipediaSummaryResponseValidator: EntityValidatorInterface<WikipediaSummaryResponseType> =
  Validator.compile<WikipediaSummaryResponseType>(WikipediaSummaryResponseSchema);
