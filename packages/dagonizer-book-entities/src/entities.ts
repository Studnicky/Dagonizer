/**
 * Book entity model: composed sub-entities grouped by concern.
 *
 * Every wire-shape entity is a JSON Schema 2020-12 `*Schema` const; its
 * TypeScript type is derived from the schema via `FromSchema`, so the schema
 * is the single source of truth and no hand-written wire shape exists.
 *
 * Each sub-entity owns one cohesive responsibility:
 *   BookIdentityType     — stable identifiers: isbn, title, authors
 *   BookPublicationType  — bibliographic metadata: year, languages, publishers,
 *                          subjects, summary
 *   BookAvailabilityType — commercial metadata: price, inStock
 *
 * `BookType` composes all three. `BookBuilder.from(partial)` materialises a
 * complete `BookType` from the sparse data the tool layer collects, applying
 * required-with-defaults within each sub-entity so consumers never deal with
 * an absent property. Fields whose source value may be genuinely absent
 * (`firstPublishYear`, `summary`, `inStock`) carry a null sentinel (`T | null`,
 * required key) rather than `T | undefined`: every instance carries the key
 * with a real value, keeping V8 hidden-class shape stable under
 * `exactOptionalPropertyTypes`.
 *
 * `CandidateType` wraps a scored `BookType` with provenance (source, optional
 * reason and notes).
 */

import type { FromSchema } from 'json-schema-to-ts';

export const MoneySchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['amount', 'currency'],
  'properties': {
    'amount': { 'type': 'number' },
    'currency': { 'type': 'string', 'enum': ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'] },
  },
  'additionalProperties': false,
} as const;

export type MoneyType = FromSchema<typeof MoneySchema>;

/** Stable identifiers for the work. */
export const BookIdentitySchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['isbn', 'title', 'authors'],
  'properties': {
    /** ISBN-13, ISBN-10, or a stable opaque id (work URN, wiki slug, etc.). */
    'isbn': { 'type': 'string' },
    'title': { 'type': 'string' },
    'authors': { 'type': 'array', 'items': { 'type': 'string' } },
  },
  'additionalProperties': false,
} as const;

export type BookIdentityType = FromSchema<typeof BookIdentitySchema>;

/**
 * Bibliographic metadata. `firstPublishYear` and `summary` carry a null
 * sentinel when the source did not supply them; array fields default to an
 * empty array. `languages` holds ISO 639-2 (alpha-3) codes attributed by the
 * source (e.g. `['eng']`); an empty array means the source did not report a
 * language and downstream language filters treat it as "do not exclude".
 */
export const BookPublicationSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['firstPublishYear', 'languages', 'publishers', 'subjects', 'summary'],
  'properties': {
    /** First publication year, or `null` when the source did not report one. */
    'firstPublishYear': { 'oneOf': [{ 'type': 'integer' }, { 'type': 'null' }] },
    'languages': { 'type': 'array', 'items': { 'type': 'string' } },
    'publishers': { 'type': 'array', 'items': { 'type': 'string' } },
    'subjects': { 'type': 'array', 'items': { 'type': 'string' } },
    /** Editorial description, or `null` when the source supplies none. */
    'summary': { 'oneOf': [{ 'type': 'string' }, { 'type': 'null' }] },
  },
  'additionalProperties': false,
} as const;

export type BookPublicationType = FromSchema<typeof BookPublicationSchema>;

/** Commercial availability metadata. */
export const BookAvailabilitySchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['price', 'inStock'],
  'properties': {
    'price': MoneySchema,
    /** Stock flag, or `null` when the source does not report availability. */
    'inStock': { 'oneOf': [{ 'type': 'boolean' }, { 'type': 'null' }] },
  },
  'additionalProperties': false,
} as const;

export type BookAvailabilityType = FromSchema<typeof BookAvailabilitySchema>;

/** Complete composed book record. */
export const BookSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer-book-entities/Book',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['identity', 'publication', 'availability'],
  'properties': {
    'identity': BookIdentitySchema,
    'publication': BookPublicationSchema,
    'availability': BookAvailabilitySchema,
  },
  'additionalProperties': false,
} as const;

export type BookType = FromSchema<typeof BookSchema>;

/** Scored book record with provenance. */
export const CandidateSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer-book-entities/Candidate',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['book', 'score', 'source'],
  'properties': {
    'book': BookSchema,
    'score': { 'type': 'number' },
    'source': { 'type': 'string' },
    'reason': { 'type': 'string' },
    'notes': { 'type': 'object', 'additionalProperties': true },
  },
  'additionalProperties': false,
} as const;

export type CandidateType = FromSchema<typeof CandidateSchema>;

// ── Module-level defaults ──────────────────────────────────────────────────────

const DEFAULT_PRICE: MoneyType = { 'amount': 0, 'currency': 'USD' };

/** Partial input the tool layer supplies; `BookBuilder.from()` fills defaults. */
export type BookInputType = {
  readonly isbn: string;
  readonly title: string;
  readonly authors?: readonly string[];
  readonly firstPublishYear?: number;
  readonly languages?: readonly string[];
  readonly publishers?: readonly string[];
  readonly subjects?: readonly string[];
  readonly summary?: string;
  readonly price?: MoneyType;
  readonly inStock?: boolean;
};

/**
 * BookBuilder: static factory for the `BookType` value type.
 *
 * Separate from the `BookType` type because TypeScript cannot merge a class and a
 * type of the same name without reusing that name for the value. The name `BookBuilder` makes the
 * role explicit — it is the constructor for the `BookType` value.
 */
export class BookBuilder {
  private constructor() { /* static class */ }

  /** Materialise a complete BookType from partial tool output. Applies defaults. */
  static from(input: BookInputType): BookType {
    return {
      'identity': {
        'isbn':    input.isbn,
        'title':   input.title,
        'authors': [...(input.authors ?? [])],
      },
      'publication': {
        'firstPublishYear': input.firstPublishYear ?? null,
        'languages':        [...(input.languages  ?? [])],
        'publishers':       [...(input.publishers ?? [])],
        'subjects':         [...(input.subjects   ?? [])],
        'summary':          input.summary ?? null,
      },
      'availability': {
        'price':   input.price ?? DEFAULT_PRICE,
        'inStock': input.inStock ?? null,
      },
    };
  }
}
