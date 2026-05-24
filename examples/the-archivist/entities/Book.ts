/**
 * Book — the catalog record vocabulary the assistant operates on.
 *
 * Same shape as json-tology's bookstore demo (`urn:bookstore:Book`) so
 * docs that already use the bookstore vocabulary cross-reference cleanly.
 * Authors are kept as a string array; price is a `Money` pair.
 */

export interface Money {
  readonly amount: number;
  readonly currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD';
}

export interface Book {
  /** Either an ISBN-13 / ISBN-10, or a stable opaque id (e.g. OpenLibrary `/works/OL5728424W`). */
  readonly isbn: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly price: Money;
  /** Editorial description or summary, when the source supplies one. */
  readonly summary?: string;
  /** First publication year, when known. */
  readonly firstPublishYear?: number;
  /** Subjects / themes / topics, when known. */
  readonly subjects?: readonly string[];
  /** Publishers, when known. */
  readonly publishers?: readonly string[];
  readonly inStock?: boolean;
  /**
   * ISO 639-2 (alpha-3) language codes attributed to this book by its
   * source (e.g. `['eng']`, `['jpn']`). Empty / undefined when the
   * source did not report a language — downstream language filters
   * treat unknown as "do not exclude" so legacy records pass through.
   */
  readonly languages?: readonly string[];
}

/** A book ranked against the user's query. */
export interface Candidate {
  readonly book: Book;
  /** Score in [0, 1]. Higher = stronger match against the query. */
  readonly score: number;
  /** Where this candidate came from. */
  readonly source: 'web-search' | string;
  /** Why the LLM scored it as it did. Free-text. */
  readonly reason?: string;
  /**
   * Freeform key/value metadata the LLM (or scout) attached to this
   * candidate — e.g. `{ vibe: 'liminal', confidence: 0.7, genre: 'cosmic-horror' }`.
   * Encouraged by the rank-candidates JSON Schema (additionalProperties:true).
   */
  readonly notes?: Readonly<Record<string, unknown>>;
}
