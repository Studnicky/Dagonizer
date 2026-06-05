/**
 * OpenLibrarySearchTool: browser-runnable web search for books.
 *
 * The tool's `inputSchema` IS the contract. Every property carries
 * `description` + `examples` + `default` (where relevant); the prose
 * prompt the agent sees doesn't need to re-explain what each field
 * means. JSON Schema's three tiers do the heavy lifting:
 *
 *   tier 1: `required`: the LLM MUST supply these.
 *   tier 2: known optional `properties`: the LLM SHOULD supply when
 *           it has the information; `default` and `examples` tell it
 *           the shape we expect.
 *   tier 3: `additionalProperties: true`: the LLM MAY enrich the call
 *           with free-form key/value hints (e.g. `subject`, `lang`,
 *           `era`) that the tool will treat as additional OpenLibrary
 *           query params.
 *
 * Endpoint:  GET https://openlibrary.org/search.json
 * (No key, CORS-friendly, returns ranked book metadata.)
 *
 * Output: every candidate carries OpenLibrary's actual title, authors,
 * first-publish year, subjects, publishers, and any description/summary
 * we can extract, so the LLM has real metadata to score against and
 * cite in its prose response.
 */

import type { Candidate } from '@noocodex/dagonizer-book-entities';

import { HttpTransport } from '@noocodex/dagonizer/tool';
import type { Tool } from '@noocodex/dagonizer/tool';
import type { ToolDefinition } from '@noocodex/dagonizer/adapter';

import type { OpenLibraryResponse } from './openLibraryTypes.js';
import { OPENLIBRARY_ENDPOINT, OpenLibraryDocs } from './openLibraryTypes.js';

interface OpenLibrarySearchInput extends Record<string, unknown> {
  readonly query?: string;
  readonly isbn?: string;
  readonly limit?: number;
  readonly subject?: string;
  readonly author?: string;
  readonly first_publish_year?: number;
  readonly lang?: string;
}

// The data contract: every field carries description, examples, and
// where relevant default + format. The agent reads this through the
// adapter's native function-declaration / responseConstraint channel
// (Gemini API's `functionDeclarations.parameters`, Nano's
// `responseConstraint`). No need to repeat any of this in prose.
const definition: ToolDefinition = {
  'name': 'web_search_books',
  'description': 'Search openlibrary.org for real books.',
  'inputSchema': {
    'type': 'object',
    'additionalProperties': true,
    'properties': {
      // Examples are intentionally generic/template-shaped rather than
      // real titles/authors. Some models (notably Gemini Nano) treat
      // schema `examples` as soft-suggestions and quote them back to
      // the user as if they were data. Keep examples ABOUT THE SHAPE,
      // never about real-world content.
      'query': {
        'type':        'string',
        'minLength':   2,
        'maxLength':   80,
        'description': 'Terse search terms drawn from the visitor question: keywords, an author name, or a title. AND-matched on OpenLibrary; do not pad with descriptive filler ("book about", "description of") or it drops hits. Omit when using isbn, author, or subject directly.',
        'examples':    ['<title-words>', '<author-name>'],
      },
      'isbn': {
        'type':        'string',
        'description': 'ISBN-10 or ISBN-13 (with or without hyphens). When supplied, the tool performs a direct ISBN lookup via OpenLibrary\'s ?q= param and ignores the query field.',
        'examples':    ['9780765377067', '0-7653-7706-7'],
      },
      'limit': {
        'type':        'integer',
        'minimum':     1,
        'maximum':     20,
        'default':     8,
        'description': 'Maximum number of results to return. Higher = wider net but more noise.',
      },
      'subject': {
        'type':        'string',
        'description': 'Optional OpenLibrary subject facet to narrow the search.',
      },
      'author': {
        'type':        'string',
        'description': 'Optional author-name filter (separate from the main query).',
      },
      'first_publish_year': {
        'type':        'integer',
        'minimum':     1500,
        'maximum':     2100,
        'description': 'Optional first-publication year filter.',
      },
      'lang': {
        'type':        'string',
        'description': 'Optional ISO 639-2 language code (e.g. eng, fre, jpn).',
      },
    },
    'required': [],
  },
  'strict': true,
};

export const OpenLibrarySearchTool: Tool<OpenLibrarySearchInput, readonly Candidate[]> = {
  definition,
  async execute(input, signal) {
    const limit = Math.max(1, Math.min(20, input.limit ?? 8));

    // ISBN path: route directly through ?q=<isbn>. OpenLibrary's q= field
    // handles both ISBN-10 and ISBN-13 (with or without hyphens) as a
    // high-priority identifier lookup.
    if (input.isbn !== undefined && input.isbn.length > 0) {
      const isbnParams = new URLSearchParams({ 'q': input.isbn, 'limit': String(limit) });
      if (input.lang !== undefined) isbnParams.set('lang', String(input.lang));
      const isbnPayload = await HttpTransport.getJson<OpenLibraryResponse>(
        `${OPENLIBRARY_ENDPOINT}?${isbnParams.toString()}`,
        { ...(signal !== undefined && { signal }) },
      );
      return OpenLibraryDocs.buildCandidates(isbnPayload.docs ?? [], 'web-search', 'web-search');
    }

    // Author path: use dedicated ?author= param for ranked author search.
    // Subject path: the subject= param is a separate OpenLibrary facet.
    // General path: keyword query via ?q=.
    const q = input.author !== undefined
      ? undefined
      : (typeof input.query === 'string' && input.query.length > 0 ? input.query : undefined);

    const params = new URLSearchParams({ 'limit': String(limit) });
    if (q !== undefined)                        params.set('q',       q);
    if (input.author !== undefined)             params.set('author',  String(input.author));
    if (input.subject !== undefined)            params.set('subject', String(input.subject));
    if (input.first_publish_year !== undefined) params.set('first_publish_year', String(input.first_publish_year));
    if (input.lang !== undefined)               params.set('lang',    String(input.lang));
    if (!params.has('q') && !params.has('author') && !params.has('subject')) {
      // Nothing to search on; return empty rather than hitting the root endpoint.
      return [];
    }

    const payload = await HttpTransport.getJson<OpenLibraryResponse>(
      `${OPENLIBRARY_ENDPOINT}?${params.toString()}`,
      { ...(signal !== undefined && { signal }) },
    );
    return OpenLibraryDocs.buildCandidates(payload.docs ?? [], 'web-search', 'web-search');
  },
};
