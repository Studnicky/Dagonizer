/**
 * Shared OpenLibrary API helpers used by both OpenLibrarySearchTool and
 * SubjectSearchTool.
 *
 * The response wire shape lives in `OpenLibraryResponse.ts` as a JSON Schema
 * 2020-12 `*Schema` const with `FromSchema`-derived types and a module-load
 * `EntityValidator`. `OpenLibraryDocs` maps narrowed docs to the canonical
 * `Candidate` shape and exposes `narrowResponse` for callers that hold a raw
 * `unknown` body (the search tools fetch through `HttpTransport.getJson`, which
 * narrows for them; `narrowResponse` covers any direct-narrowing caller).
 */

import { OpenApiGuard } from '@studnicky/dagonizer/tool';
import type { Candidate } from '@studnicky/dagonizer-book-entities';
import { BookBuilder, CanonicalId } from '@studnicky/dagonizer-book-entities';

import type { OpenLibraryDoc, OpenLibraryResponse } from './OpenLibraryResponse.js';
import { OpenLibraryResponseValidator } from './OpenLibraryResponse.js';

export const OPENLIBRARY_ENDPOINT = 'https://openlibrary.org/search.json';

const MAX_SUBJECTS = 8;
const MAX_PUBLISHERS = 4;

export class OpenLibraryDocs {
  private constructor() { /* static class */ }

  /**
   * Narrow an `unknown` value (e.g. a directly-fetched JSON body) to
   * `OpenLibraryResponse` via the compiled schema validator. Throws a
   * non-retryable `ToolError(PARSE_ERROR)` when the shape does not match.
   */
  static narrowResponse(raw: unknown): OpenLibraryResponse {
    return OpenApiGuard.assertShape(raw, OpenLibraryResponseValidator, 'OpenLibrary search.json');
  }

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

  static candidates(
    docs: readonly OpenLibraryDoc[],
    source: string,
    sourcesLabel: string,
  ): Candidate[] {
    const result: Candidate[] = [];
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
      result.push({
        'book': BookBuilder.from({
          'isbn':    canonical,
          'title':   doc.title,
          'authors': doc.author_name ?? [],
          ...(summary !== undefined                                    && { 'summary': summary }),
          ...(doc.first_publish_year !== undefined                     && { 'firstPublishYear': doc.first_publish_year }),
          ...(subjects !== undefined                                   && { 'subjects': subjects }),
          ...(doc.publisher !== undefined                              && { 'publishers': doc.publisher.slice(0, MAX_PUBLISHERS) }),
          ...(doc.language !== undefined && doc.language.length > 0   && { 'languages': doc.language }),
        }),
        'score':  0,
        'source': source,
        'notes':  notes,
      });
    }
    return result;
  }
}
