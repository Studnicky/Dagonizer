/**
 * GoogleBooksTool: books search via the Google Books v1 volumes API.
 *
 *   GET https://www.googleapis.com/books/v1/volumes?q=<query>&maxResults=<n>
 *
 * No key required for public volumes; CORS-friendly. Maps each volume
 * to the canonical `Candidate` shape so it dedupes with OpenLibrary and
 * Wikipedia hits in the merge step. Returns the volume's
 * `averageRating` + `ratingsCount` as freeform `notes` so the
 * `find-reviews` intent can surface them.
 *
 * The tool's `inputSchema` is the contract; every property carries
 * description + shape-only examples (no real titles/authors that
 * could poison the model's output).
 */

import type { ToolDefinitionType } from '@studnicky/dagonizer/adapter';
import type { AbortableOptionsType } from '@studnicky/dagonizer/contracts';
import { HttpTransport } from '@studnicky/dagonizer/tool';
import type { ToolInterface } from '@studnicky/dagonizer/tool';
import type { CandidateType } from '@studnicky/dagonizer-book-entities';
import { BookBuilder, CanonicalId, LanguageCode } from '@studnicky/dagonizer-book-entities';

import { GoogleBooksResponseValidator } from './GoogleBooksResponse.js';

type GoogleBooksInputType = Record<string, unknown> & {
  readonly query:     string;
  readonly maxResults?: number;
  readonly orderBy?:  'relevance' | 'newest';
  readonly langRestrict?: string;
};

const ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';

const GOOGLE_BOOKS_MIN_RESULTS = 1;
const GOOGLE_BOOKS_MAX_RESULTS = 40;
const GOOGLE_BOOKS_DEFAULT_RESULTS = 8;
const GOOGLE_BOOKS_MAX_SUBJECTS = 8;

export class GoogleBooksTool implements ToolInterface<GoogleBooksInputType, readonly CandidateType[]> {
  readonly definition: ToolDefinitionType = {
    'name': 'google_books_search',
    'description': 'Search Google Books for real volumes (returns titles, authors, descriptions, average rating, ratings count). Complementary to openlibrary; many editions and reviews land here that openlibrary lacks.',
    'inputSchema': {
      'type': 'object',
      'additionalProperties': true,
      'properties': {
        'query': {
          'type':        'string',
          'minLength':   2,
          'maxLength':   80,
          'description': 'Free-text query. May include Google Books query operators (intitle:, inauthor:, isbn:, subject:).',
          'examples':    ['<title-words>', '<author-name>', 'isbn:<isbn-13>', 'inauthor:"<author-name>"', 'subject:<topic>'],
        },
        'maxResults': {
          'type':    'integer',
          'minimum': GOOGLE_BOOKS_MIN_RESULTS,
          'maximum': GOOGLE_BOOKS_MAX_RESULTS,
          'default': GOOGLE_BOOKS_DEFAULT_RESULTS,
          'description': 'Maximum volumes to return.',
        },
        'orderBy': {
          'type':        'string',
          'enum':        ['relevance', 'newest'],
          'default':     'relevance',
          'description': 'Result ordering.',
        },
        'langRestrict': {
          'type':        'string',
          'description': 'Optional ISO 639-1 language code (e.g. en, ja, fr) to restrict results.',
        },
      },
      'required': ['query'],
    },
    'strict': true,
  };

  async execute(input: GoogleBooksInputType, options?: AbortableOptionsType): Promise<readonly CandidateType[]> {
    const signal = options?.signal;
    const max = Math.max(GOOGLE_BOOKS_MIN_RESULTS, Math.min(GOOGLE_BOOKS_MAX_RESULTS, input.maxResults ?? GOOGLE_BOOKS_DEFAULT_RESULTS));
    const params = new URLSearchParams({ 'q': input.query, 'maxResults': String(max) });
    if (input.orderBy !== undefined) params.set('orderBy', input.orderBy);
    if (input.langRestrict !== undefined && input.langRestrict.length > 0) {
      params.set('langRestrict', input.langRestrict);
    }

    const raw = await HttpTransport.getJson(
      `${ENDPOINT}?${params.toString()}`,
      GoogleBooksResponseValidator,
      { ...(signal !== undefined && { signal }) },
    );
    const volumes = raw.items ?? [];
    const candidates: CandidateType[] = [];
    for (const vol of volumes) {
      const info = vol.volumeInfo;
      if (info === undefined || info.title === undefined) continue;
      const isbns = (info.industryIdentifiers ?? [])
        .map((id) => id.identifier)
        .filter((s): s is string => typeof s === 'string');
      const canonical = CanonicalId.pick({
        'title': info.title,
        ...(isbns.length > 0 && { 'isbns': isbns }),
        ...(info.authors !== undefined && { 'authors': info.authors }),
      });
      const year = GoogleBooksTool.pickYear(info.publishedDate);
      const notes: Record<string, unknown> = {
        '_sources': ['google-books'],
        ...(info.averageRating !== undefined && { 'rating': info.averageRating }),
        ...(info.ratingsCount !== undefined  && { 'ratingsCount': info.ratingsCount }),
        ...(vol.id !== undefined             && { 'googleVolumeId': vol.id }),
        ...(info.imageLinks?.thumbnail !== undefined && { 'thumbnail': info.imageLinks.thumbnail }),
      };
      const languages = info.language !== undefined && info.language.length > 0
        ? [LanguageCode.toIso6392(info.language)]
        : undefined;
      candidates.push({
        'book': BookBuilder.from({
          'isbn':             canonical,
          'title':            info.title,
          'authors':          info.authors ?? [],
          ...(info.description !== undefined && { 'summary': info.description }),
          ...(year !== undefined             && { 'firstPublishYear': year }),
          ...(info.categories !== undefined  && { 'subjects': info.categories.slice(0, GOOGLE_BOOKS_MAX_SUBJECTS) }),
          ...(info.publisher !== undefined   && { 'publishers': [info.publisher] }),
          ...(languages !== undefined        && { 'languages': languages }),
        }),
        'score':  0,
        'source': 'google-books',
        'notes':  notes,
      });
    }
    return candidates;
  }

  private static pickYear(date: string | undefined): number | undefined {
    if (date === undefined) return undefined;
    const m = /^(\d{4})/u.exec(date);
    if (m === null) return undefined;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : undefined;
  }
}
