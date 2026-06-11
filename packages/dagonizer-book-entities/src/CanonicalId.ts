/**
 * CanonicalId: normalize ids across book-source tools.
 *
 * Every collection tool (OpenLibrary, Google Books, Wikipedia) emits
 * a `Candidate` whose `book.identity.isbn` field is the canonical id.
 * The canonical id, in priority order:
 *
 *   1. ISBN-13: preferred (universally unique)
 *   2. ISBN-10: accepted (older catalogue records)
 *   3. urn:isbn:<x>: when only one of either ISBN form is reachable
 *   4. urn:work:<slug>: generated from normalized "title|first-author"
 *                       lowercased + non-alphanum-stripped, so the same
 *                       work indexed by OpenLibrary key, Google Books
 *                       volumeId, and Wikipedia title still de-duplicates.
 *
 * `merge(a, b)` unions two Candidates that resolved to the same
 * canonical id, keeping the richest description, the longest author
 * list, and the union of `sources[]` and `notes`.
 *
 * ### Dispatch-map design for `mergePublication`
 *
 * BookPublication has five fields governed by three merge strategies:
 *
 *   longest       → pick the longer of two optional strings  (summary)
 *   first-defined → first non-undefined number value         (firstPublishYear)
 *   unique-union  → deduplicated union of two string arrays  (languages, publishers, subjects)
 *
 * The dispatch map `PUBLICATION_MERGE_MAP` names each field and its strategy.
 * `mergePublication` walks the map and routes to the appropriate branch so the
 * per-field repetition disappears. Adding or renaming a BookPublication field
 * only requires updating the map.
 */

import { BookEntitiesError } from './BookEntitiesError.js';
import type { Book, BookAvailability, BookIdentity, BookPublication, Candidate } from './entities.js';

// ── Dispatch map types ─────────────────────────────────────────────────────────

interface LongestEntry     { readonly 'kind': 'longest';       readonly 'key': 'summary' }
interface FirstDefEntry    { readonly 'kind': 'first-defined'; readonly 'key': 'firstPublishYear' }
interface UniqueUnionEntry { readonly 'kind': 'unique-union';  readonly 'key': 'languages' | 'publishers' | 'subjects' }

type PublicationMergeEntry = LongestEntry | FirstDefEntry | UniqueUnionEntry;

/**
 * Dispatch map: one entry per BookPublication field.
 * The loop in `mergePublication` routes each entry to the appropriately-typed
 * branch, eliminating all per-field ternary spreads.
 */
const PUBLICATION_MERGE_MAP: readonly PublicationMergeEntry[] = [
  { 'kind': 'longest',       'key': 'summary'          },
  { 'kind': 'first-defined', 'key': 'firstPublishYear'  },
  { 'kind': 'unique-union',  'key': 'languages'         },
  { 'kind': 'unique-union',  'key': 'publishers'        },
  { 'kind': 'unique-union',  'key': 'subjects'          },
];

export class CanonicalId {
  private constructor() { /* static class */ }

  /** Pick the best id from an array of possible ISBNs. */
  static fromIsbns(isbns: readonly string[] | undefined): string | null {
    if (isbns === undefined || isbns.length === 0) return null;
    const thirteen = isbns.find(
      (s) => s.length === 13 && (s.startsWith('978') || s.startsWith('979')),
    );
    if (thirteen !== undefined) return thirteen;
    const ten = isbns.find((s) => s.length === 10);
    if (ten !== undefined) return ten;
    const first = isbns[0];
    return first !== undefined && first.length > 0 ? first : null;
  }

  /** Generate a stable work URN from title + first author (case + punct stripped). */
  static fromWork(title: string, firstAuthor: string | undefined): string {
    const slugTitle  = CanonicalId.slugify(title);
    const slugAuthor = CanonicalId.slugify(firstAuthor ?? 'unknown');
    return `urn:work:${slugTitle}::${slugAuthor}`;
  }

