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

import type { ToolDefinition } from '@studnicky/dagonizer/adapter';
import type { AbortableOptionsInterface } from '@studnicky/dagonizer/contracts';
import { HttpTransport, ToolError } from '@studnicky/dagonizer/tool';
import type { Tool } from '@studnicky/dagonizer/tool';
import type { Candidate } from '@studnicky/dagonizer-book-entities';
import { BookBuilder, CanonicalId, LanguageCode } from '@studnicky/dagonizer-book-entities';

interface VolumeInfo {
  readonly title?:           string;
  readonly subtitle?:        string;
  readonly authors?:         readonly string[];
  readonly publishedDate?:   string;
  readonly description?:     string;
  readonly publisher?:       string;
  readonly categories?:      readonly string[];
  readonly averageRating?:   number;
  readonly ratingsCount?:    number;
  readonly industryIdentifiers?: readonly { type?: string; identifier?: string }[];
  readonly imageLinks?:      { thumbnail?: string };
  /** ISO 639-1 language code Google Books reports for this volume (e.g. 'en'). */
  readonly language?:        string;
}

interface Volume {
  readonly id?:         string;
  readonly volumeInfo?: VolumeInfo;
}

interface GoogleBooksResponse {
  readonly items?:      readonly Volume[];
  readonly totalItems?: number;
}

interface GoogleBooksInput extends Record<string, unknown> {
  readonly query:     string;
  readonly maxResults?: number;
  readonly orderBy?:  'relevance' | 'newest';
  readonly langRestrict?: string;
}

function isGoogleBooksResponse(value: unknown): value is GoogleBooksResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if ('totalItems' in v && typeof v['totalItems'] !== 'number') return false;
  if (!('items' in v)) return true; // items is optional
  if (!Array.isArray(v['items'])) return false;
  return true;
}

const ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';

const GOOGLE_BOOKS_MIN_RESULTS = 1;
const GOOGLE_BOOKS_MAX_RESULTS = 40;
const GOOGLE_BOOKS_DEFAULT_RESULTS = 8;
const GOOGLE_BOOKS_MAX_SUBJECTS = 8;

export class GoogleBooksTool implements Tool<GoogleBooksInput, readonly Candidate[]> {
  readonly definition: ToolDefinition = {
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

  async execute(input: GoogleBooksInput, options?: AbortableOptionsInterface): Promise<readonly Candidate[]> {
    const signal = options?.signal;
    const max = Math.max(GOOGLE_BOOKS_MIN_RESULTS, Math.min(GOOGLE_BOOKS_MAX_RESULTS, input.maxResults ?? GOOGLE_BOOKS_DEFAULT_RESULTS));
    const params = new URLSearchParams({ 'q': input.query, 'maxResults': String(max) });
    if (input.orderBy !== undefined) params.set('orderBy', input.orderBy);
    if (input.langRestrict !== undefined && input.langRestrict.length > 0) {
      params.set('langRestrict', input.langRestrict);
    }

    const raw = await HttpTransport.getJson<unknown>(
      `${ENDPOINT}?${params.toString()}`,
      { ...(signal !== undefined && { signal }) },
    );
    if (!isGoogleBooksResponse(raw)) {
      throw new ToolError('Unexpected Google Books API response shape', {
        'reason': 'PARSE_ERROR',
        'retryable': false,
      });
    }
    const volumes = raw.items ?? [];
    const candidates: Candidate[] = [];
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
