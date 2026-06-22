/**
 * buildBookWorksets: builds the scatter workset from the LLM tool plan.
 *
 * Reads `state.toolPlan` (populated by decideTools) and `state.terms`, and
 * emits a `bookWorksets` array where each entry is a JSON-serialisable
 * `{ dagName: string; arguments: Record<string, unknown> }` object. The
 * `dagName` field names the embedded `tool:<name>` DAG registered by
 * ToolRegistry; the scatter placement uses `{ dagFrom: 'dagName' }` to
 * resolve the body DAG at runtime.
 *
 * Argument-building mirrors the old per-scout logic exactly:
 *
 *   web_search_books  — OpenLibrary keyword / isbn / author / subject search.
 *                       Priority: isbn > author > subject > keyword.
 *   google_books_search — Google Books keyword search.
 *   subject_search    — OpenLibrary subject-facet search with LCSH heuristic.
 *   wikipedia_summary — Wikipedia page/summary enrichment via state.terms.
 *
 * Routes 'ready' after writing bookWorksets. Always succeeds (no tool is
 * required; an empty workset means the scatter body is skipped).
 */

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/types';

import type { ArchivistState } from '../ArchivistState.ts';
import { UserLanguage } from '../language/UserLanguage.ts';
import { ScoutUtils } from './scouts.ts';

/** A single scatter workset entry: names the tool DAG and its call arguments. */
export type BookWorksetItemType = {
  readonly dagName: string;
  readonly arguments: JsonObjectType;
};

export class BuildBookWorksetsNode extends ScalarNode<ArchivistState, 'ready'> {
  readonly name = 'build-book-worksets';
  readonly outputs = ['ready'] as const;

  override get outputSchema(): Record<'ready', SchemaObjectType> {
    return {
      'ready': { 'type': 'object' },
    };
  }

  protected override async executeOne(
    state: ArchivistState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'ready'>> {
    const worksets: BookWorksetItemType[] = [];

    // ── web_search_books (OpenLibrary) ───────────────────────────────────────
    const openLibraryPlan = state.toolPlan.find((c) => c.name === 'web_search_books');
    if (openLibraryPlan !== undefined) {
      const args = openLibraryPlan.arguments;
      const rawLimit = args['limit'];
      const limit = typeof rawLimit === 'number' ? rawLimit : 8;
      const lang = UserLanguage.toIso6392(state.userLanguage);

      let toolArguments: JsonObjectType | null = null;

      const rawIsbn = args['isbn'];
      const rawAuthor = args['author'];
      const rawSubject = args['subject'];
      const rawQuery = args['query'];

      if (typeof rawIsbn === 'string' && rawIsbn.length > 0) {
        toolArguments = { 'isbn': rawIsbn, limit, lang };
      } else if (typeof rawAuthor === 'string' && rawAuthor.length > 0) {
        toolArguments = { 'author': rawAuthor, limit, lang };
      } else if (typeof rawSubject === 'string' && rawSubject.length > 0) {
        toolArguments = { 'subject': rawSubject, limit, lang };
      } else {
        const queryStr = typeof rawQuery === 'string' && rawQuery.length > 0
          ? rawQuery
          : state.terms.join(' ');
        const query = ScoutUtils.unquote(queryStr);
        if (query.length > 0) {
          toolArguments = { 'query': query, limit, lang };
        }
      }

      if (toolArguments !== null) {
        worksets.push({ 'dagName': 'tool:web_search_books', 'arguments': toolArguments });
      }
    }

    // ── google_books_search (Google Books) ───────────────────────────────────
    const googleBooksPlan = state.toolPlan.find((c) => c.name === 'google_books_search');
    if (googleBooksPlan !== undefined) {
      const args = googleBooksPlan.arguments;
      const rawQuery = args['query'];
      const rawMax = args['maxResults'];
      const queryStr = typeof rawQuery === 'string' && rawQuery.length > 0
        ? rawQuery
        : state.terms.join(' ');
      const query = ScoutUtils.unquote(queryStr);
      if (query.length > 0) {
        const langRestrict = UserLanguage.normalize(state.userLanguage);
        worksets.push({
          'dagName': 'tool:google_books_search',
          'arguments': { 'query': query, 'maxResults': typeof rawMax === 'number' ? rawMax : 8, 'langRestrict': langRestrict },
        });
      }
    }

    // ── subject_search (OpenLibrary subject facet) ───────────────────────────
    const subjectPlan = state.toolPlan.find((c) => c.name === 'subject_search');
    if (subjectPlan !== undefined) {
      const args = subjectPlan.arguments;
      const rawSubject = args['subject'];
      const rawLimit = args['limit'];
      const subjectStr = typeof rawSubject === 'string' && rawSubject.length > 0
        ? rawSubject
        : ScoutUtils.pickSubjectTerm(state.terms);
      const subject = ScoutUtils.unquote(subjectStr);
      if (subject.length > 0) {
        const lang = UserLanguage.toIso6392(state.userLanguage);
        worksets.push({
          'dagName': 'tool:subject_search',
          'arguments': { 'subject': subject, 'limit': typeof rawLimit === 'number' ? rawLimit : 8, 'lang': lang },
        });
      }
    }

    // ── wikipedia_summary (Wikipedia enrichment) ─────────────────────────────
    // Runs even without a toolPlan entry; uses state.terms as the query.
    // Skips only when terms is empty.
    if (state.terms.length > 0) {
      const query = ScoutUtils.pickWikipediaQuery(state.terms).trim();
      if (query.length > 0) {
        const lang = UserLanguage.normalize(state.userLanguage);
        worksets.push({
          'dagName': 'tool:wikipedia_summary',
          'arguments': { 'query': query, 'lang': lang },
        });
      }
    }

    state.bookWorksets = worksets;
    return NodeOutputBuilder.of('ready');
  }
}

export const buildBookWorksets = new BuildBookWorksetsNode();
