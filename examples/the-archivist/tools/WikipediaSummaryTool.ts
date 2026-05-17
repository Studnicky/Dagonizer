/**
 * WikipediaSummaryTool — REST `page/summary` endpoint.
 *
 *   GET https://en.wikipedia.org/api/rest_v1/page/summary/<title>
 *
 * Returns a short paragraph + thumbnail for the article. The Archivist
 * uses this to enrich a candidate that other sources already returned
 * (e.g. attach the Wikipedia paragraph as a `summary` when OpenLibrary
 * left it empty), and to surface author / topic context that's poorly
 * structured in book catalogues.
 *
 * Returns one candidate per query (the article subject); merge dedupes
 * if other tools already returned a book with the same canonical id.
 */

import type { Candidate } from '../entities/Book.ts';

import { CanonicalId } from './CanonicalId.ts';
import type { Tool, ToolDefinition } from './ToolDefinition.ts';

interface WikiSummary {
  readonly title?:           string;
  readonly description?:     string;
  readonly extract?:         string;
  readonly type?:            string;
  readonly content_urls?:    { desktop?: { page?: string } };
  readonly thumbnail?:       { source?: string };
}

interface WikipediaInput extends Record<string, unknown> {
  readonly query: string;
}

const ENDPOINT = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

const definition: ToolDefinition = {
  'name': 'wikipedia_summary',
  'description': 'Fetch the Wikipedia summary paragraph for a book, author, or topic. Use to enrich a known title with editorial context, or to look up an author bio.',
  'inputSchema': {
    'type': 'object',
    'additionalProperties': true,
    'properties': {
      'query': {
        'type':        'string',
        'minLength':   2,
        'maxLength':   80,
        'description': 'Exact Wikipedia article title or a near-match the redirect handler resolves.',
        'examples':    ['<book-title>', '<author-name>', '<topic-name>'],
      },
    },
    'required': ['query'],
  },
  'strict': true,
};

export const WikipediaSummaryTool: Tool<WikipediaInput, readonly Candidate[]> = {
  definition,
  async execute(input, signal) {
    const title = encodeURIComponent(input.query.trim().replace(/\s+/gu, '_'));
    const initOptions: RequestInit & { signal?: AbortSignal } = {
      'method': 'GET',
      'headers': { 'accept': 'application/json' },
    };
    if (signal !== undefined) initOptions.signal = signal;
    const response = await fetch(`${ENDPOINT}${title}`, initOptions);
    if (response.status === 404) return [];
    if (!response.ok) {
      throw new Error(`wikipedia ${String(response.status)} ${response.statusText}`);
    }
    const payload = (await response.json()) as WikiSummary;
    if (payload.title === undefined || payload.extract === undefined) return [];

    // Wikipedia is an enrichment source, not a catalog. We still return
    // a Candidate so the merge step can fold the extract into a
    // book record sharing the canonical id. When Wikipedia returns an
    // article that is NOT a book (e.g. an author bio), we hand back a
    // candidate keyed by `urn:wiki:<title>` so it stays distinguishable
    // until the LLM-rank step decides whether to use it.
    const isBookish = payload.type === 'standard'
      && (payload.description ?? '').toLowerCase().includes('book');

    const canonical = isBookish
      ? CanonicalId.fromWork(payload.title, undefined)
      : `urn:wiki:${slugify(payload.title)}`;

    const notes: Record<string, unknown> = { '_sources': ['wikipedia'] };
    if (payload.thumbnail?.source !== undefined)        notes['thumbnail']  = payload.thumbnail.source;
    if (payload.content_urls?.desktop?.page !== undefined) notes['wikiUrl'] = payload.content_urls.desktop.page;
    if (payload.description !== undefined)              notes['wikiKind']   = payload.description;

    return [{
      'book': {
        'isbn':    canonical,
        'title':   payload.title,
        'authors': [],
        'price':   { 'amount': 0, 'currency': 'USD' },
        'summary': payload.extract,
      },
      'score':  0,
      'source': 'wikipedia',
      'notes':  notes,
    }];
  },
};

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
}
