/**
 * BookCandidate: book-domain output shape this tool emits.
 *
 * Co-located with the tool because each `Tool` plugin owns its output
 * vocabulary. Consumers map BookCandidate into their own domain shape
 * via an adapter node (see `examples/the-archivist/nodes/scouts.ts`).
 */

export interface Money {
  readonly amount: number;
  readonly currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD';
}

export interface Book {
  readonly isbn: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly price: Money;
  readonly summary?: string;
  readonly firstPublishYear?: number;
  readonly subjects?: readonly string[];
  readonly publishers?: readonly string[];
  readonly inStock?: boolean;
  /**
   * ISO 639-2 (alpha-3) language codes the source attributes to this
   * book (e.g. `['eng']`, `['jpn']`). OpenLibrary emits an array here;
   * other sources may map a single language onto a one-element array.
   * Empty / undefined means the source did not report a language;
   * downstream filters treat that as "do not exclude" so unknown-
   * language records degrade gracefully.
   */
  readonly languages?: readonly string[];
}

export interface Candidate {
  readonly book: Book;
  readonly score: number;
  readonly source: 'web-search' | string;
  readonly reason?: string;
  readonly notes?: Readonly<Record<string, unknown>>;
}
