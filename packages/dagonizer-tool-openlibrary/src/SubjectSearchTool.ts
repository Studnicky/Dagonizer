/**
 * SubjectSearchTool: OpenLibrary subject/theme search for the Archivist.
 *
 * Uses the OpenLibrary search endpoint with `subject=<term>` so that
 * visitors can describe a book by what it is *about*: themes, mood,
 * plot motifs, or setting, rather than by title, author, or ISBN.
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
 *   - `examples` are intentionally generic / template-shaped; never
 *     real titles, authors, or ISBNs. Some models quote schema examples
 *     back verbatim into responses; shape-only examples prevent that.
 *   - `additionalProperties: true` lets the LLM pass extra OL params
 *     (e.g. `lang`, `first_publish_year`) without a schema change.
 */

import type { ToolDefinition } from '@noocodex/dagonizer/adapter';
import type { AbortableOptionsInterface } from '@noocodex/dagonizer/contracts';
import { HttpTransport } from '@noocodex/dagonizer/tool';
import type { Tool } from '@noocodex/dagonizer/tool';
import type { Candidate } from '@noocodex/dagonizer-book-entities';


import { OPENLIBRARY_ENDPOINT, narrowOpenLibraryResponse, OpenLibraryDocs } from './openLibraryTypes.js';

interface SubjectSearchInput extends Record<string, unknown> {
  readonly subject: string;
  readonly limit?: number;
  readonly lang?: string;
}

export class SubjectSearchTool implements Tool<SubjectSearchInput, readonly Candidate[]> {
  readonly definition: ToolDefinition = {
    'name': 'subject_search',
    'description':
      'Search OpenLibrary by subject or theme. Use when the visitor describes a book by what it is *about* (themes, mood, plot motifs, setting) rather than by title, author, or ISBN. For example: "labyrinth", "haunted house", "minotaur", "cosmic horror", "unreliable narrator". Do NOT use for title or author keyword searches; use web_search_books for those.',
    'inputSchema': {
      'type': 'object',
      'additionalProperties': true,
      'properties': {
        'subject': {
          'type':        'string',
          'minLength':   2,
          'maxLength':   80,
          'description': 'A thematic term, subject heading, or plot motif drawn from the visitor description. Prefer concrete nouns or adjective phrases (e.g. "labyrinth", "haunted house", "unreliable narrator"). AND-matching is strict; use a single focused term rather than a long phrase.',
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

  async execute(input: SubjectSearchInput, options?: AbortableOptionsInterface): Promise<readonly Candidate[]> {
    const signal = options?.signal;
    const limit = Math.max(1, Math.min(20, input.limit ?? 8));
    const params = new URLSearchParams({
      'subject': input.subject,
      'limit':   String(limit),
    });
    if (input.lang !== undefined && input.lang.length > 0) {
      params.set('lang', input.lang);
    }

    const raw = await HttpTransport.getJson<unknown>(
      `${OPENLIBRARY_ENDPOINT}?${params.toString()}`,
      { ...(signal !== undefined && { signal }) },
    );
    const payload = narrowOpenLibraryResponse(raw);
    return OpenLibraryDocs.candidates(payload.docs ?? [], 'subject-search', 'openlibrary-subject');
  }
}
