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
import type { BookAvailabilityType, BookIdentityType, BookPublicationType, BookType, CandidateType } from './entities.js';

// ── Dispatch map types ─────────────────────────────────────────────────────────

type LongestEntryType     = { readonly 'variant': 'longest';       readonly 'key': 'summary' };
type FirstDefEntryType    = { readonly 'variant': 'first-defined'; readonly 'key': 'firstPublishYear' };
type UniqueUnionEntryType = { readonly 'variant': 'unique-union';  readonly 'key': 'languages' | 'publishers' | 'subjects' };

type PublicationMergeEntryType = LongestEntryType | FirstDefEntryType | UniqueUnionEntryType;

/**
 * Dispatch map: one entry per BookPublication field.
 * The loop in `mergePublication` routes each entry to the appropriately-typed
 * branch, eliminating all per-field ternary spreads.
 */
const PUBLICATION_MERGE_MAP: readonly PublicationMergeEntryType[] = [
  { 'variant': 'longest',       'key': 'summary'          },
  { 'variant': 'first-defined', 'key': 'firstPublishYear'  },
  { 'variant': 'unique-union',  'key': 'languages'         },
  { 'variant': 'unique-union',  'key': 'publishers'        },
  { 'variant': 'unique-union',  'key': 'subjects'          },
];

export class CanonicalId {
  private constructor() { /* static class */ }

  /** Pick the best id from an array of possible ISBNs. */
  static ofIsbns(isbns: readonly string[] | undefined): string | null {
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
  static ofWork(title: string, firstAuthor: string | undefined): string {
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
    const isbn = CanonicalId.ofIsbns(input.isbns);
    if (isbn !== null) return isbn;
    return CanonicalId.ofWork(input.title, input.authors?.[0]);
  }

  /**
   * Merge two candidates that share the same canonical id. Keeps the
   * richest individual field, unions list fields, accumulates `sources[]`
   * (carried in `book.notes._sources`) and `notes`.
   */
  static merge(a: CandidateType, b: CandidateType): CandidateType {
    const identity    = CanonicalId.mergeIdentity(a.book.identity, b.book.identity);
    const publication = CanonicalId.mergePublication(a.book.publication, b.book.publication);
    const availability = CanonicalId.mergeAvailability(a.book.availability, b.book.availability);
    const sources = CanonicalId.unique([
      ...CanonicalId.sourceList(a),
      ...CanonicalId.sourceList(b),
    ]);
    const book: BookType = { 'identity': identity, 'publication': publication, 'availability': availability };

    return {
      'book':   book,
      'score':  Math.max(a.score, b.score),
      'source': sources.join('+'),
      ...(a.reason ?? b.reason ? { 'reason': a.reason ?? b.reason ?? '' } : {}),
      'notes': {
        ...(a.notes ?? {}),
        ...(b.notes ?? {}),
        'sources': sources,
      },
    };
  }

  /**
   * Dedupe a candidate stream by canonical id, merging when two
   * candidates collide. The first occurrence's order is preserved.
   */
  static dedupe(candidates: readonly CandidateType[]): readonly CandidateType[] {
    const byId = new Map<string, CandidateType>();
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

  private static mergeIdentity(a: BookIdentityType, b: BookIdentityType): BookIdentityType {
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
   * needed. Each variant handler accesses only the fields it was designed for.
   */
  private static mergePublication(a: BookPublicationType, b: BookPublicationType): BookPublicationType {
    let summary: string | null = null;
    let firstPublishYear: number | null = null;
    let languages: string[] = [];
    let publishers: string[] = [];
    let subjects: string[] = [];

    // Dispatch map over merge variant: each handler applies its strategy.
    const variantDispatch: Record<PublicationMergeEntryType['variant'], (e: PublicationMergeEntryType) => void> = {
      'longest': () => {
        summary = CanonicalId.longest(a.summary, b.summary);
      },
      'first-defined': () => {
        firstPublishYear = a.firstPublishYear ?? b.firstPublishYear;
      },
      'unique-union': (e) => {
        const ue = e as UniqueUnionEntryType;
        // Dispatch map over key: each handler unions the specific array field.
        const keyDispatch: Record<UniqueUnionEntryType['key'], () => void> = {
          'languages':  () => { languages  = CanonicalId.unique([...a.languages,  ...b.languages]);  },
          'publishers': () => { publishers = CanonicalId.unique([...a.publishers, ...b.publishers]); },
          'subjects':   () => { subjects   = CanonicalId.unique([...a.subjects,   ...b.subjects]);   },
        };
        keyDispatch[ue.key]();
      },
    };

    for (const entry of PUBLICATION_MERGE_MAP) {
      variantDispatch[entry.variant](entry);
    }

    return { 'summary': summary, 'firstPublishYear': firstPublishYear, 'languages': languages, 'publishers': publishers, 'subjects': subjects };
  }

  private static mergeAvailability(a: BookAvailabilityType, b: BookAvailabilityType): BookAvailabilityType {
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

  private static longest(a: string | null, b: string | null): string | null {
    if (a === null) return b;
    if (b === null) return a;
    return a.length >= b.length ? a : b;
  }

  private static sourceList(c: CandidateType): string[] {
    const noteSources = c.notes?.['sources'];
    if (Array.isArray(noteSources)) return noteSources.filter((s): s is string => typeof s === 'string');
    return c.source.split('+').map((s) => s.trim()).filter(Boolean);
  }
}
