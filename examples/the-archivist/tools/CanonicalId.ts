/**
 * CanonicalId — normalize ids across book-source tools.
 *
 * Every collection tool (OpenLibrary, Google Books, Wikipedia) emits
 * a `Candidate` whose `book.isbn` field is the canonical id. The
 * canonical id, in priority order:
 *
 *   1. ISBN-13         — preferred (universally unique)
 *   2. ISBN-10         — accepted (older catalogue records)
 *   3. urn:isbn:<x>    — when only one of either ISBN form is reachable
 *   4. urn:work:<slug> — generated from normalized "title|first-author"
 *                       lowercased + non-alphanum-stripped — so the same
 *                       work indexed by OpenLibrary key, Google Books
 *                       volumeId, and Wikipedia title still de-duplicates.
 *
 * `merge(a, b)` unions two Candidates that resolved to the same
 * canonical id — keeping the richest description, the longest author
 * list, and the union of `sources[]` and `notes`.
 */

import type { Candidate } from '../entities/Book.ts';

export class CanonicalId {
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
    const slugTitle  = slugify(title);
    const slugAuthor = firstAuthor !== undefined ? slugify(firstAuthor) : 'unknown';
    return `urn:work:${slugTitle}::${slugAuthor}`;
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
    const mergedAuthors = unique([...a.book.authors, ...b.book.authors]);
    const mergedSubjects = unique([...(a.book.subjects ?? []), ...(b.book.subjects ?? [])]);
    const mergedPublishers = unique([...(a.book.publishers ?? []), ...(b.book.publishers ?? [])]);
    const summary = longest(a.book.summary, b.book.summary);
    const year    = a.book.firstPublishYear ?? b.book.firstPublishYear;
    const sources = unique([
      ...sourceList(a),
      ...sourceList(b),
    ]);
    return {
      'book': {
        'isbn':    a.book.isbn,
        'title':   a.book.title.length >= b.book.title.length ? a.book.title : b.book.title,
        'authors': mergedAuthors,
        'price':   a.book.price.amount > 0 ? a.book.price : b.book.price,
        ...(summary !== undefined ? { 'summary': summary } : {}),
        ...(year !== undefined ? { 'firstPublishYear': year } : {}),
        ...(mergedSubjects.length > 0 ? { 'subjects': mergedSubjects } : {}),
        ...(mergedPublishers.length > 0 ? { 'publishers': mergedPublishers } : {}),
      },
      // Score: keep the higher; sources will all get re-ranked anyway.
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
      const prior = byId.get(c.book.isbn);
      if (prior === undefined) {
        byId.set(c.book.isbn, c);
        order.push(c.book.isbn);
      } else {
        byId.set(c.book.isbn, CanonicalId.merge(prior, c));
      }
    }
    return order.map((id) => {
      const candidate = byId.get(id);
      if (candidate === undefined) throw new Error(`unreachable: missing canonical id ${id}`);
      return candidate;
    });
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function unique<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function longest(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a.length >= b.length ? a : b;
}

function sourceList(c: Candidate): string[] {
  const fromNotes = c.notes?.['_sources'];
  if (Array.isArray(fromNotes)) return fromNotes.filter((s): s is string => typeof s === 'string');
  return c.source.split('+').map((s) => s.trim()).filter(Boolean);
}
