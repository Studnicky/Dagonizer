/**
 * GoogleBooksTool — books search via the Google Books v1 volumes API.
 *
 *   GET https://www.googleapis.com/books/v1/volumes?q=<query>&maxResults=<n>
 *
 * No key required for public volumes; CORS-friendly. Maps each volume
 * to the canonical `Candidate` shape so it dedupes with OpenLibrary and
 * Wikipedia hits in the merge step. Returns the volume's
 * `averageRating` + `ratingsCount` as freeform `notes` so the
 * `find-reviews` intent can surface them.
 *
 * The tool's `inputSchema` is the contract — every property carries
 * description + shape-only examples (no real titles/authors that
 * could poison the model's output).
 */

import type { Candidate } from './entities.js';

import { CanonicalId } from './CanonicalId.js';
import type { Tool } from '@noocodex/dagonizer/tool';
import type { ToolDefinition } from '@noocodex/dagonizer/adapter';

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
}

const ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';

const definition: ToolDefinition = {
  'name': 'google_books_search',
  'description': 'Search Google Books for real volumes (returns titles, authors, descriptions, average rating, ratings count). Complementary to openlibrary — many editions and reviews land here that openlibrary lacks.',
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
        'minimum': 1,
        'maximum': 40,
        'default': 8,
        'description': 'Maximum volumes to return.',
      },
      'orderBy': {
        'type':        'string',
        'enum':        ['relevance', 'newest'],
        'default':     'relevance',
        'description': 'Result ordering.',
      },
    },
    'required': ['query'],
  },
  'strict': true,
};

export const GoogleBooksTool: Tool<GoogleBooksInput, readonly Candidate[]> = {
  definition,
  async execute(input, signal) {
    const max = Math.max(1, Math.min(40, input.maxResults ?? 8));
    const params = new URLSearchParams({ 'q': input.query, 'maxResults': String(max) });
    if (input.orderBy !== undefined) params.set('orderBy', input.orderBy);

    const initOptions: RequestInit & { signal?: AbortSignal } = { 'method': 'GET' };
    if (signal !== undefined) initOptions.signal = signal;
    const response = await fetch(`${ENDPOINT}?${params.toString()}`, initOptions);
    if (!response.ok) {
      throw new Error(`google-books ${String(response.status)} ${response.statusText}`);
    }

    const payload = (await response.json()) as GoogleBooksResponse;
    const volumes = payload.items ?? [];
    const candidates: Candidate[] = [];
    for (const vol of volumes) {
      const info = vol.volumeInfo;
      if (info === undefined || info.title === undefined) continue;
      const isbns = (info.industryIdentifiers ?? [])
        .map((id) => id.identifier)
        .filter((s): s is string => typeof s === 'string');
      const canonical = CanonicalId.pick({
        'isbns': isbns,
        'title': info.title,
        ...(info.authors !== undefined ? { 'authors': info.authors } : {}),
      });
      const year = pickYear(info.publishedDate);
      const notes: Record<string, unknown> = { '_sources': ['google-books'] };
      if (info.averageRating !== undefined) notes['rating']       = info.averageRating;
      if (info.ratingsCount !== undefined)  notes['ratingsCount'] = info.ratingsCount;
      if (vol.id !== undefined)             notes['googleVolumeId'] = vol.id;
      if (info.imageLinks?.thumbnail !== undefined) notes['thumbnail'] = info.imageLinks.thumbnail;
      candidates.push({
        'book': {
          'isbn':    canonical,
          'title':   info.title,
          'authors': info.authors ?? [],
          'price':   { 'amount': 0, 'currency': 'USD' },
          ...(info.description !== undefined ? { 'summary': info.description } : {}),
          ...(year !== undefined ? { 'firstPublishYear': year } : {}),
          ...(info.categories !== undefined ? { 'subjects': info.categories.slice(0, 8) } : {}),
          ...(info.publisher !== undefined ? { 'publishers': [info.publisher] } : {}),
        },
        'score':  0,
        'source': 'google-books',
        'notes':  notes,
      });
    }
    return candidates;
  },
};

function pickYear(date: string | undefined): number | undefined {
  if (date === undefined) return undefined;
  const m = /^(\d{4})/u.exec(date);
  if (m === null) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}
