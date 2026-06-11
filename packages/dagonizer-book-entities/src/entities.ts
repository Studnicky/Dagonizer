/**
 * Book entity model: composed sub-entities grouped by concern.
 *
 * Each sub-entity owns one cohesive responsibility:
 *   BookIdentity    — stable identifiers: isbn, title, authors
 *   BookPublication — bibliographic metadata: year, publishers, languages, subjects, summary
 *   BookAvailability — commercial metadata: price, inStock
 *
 * Book composes all three (interface). BookBuilder.from(partial) materialises
 * a complete Book from the sparse data the tool layer collects, applying
 * required-with-defaults within each sub-entity so consumers never deal with
 * undefined on the composed properties.
 *
 * Candidate wraps a scored Book with provenance (source, notes, reason).
 */

export interface Money {
  readonly amount: number;
  readonly currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD';
}

/** Stable identifiers for the work. */
export interface BookIdentity {
  /** ISBN-13, ISBN-10, or a stable opaque id (work URN, wiki slug, etc.). */
  readonly isbn: string;
  readonly title: string;
  readonly authors: readonly string[];
}

/**
 * Bibliographic metadata. Optional fields carry `undefined` when the source
 * did not supply them; BookBuilder.from() fills array-fields with empty arrays.
 */
export interface BookPublication {
  /** First publication year, when known. */
  readonly firstPublishYear: number | undefined;
  /**
   * ISO 639-2 (alpha-3) language codes attributed to this book by its
   * source (e.g. `['eng']`, `['jpn']`). Empty array means the source
   * did not report a language; downstream language filters treat an
   * empty array as "do not exclude" so legacy records degrade gracefully.
   */
  readonly languages: readonly string[];
  /** Publisher names, when known. */
  readonly publishers: readonly string[];
  /** Subjects / themes / topics, when known. */
  readonly subjects: readonly string[];
  /** Editorial description or summary, when the source supplies one. */
  readonly summary: string | undefined;
}

/** Commercial availability metadata. */
export interface BookAvailability {
  readonly price: Money;
  readonly inStock: boolean | undefined;
}

/** Complete composed book record. */
export interface Book {
  readonly identity: BookIdentity;
  readonly publication: BookPublication;
  readonly availability: BookAvailability;
}

// ── Module-level defaults ──────────────────────────────────────────────────────

const DEFAULT_PRICE: Money = { 'amount': 0, 'currency': 'USD' };

/** Partial input the tool layer supplies; BookBuilder.from() fills defaults. */
export interface BookInput {
  readonly isbn: string;
  readonly title: string;
  readonly authors?: readonly string[];
  readonly firstPublishYear?: number;
  readonly languages?: readonly string[];
  readonly publishers?: readonly string[];
  readonly subjects?: readonly string[];
  readonly summary?: string;
  readonly price?: Money;
  readonly inStock?: boolean;
}

/**
 * BookBuilder: static factory for the `Book` interface.
 *
 * Separate from the `Book` interface because TypeScript cannot merge a class
 * and interface of the same name without aliasing. The name `BookBuilder`
 * makes the role explicit — it is the constructor for the `Book` value type.
 */
export class BookBuilder {
  private constructor() { /* static class */ }

  /** Materialise a complete Book from partial tool output. Applies defaults. */
  static from(input: BookInput): Book {
    return {
      'identity': {
        'isbn':    input.isbn,
        'title':   input.title,
        'authors': input.authors ?? [],
      },
      'publication': {
        'firstPublishYear': input.firstPublishYear,
        'languages':        input.languages  ?? [],
        'publishers':       input.publishers ?? [],
        'subjects':         input.subjects   ?? [],
        'summary':          input.summary,
      },
      'availability': {
        'price':   input.price ?? DEFAULT_PRICE,
        'inStock': input.inStock,
      },
    };
  }
}

export interface Candidate {
  readonly book: Book;
  readonly score: number;
  readonly source: string;
  readonly reason?: string;
  readonly notes?: Readonly<Record<string, unknown>>;
}
