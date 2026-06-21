/**
 * WikipediaSummaryTool: REST `page/summary` endpoint.
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

import type { ToolDefinitionType } from '@studnicky/dagonizer/adapter';
import type { AbortableOptionsType } from '@studnicky/dagonizer/contracts';
import { HttpTransport, ToolError } from '@studnicky/dagonizer/tool';
import type { ToolInterface } from '@studnicky/dagonizer/tool';
import type { CandidateType } from '@studnicky/dagonizer-book-entities';
import { BookBuilder, CanonicalId, LanguageCode } from '@studnicky/dagonizer-book-entities';

import type { WikipediaSummaryResponseType } from './WikipediaSummaryResponse.js';
import { WikipediaSummaryResponseValidator } from './WikipediaSummaryResponse.js';

type WikipediaInputType = Record<string, unknown> & {
  readonly query: string;
  readonly lang?: string;
};

const DEFAULT_LANG = 'en';

export class WikipediaSummaryTool implements ToolInterface<WikipediaInputType, readonly CandidateType[]> {
  readonly definition: ToolDefinitionType = {
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
        'lang': {
          'type':        'string',
          'description': 'Optional ISO 639-1 language code; selects the corresponding Wikipedia (defaults to en).',
        },
      },
      'required': ['query'],
    },
    'outputSchema': { 'type': 'array', 'items': { 'type': 'object' } },
    'strict': true,
  };

  async execute(input: WikipediaInputType, options?: AbortableOptionsType): Promise<readonly CandidateType[]> {
    const signal = options?.signal;
    const lang = input.lang !== undefined && input.lang.length > 0
      ? WikipediaSummaryTool.normalizeLang(input.lang)
      : DEFAULT_LANG;
    const endpoint = WikipediaSummaryTool.endpointFor(lang);
    const title = encodeURIComponent(input.query.trim().replace(/\s+/gu, '_'));

    let payload: WikipediaSummaryResponseType;
    try {
      payload = await HttpTransport.getJson(
        `${endpoint}${title}`,
        WikipediaSummaryResponseValidator,
        { ...(signal !== undefined && { signal }), 'headers': { 'accept': 'application/json' } },
      );
    } catch (err) {
      // HttpTransport throws ToolError on 404; treat as "no article found".
      if (err instanceof ToolError && err.status === 404) return [];
      throw err;
    }

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
      ? CanonicalId.ofWork(payload.title, undefined)
      : `urn:wiki:${CanonicalId.slugify(payload.title)}`;

    const notes: Record<string, unknown> = {
      '_sources': ['wikipedia'],
      ...(payload.thumbnail?.source !== undefined           && { 'thumbnail': payload.thumbnail.source }),
      ...(payload.content_urls?.desktop?.page !== undefined && { 'wikiUrl':   payload.content_urls.desktop.page }),
      ...(payload.description !== undefined                 && { 'wikiKind':  payload.description }),
    };

    return [{
      'book': BookBuilder.from({
        'isbn':      canonical,
        'title':     payload.title,
        'authors':   [],
        'summary':   payload.extract,
        'languages': [LanguageCode.toIso6392(lang)],
      }),
      'score':  0,
      'source': 'wikipedia',
      'notes':  notes,
    }];
  }

  private static endpointFor(lang: string): string {
    return `https://${lang}.wikipedia.org/api/rest_v1/page/summary/`;
  }

  private static normalizeLang(input: string): string {
    const head = input.toLowerCase().split(/[-_]/u)[0];
    return head !== undefined && head.length > 0 ? head : DEFAULT_LANG;
  }
}
