/**
 * GoogleBooksResponse: JSON Schema 2020-12 description of the Google Books v1
 * `volumes` response wire shape, plus its `FromSchema`-derived type and a
 * module-load-compiled `EntityValidatorInterface`.
 *
 * The parsed JSON body crosses a foreign boundary (`HttpTransport.getJson`
 * returns it narrowed by `GoogleBooksResponseValidator`). The schema is
 * deliberately permissive (`additionalProperties: true`, only the structurally
 * critical `items`/`totalItems` typed) because Google's volumes payload carries
 * many fields the tool ignores; `execute()` reads only the fields it maps.
 *
 * Compiled once at module load through `Validator.compile` (the package's
 * single shared Ajv instance) — never a hand-written predicate, never a
 * per-package Ajv.
 */

import { Validator } from '@studnicky/dagonizer/validation';
import type { EntityValidatorInterface } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export const GoogleBooksVolumeInfoSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'title':         { 'type': 'string' },
    'subtitle':      { 'type': 'string' },
    'authors':       { 'type': 'array', 'items': { 'type': 'string' } },
    'publishedDate': { 'type': 'string' },
    'description':   { 'type': 'string' },
    'publisher':     { 'type': 'string' },
    'categories':    { 'type': 'array', 'items': { 'type': 'string' } },
    'averageRating': { 'type': 'number' },
    'ratingsCount':  { 'type': 'number' },
    'industryIdentifiers': {
      'type': 'array',
      'items': {
        'type': 'object',
        'properties': {
          'type':       { 'type': 'string' },
          'identifier': { 'type': 'string' },
        },
        'additionalProperties': true,
      },
    },
    'imageLinks': {
      'type': 'object',
      'properties': { 'thumbnail': { 'type': 'string' } },
      'additionalProperties': true,
    },
    'language': { 'type': 'string' },
  },
  'additionalProperties': true,
} as const;

export const GoogleBooksVolumeSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'id':         { 'type': 'string' },
    'volumeInfo': GoogleBooksVolumeInfoSchema,
  },
  'additionalProperties': true,
} as const;

export const GoogleBooksResponseSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer-tool-googlebooks/GoogleBooksResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'items':      { 'type': 'array', 'items': GoogleBooksVolumeSchema },
    'totalItems': { 'type': 'number' },
  },
  'additionalProperties': true,
} as const;

/** TypeScript type derived from `GoogleBooksResponseSchema` via `json-schema-to-ts`. */
export type GoogleBooksResponseType = FromSchema<typeof GoogleBooksResponseSchema>;

/**
 * Module-load-compiled validator for the Google Books volumes response.
 * Narrows the `unknown` HTTP body to `GoogleBooksResponseType` via the framework's
 * shared Ajv (`Validator.compile`); `OpenApiGuard.assertShape` /
 * `HttpTransport.getJson` consume it.
 */
export const GoogleBooksResponseValidator: EntityValidatorInterface<GoogleBooksResponseType> =
  Validator.compile<GoogleBooksResponseType>(GoogleBooksResponseSchema);
