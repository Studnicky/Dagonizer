/**
 * SubjectSearchTool — OpenLibrary subject/theme search for the Archivist.
 *
 * Uses the OpenLibrary search endpoint with `subject=<term>` so that
 * visitors can describe a book by what it is *about* — themes, mood,
 * plot motifs, or setting — rather than by title, author, or ISBN.
 *
 * Endpoint:  GET https://openlibrary.org/search.json?subject=<term>&limit=N
 *
 * Compared with `web_search_books`:
 *   - `web_search_books` runs a full-text keyword query (`q=...`).
 *   - `subject_search`   queries the `subject` facet directly, which
 *     OpenLibrary indexes from LCSH and community-contributed tags.
 *     Thematic queries ("labyrinth", "haunted house", "minotaur") land
 *     hits that keyword search misses because those words appear in
 *     subjects/categories but not necessarily in the title.
 *
 * Output: `Candidate[]` matching the `entities/Book.ts` shape.
 * CanonicalId normalises each candidate so `CanonicalId.dedupe` in the
 * merge node can collapse cross-source duplicates.
 *
 * Notes carry `_sources: ['openlibrary-subject']` so the trace UI can
 * distinguish this tool's output from the keyword-search results.
 *
 * Schema design notes:
 *   - `examples` are intentionally generic / template-shaped — never
 *     real titles, authors, or ISBNs. Some models quote schema examples
 *     back verbatim into responses; shape-only examples prevent that.
 *   - `additionalProperties: true` lets the LLM pass extra OL params
 *     (e.g. `lang`, `first_publish_year`) without a schema change.
 */

import type { Candidate } from '@noocodex/dagonizer-book-entities';

import { CanonicalId } from '@noocodex/dagonizer-book-entities';
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
  /** ISO 639-2 (alpha-3) language codes the work is published in. */
  readonly language?: readonly string[];
}

interface OpenLibraryResponse {
  readonly docs?: readonly OpenLibraryDoc[];
  readonly numFound?: number;
}

interface SubjectSearchInput extends Record<string, unknown> {
  readonly subject: string;
  readonly limit?: number;
  readonly lang?: string;
}

const ENDPOINT = 'https://openlibrary.org/search.json';

// #region tool-schema
const definition: ToolDefinition = {
  'name': 'subject_search',
  'description':
    'Search OpenLibrary by subject or theme — use when the visitor describes a book by what it is *about* (themes, mood, plot motifs, setting) rather than by title, author, or ISBN. For example: "labyrinth", "haunted house", "minotaur", "cosmic horror", "unreliable narrator". Do NOT use for title or author keyword searches — use web_search_books for those.',
  'inputSchema': {
    'type': 'object',
    'additionalProperties': true,
    'properties': {
      'subject': {
        'type':        'string',
        'minLength':   2,
        'maxLength':   80,
        'description': 'A thematic term, subject heading, or plot motif drawn from the visitor description. Prefer concrete nouns or adjective phrases (e.g. "labyrinth", "haunted house", "unreliable narrator"). AND-matching is strict — use a single focused term rather than a long phrase.',
        'examples':    ['<subject-or-theme>', '<plot-motif>', '<setting-or-mood>'],
      },
      'limit': {
        'type':        'integer',
        'minimum':     1,
        'maximum':     20,
        'default':     8,
        'description': 'Maximum number of results to return.',
        'examples':    [8],
      },
      'lang': {
        'type':        'string',
        'description': 'Optional ISO 639-2 language code (e.g. eng, fre, jpn) to restrict results to that language.',
      },
    },
    'required': ['subject'],
  },
  'strict': true,
};
// #endregion tool-schema

export const SubjectSearchTool: Tool<SubjectSearchInput, readonly Candidate[]> = {
  definition,
  async execute(input, signal) {
    const limit = Math.max(1, Math.min(20, input.limit ?? 8));
    const params = new URLSearchParams({
      'subject': input.subject,
      'limit':   String(limit),
    });
    if (input.lang !== undefined && input.lang.length > 0) {
      params.set('lang', input.lang);
    }

    const initOptions: RequestInit & { signal?: AbortSignal } = { 'method': 'GET' };
    if (signal !== undefined) initOptions.signal = signal;

    const response = await fetch(`${ENDPOINT}?${params.toString()}`, initOptions);
    if (!response.ok) {
      throw new Error(`openlibrary subject-search ${String(response.status)} ${response.statusText}`);
    }

    const payload = (await response.json()) as OpenLibraryResponse;
    const docs = payload.docs ?? [];
    const candidates: Candidate[] = [];
    for (const doc of docs) {
      if (doc.title === undefined) continue;
      const isbns = doc.isbn?.slice() ?? [];
      const canonical = CanonicalId.pick({
        'isbns':   isbns,
        'title':   doc.title,
        ...(doc.author_name !== undefined ? { 'authors': doc.author_name } : {}),
      });
      const summary = pickDescription(doc);
      const subjects = doc.subject?.slice(0, 8);
      const notes: Record<string, unknown> = { '_sources': ['openlibrary-subject'] };
      if (doc.key !== undefined) notes['openlibraryKey'] = doc.key;
      candidates.push({
        'book': {
          'isbn':    canonical,
          'title':   doc.title,
          'authors': doc.author_name ?? [],
          'price':   { 'amount': 0, 'currency': 'USD' },
          ...(summary !== undefined ? { 'summary': summary } : {}),
          ...(doc.first_publish_year !== undefined ? { 'firstPublishYear': doc.first_publish_year } : {}),
          ...(subjects !== undefined ? { 'subjects': subjects } : {}),
          ...(doc.publisher !== undefined ? { 'publishers': doc.publisher.slice(0, 4) } : {}),
          ...(doc.language !== undefined && doc.language.length > 0 ? { 'languages': doc.language } : {}),
        },
        'score':  0,
        'source': 'subject-search',
        'notes':  notes,
      });
    }
    return candidates;
  },
};

function pickDescription(doc: OpenLibraryDoc): string | undefined {
  if (typeof doc.description === 'string' && doc.description.length > 0) return doc.description;
  if (typeof doc.description === 'object' && typeof doc.description.value === 'string') return doc.description.value;
  const first = doc.first_sentence?.[0];
  if (typeof first === 'string' && first.length > 0) {
    return doc.subtitle !== undefined && doc.subtitle.length > 0
      ? `${doc.subtitle} — ${first}`
      : first;
  }
  if (doc.subtitle !== undefined && doc.subtitle.length > 0) return doc.subtitle;
  return undefined;
}
