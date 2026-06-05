/**
 * Shared OpenLibrary API types and helpers used by both
 * OpenLibrarySearchTool and SubjectSearchTool.
 */

import type { Candidate } from '@noocodex/dagonizer-book-entities';
import { CanonicalId } from '@noocodex/dagonizer-book-entities';

export const OPENLIBRARY_ENDPOINT = 'https://openlibrary.org/search.json';

const MAX_SUBJECTS = 8;
const MAX_PUBLISHERS = 4;

export interface OpenLibraryDoc {
  readonly title?: string;
  readonly subtitle?: string;
  readonly author_name?: readonly string[];
  readonly isbn?: readonly string[];
  readonly first_publish_year?: number;
  readonly publisher?: readonly string[];
  readonly subject?: readonly string[];
  /** Stable OpenLibrary identifier (`/works/OL...W`). Always present. */
  readonly key?: string;
  readonly first_sentence?: readonly string[];
  /** Some search responses include a description; many don't. */
  readonly description?: string | { value?: string };
  /** ISO 639-2 (alpha-3) language codes the work is published in. */
  readonly language?: readonly string[];
}

export interface OpenLibraryResponse {
  readonly docs?: readonly OpenLibraryDoc[];
  readonly numFound?: number;
}

export class OpenLibraryDocs {
  private constructor() { /* static class */ }

  static pickDescription(doc: OpenLibraryDoc): string | undefined {
    if (typeof doc.description === 'string' && doc.description.length > 0) return doc.description;
    if (typeof doc.description === 'object' && typeof doc.description.value === 'string') return doc.description.value;
    const first = doc.first_sentence?.[0];
    if (typeof first === 'string' && first.length > 0) {
      return doc.subtitle !== undefined && doc.subtitle.length > 0
        ? `${doc.subtitle}: ${first}`
        : first;
    }
    if (doc.subtitle !== undefined && doc.subtitle.length > 0) return doc.subtitle;
    return undefined;
  }

  static buildCandidates(
    docs: readonly OpenLibraryDoc[],
    source: string,
    sourcesLabel: string,
  ): Candidate[] {
    const candidates: Candidate[] = [];
    for (const doc of docs) {
      if (doc.title === undefined) continue;
      const canonical = CanonicalId.pick({
        'title':   doc.title,
        ...(doc.isbn !== undefined        && { 'isbns': doc.isbn }),
        ...(doc.author_name !== undefined && { 'authors': doc.author_name }),
      });
      const summary  = OpenLibraryDocs.pickDescription(doc);
      const subjects = doc.subject?.slice(0, MAX_SUBJECTS);
      const notes: Record<string, unknown> = {
        '_sources': [sourcesLabel],
        ...(doc.key !== undefined && { 'openlibraryKey': doc.key }),
      };
      candidates.push({
        'book': {
          'isbn':    canonical,
          'title':   doc.title,
          'authors': doc.author_name ?? [],
          'price':   { 'amount': 0, 'currency': 'USD' },
          ...(summary !== undefined                                    && { 'summary': summary }),
          ...(doc.first_publish_year !== undefined                     && { 'firstPublishYear': doc.first_publish_year }),
          ...(subjects !== undefined                                   && { 'subjects': subjects }),
          ...(doc.publisher !== undefined                              && { 'publishers': doc.publisher.slice(0, MAX_PUBLISHERS) }),
          ...(doc.language !== undefined && doc.language.length > 0   && { 'languages': doc.language }),
        },
        'score':  0,
        'source': source,
        'notes':  notes,
      });
    }
    return candidates;
  }
}
