/**
 * OpenLibrarySearchTool — browser-runnable web search for books.
 *
 * The tool's `inputSchema` IS the contract. Every property carries
 * `description` + `examples` + `default` (where relevant); the prose
 * prompt the agent sees doesn't need to re-explain what each field
 * means. JSON Schema's three tiers do the heavy lifting:
 *
 *   tier 1: `required` — the LLM MUST supply these.
 *   tier 2: known optional `properties` — the LLM SHOULD supply when
 *           it has the information; `default` and `examples` tell it
 *           the shape we expect.
 *   tier 3: `additionalProperties: true` — the LLM MAY enrich the call
 *           with free-form key/value hints (e.g. `subject`, `lang`,
 *           `era`) that the tool will treat as additional OpenLibrary
 *           query params.
 *
 * Endpoint:  GET https://openlibrary.org/search.json
 * (No key, CORS-friendly, returns ranked book metadata.)
 *
 * Output: every candidate carries OpenLibrary's actual title, authors,
 * first-publish year, subjects, publishers, and any description/summary
 * we can extract — so the LLM has real metadata to score against and
 * cite in its prose response.
 */

import type { Candidate } from '@noocodex/dagonizer-book-entities';

import type { Tool } from '@noocodex/dagonizer/tool';
import type { ToolDefinition } from '@noocodex/dagonizer/adapter';

interface OpenLibraryDoc {
  readonly title?: string;
  readonly subtitle?: string;
  readonly author_name?: readonly string[];
  readonly isbn?: readonly string[];
  readonly first_publish_year?: number;
  readonly publisher?: readonly string[];
  readonly subject?: readonly string[];
  /** Stable OpenLibrary identifier — `/works/OL...W`. Always present. */
  readonly key?: string;
  readonly first_sentence?: readonly string[];
  /** Some search responses include a description; many don't. */
  readonly description?: string | { value?: string };
}

interface OpenLibraryResponse {
  readonly docs?: readonly OpenLibraryDoc[];
  readonly numFound?: number;
}

interface WebSearchInput extends Record<string, unknown> {
  readonly query: string;
  readonly limit?: number;
  readonly subject?: string;
  readonly author?: string;
  readonly first_publish_year?: number;
  readonly lang?: string;
}

const ENDPOINT = 'https://openlibrary.org/search.json';

// The data contract — every field carries description, examples, and
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
        'description': 'Terse search terms drawn from the visitor question — keywords, an author name, a title, or an ISBN. AND-matched on OpenLibrary; do not pad with descriptive filler ("book about", "description of") or it drops hits.',
        'examples':    ['<title-words>', '<author-name>', '<ISBN-13>'],
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
        'maximum':     new Date().getFullYear(),
        'description': 'Optional first-publication year filter.',
      },
      'lang': {
        'type':        'string',
        'description': 'Optional ISO 639-2 language code (e.g. eng, fre, jpn).',
      },
    },
    'required': ['query'],
  },
  'strict': true,
};

export const OpenLibrarySearchTool: Tool<WebSearchInput, readonly Candidate[]> = {
  definition,
  async execute(input, signal) {
    const limit = Math.max(1, Math.min(20, input.limit ?? 8));
    const params = new URLSearchParams({ 'q': input.query, 'limit': String(limit) });
    if (input.subject !== undefined)            params.set('subject',  String(input.subject));
    if (input.author !== undefined)             params.set('author',   String(input.author));
    if (input.first_publish_year !== undefined) params.set('first_publish_year', String(input.first_publish_year));
    if (input.lang !== undefined)               params.set('lang',     String(input.lang));

    const initOptions: RequestInit & { signal?: AbortSignal } = { 'method': 'GET' };
    if (signal !== undefined) initOptions.signal = signal;
    const response = await fetch(`${ENDPOINT}?${params.toString()}`, initOptions);
    if (!response.ok) {
      throw new Error(`openlibrary search ${String(response.status)} ${response.statusText}`);
    }

    const payload = (await response.json()) as OpenLibraryResponse;
    const docs = payload.docs ?? [];
    const candidates: Candidate[] = [];
    for (const doc of docs) {
      if (doc.title === undefined) continue;
      const id = pickIsbn(doc.isbn) ?? doc.key ?? `urn:openlibrary:${doc.title}`;
      const summary = pickDescription(doc);
      const subjects = doc.subject?.slice(0, 8);
      candidates.push({
        'book': {
          'isbn':    id,
          'title':   doc.title,
          'authors': doc.author_name ?? [],
          'price':   { 'amount': 0, 'currency': 'USD' },
          ...(summary !== undefined ? { 'summary': summary } : {}),
          ...(doc.first_publish_year !== undefined ? { 'firstPublishYear': doc.first_publish_year } : {}),
          ...(subjects !== undefined ? { 'subjects': subjects } : {}),
          ...(doc.publisher !== undefined ? { 'publishers': doc.publisher.slice(0, 4) } : {}),
        },
        'score':  0,                  // tool does not score; rank-candidates is the ranker.
        'source': 'web-search',
      });
    }
    return candidates;
  },
};

function pickIsbn(list: readonly string[] | undefined): string | null {
  if (list === undefined || list.length === 0) return null;
  const thirteen = list.find((s) => s.length === 13 && (s.startsWith('978') || s.startsWith('979')));
  return thirteen ?? list[0] ?? null;
}

function pickDescription(doc: OpenLibraryDoc): string | undefined {
  if (typeof doc.description === 'string' && doc.description.length > 0) return doc.description;
  if (typeof doc.description === 'object' && typeof doc.description.value === 'string') return doc.description.value;
  const first = doc.first_sentence?.[0];
  if (typeof first === 'string' && first.length > 0) {
    return doc.subtitle !== undefined && doc.subtitle.length > 0 ? `${doc.subtitle} — ${first}` : first;
  }
  if (doc.subtitle !== undefined && doc.subtitle.length > 0) return doc.subtitle;
  return undefined;
}
