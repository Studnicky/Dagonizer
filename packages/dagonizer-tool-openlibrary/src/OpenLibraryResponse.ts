/**
 * OpenLibraryResponse: JSON Schema 2020-12 description of the OpenLibrary
 * `search.json` response wire shape, plus its `FromSchema`-derived types and a
 * module-load-compiled `EntityValidator`.
 *
 * The parsed JSON body crosses a foreign boundary (`HttpTransport.getJson`
 * returns it narrowed by `OpenLibraryResponseValidator`). The schema is
 * permissive (`additionalProperties: true`); only the fields the tool maps are
 * typed. `description` is a `string` or a `{ value }` object across OpenLibrary
 * editions, modelled as a `oneOf`.
 *
 * Compiled once at module load through `Validator.compile` (the package's
 * single shared Ajv instance) — never a hand-written predicate, never a
 * per-package Ajv.
 */

import { Validator } from '@studnicky/dagonizer/validation';
import type { EntityValidator } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export const OpenLibraryDocSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'title':              { 'type': 'string' },
    'subtitle':           { 'type': 'string' },
    'author_name':        { 'type': 'array', 'items': { 'type': 'string' } },
    'isbn':               { 'type': 'array', 'items': { 'type': 'string' } },
    'first_publish_year': { 'type': 'integer' },
    'publisher':          { 'type': 'array', 'items': { 'type': 'string' } },
    'subject':            { 'type': 'array', 'items': { 'type': 'string' } },
    'key':                { 'type': 'string' },
    'first_sentence':     { 'type': 'array', 'items': { 'type': 'string' } },
    'description': {
      'oneOf': [
        { 'type': 'string' },
        {
          'type': 'object',
          'properties': { 'value': { 'type': 'string' } },
          'additionalProperties': true,
        },
      ],
    },
    'language': { 'type': 'array', 'items': { 'type': 'string' } },
  },
  'additionalProperties': true,
} as const;

export type OpenLibraryDoc = FromSchema<typeof OpenLibraryDocSchema>;

export const OpenLibraryResponseSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer-tool-openlibrary/OpenLibraryResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'docs':     { 'type': 'array', 'items': OpenLibraryDocSchema },
    'numFound': { 'type': 'number' },
  },
  'additionalProperties': true,
} as const;

/** TypeScript type derived from `OpenLibraryResponseSchema` via `json-schema-to-ts`. */
export type OpenLibraryResponse = FromSchema<typeof OpenLibraryResponseSchema>;

/**
 * Module-load-compiled validator for the OpenLibrary search response.
 * Narrows the `unknown` HTTP body to `OpenLibraryResponse` via the framework's
 * shared Ajv (`Validator.compile`); `OpenLibraryDocs.narrowResponse` /
 * `HttpTransport.getJson` consume it.
 */
export const OpenLibraryResponseValidator: EntityValidator<OpenLibraryResponse> =
  Validator.compile<OpenLibraryResponse>(OpenLibraryResponseSchema);