  /** Normalise a string to a URL-safe slug (lowercase, non-alphanum → dash, trim dashes). */
  static slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '');
  }

  /** Compose: ISBN if present, else work URN. */
  static pick(input: {
    readonly isbns?:   readonly string[];
    readonly title:    string;
    readonly authors?: readonly string[];
  }): string {
    const isbn = CanonicalId.fromIsbns(input.isbns);
    if (isbn !== null) return isbn;
    return CanonicalId.fromWork(input.title, input.authors?.[0]);
  }

  /**
   * Merge two candidates that share the same canonical id. Keeps the
   * richest individual field, unions list fields, accumulates `sources[]`
   * (carried in `book.notes._sources`) and `notes`.
   */
  static merge(a: Candidate, b: Candidate): Candidate {
    const identity    = CanonicalId.mergeIdentity(a.book.identity, b.book.identity);
    const publication = CanonicalId.mergePublication(a.book.publication, b.book.publication);
    const availability = CanonicalId.mergeAvailability(a.book.availability, b.book.availability);
    const sources = CanonicalId.unique([
      ...CanonicalId.sourceList(a),
      ...CanonicalId.sourceList(b),
    ]);
    const book: Book = { 'identity': identity, 'publication': publication, 'availability': availability };

    return {
      'book':   book,
      'score':  Math.max(a.score, b.score),
      'source': sources.join('+'),
      ...(a.reason ?? b.reason ? { 'reason': a.reason ?? b.reason ?? '' } : {}),
      'notes': {
        ...(a.notes ?? {}),
        ...(b.notes ?? {}),
        '_sources': sources,
      },
    };
  }

  /**
   * Dedupe a candidate stream by canonical id, merging when two
   * candidates collide. The first occurrence's order is preserved.
   */
  static dedupe(candidates: readonly Candidate[]): readonly Candidate[] {
    const byId = new Map<string, Candidate>();
    const order: string[] = [];
    for (const c of candidates) {
      const isbn = c.book.identity.isbn;
      const prior = byId.get(isbn);
      if (prior === undefined) {
        byId.set(isbn, c);
        order.push(isbn);
      } else {
        byId.set(isbn, CanonicalId.merge(prior, c));
      }
    }
    return order.map((id) => {
      const candidate = byId.get(id);
      if (candidate === undefined) throw new BookEntitiesError(`unreachable: missing canonical id ${id}`);
      return candidate;
    });
  }

  // ── Private merge helpers ──────────────────────────────────────────────────

  private static mergeIdentity(a: BookIdentity, b: BookIdentity): BookIdentity {
    return {
      'isbn':    a.isbn,
      'title':   a.title.length >= b.title.length ? a.title : b.title,
      'authors': CanonicalId.unique([...a.authors, ...b.authors]),
    };
  }

  /**
   * Merge two BookPublication values using the dispatch map.
   *
   * The map drives three typed branches so no per-field ternary spreads are
   * needed. TypeScript narrows `entry.key` inside each `case` block, letting
   * each branch access only the fields it was designed for.
   */
  private static mergePublication(a: BookPublication, b: BookPublication): BookPublication {
    let summary: string | undefined;
    let firstPublishYear: number | undefined;
    let languages: readonly string[] = [];
    let publishers: readonly string[] = [];
    let subjects: readonly string[] = [];

    for (const entry of PUBLICATION_MERGE_MAP) {
      switch (entry.kind) {
        case 'longest':
          summary = CanonicalId.longest(a[entry.key], b[entry.key]);
          break;
        case 'first-defined':
          firstPublishYear = a[entry.key] ?? b[entry.key];
          break;
        case 'unique-union':
          switch (entry.key) {
            case 'languages':  languages  = CanonicalId.unique([...a.languages,  ...b.languages]);  break;
            case 'publishers': publishers = CanonicalId.unique([...a.publishers, ...b.publishers]); break;
            case 'subjects':   subjects   = CanonicalId.unique([...a.subjects,   ...b.subjects]);   break;
          }
          break;
      }
    }

    return { 'summary': summary, 'firstPublishYear': firstPublishYear, 'languages': languages, 'publishers': publishers, 'subjects': subjects };
  }

  private static mergeAvailability(a: BookAvailability, b: BookAvailability): BookAvailability {
    return {
      'price':   a.price.amount > 0 ? a.price : b.price,
      'inStock': a.inStock ?? b.inStock,
    };
  }

  private static unique<T>(values: readonly T[]): T[] {
    const seen = new Set<T>();
    const out: T[] = [];
    for (const v of values) {
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  private static longest(a: string | undefined, b: string | undefined): string | undefined {
    if (a === undefined) return b;
    if (b === undefined) return a;
    return a.length >= b.length ? a : b;
  }

  private static sourceList(c: Candidate): string[] {
    const fromNotes = c.notes?.['_sources'];
    if (Array.isArray(fromNotes)) return fromNotes.filter((s): s is string => typeof s === 'string');
    return c.source.split('+').map((s) => s.trim()).filter(Boolean);
  }
}
