/**
 * recallMemories: meta-query memory node.
 *
 * Runs when the visitor asks what the Archivist has seen or remembered.
 * Issues SPARQL-style queries against the MemoryStore to produce a
 * `MemoryDigest`: a structured roll-up of everything accumulated across
 * prior runs; then stores it in `state.memoryDigest`.
 *
 * Three query passes (all use the MemoryStore `select()` API):
 *
 *   1. Book count + recent titles:
 *      Walk the default graph for `(?book dag:title ?t)` triples.
 *        `recordFindings` writes there with no named graph, so this is
 *        the canonical cross-run book store.  Collect distinct book IRIs,
 *        their most-recent title, and the first author if present.
 *
 *   2. Query count:
 *      Walk every `urn:dagonizer:state:<runId>` named graph for
 *        `(?run dag:visitorQuery ?q)` triples. Count them, skipping the
 *        current run so an in-flight `recall-memories` query does not
 *        inflate the count.
 *
 *   3. Intent breakdown:
 *      Same state graphs; collect `(?run dag:intent ?i)` and group by
 *        intent value, tallying occurrences.
 *
 * kind: 'non-deterministic': SPARQL output depends on accumulated memory.
 * output: 'recalled': always routes forward; empty memory is a valid
 *   recall result (the digest will have bookCount === 0).
 */

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { NodeContextType } from '@studnicky/dagonizer';

import type { MemoryDigest } from '../ArchivistState.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';
import { MemoryStore, STATE_GRAPH_PREFIX } from '../memory/MemoryStore.ts';

const dagTitle        = MemoryStore.dagIri('title');
const dagAuthor       = MemoryStore.dagIri('author');
const dagVisitorQuery = MemoryStore.dagIri('visitorQuery');
const dagIntent       = MemoryStore.dagIri('intent');

const MAX_RECENT_BOOKS = 10;

/**
 * MemorySummarizer: pure summary builder for recall-memories output.
 */
class MemorySummarizer {
  static buildSummary(
    bookTitles: Map<string, string>,
    queryCount: number,
    recentBooks: MemoryDigest['recentBooks'],
    intentBreakdown: MemoryDigest['intentBreakdown'],
  ): string {
    if (bookTitles.size === 0) return 'My shelves are fresh; no books have been recorded yet.';
    const parts: string[] = [
      `${String(bookTitles.size)} distinct book${bookTitles.size === 1 ? '' : 's'} recorded across ${String(queryCount)} prior ${queryCount === 1 ? 'session' : 'sessions'}.`,
    ];
    if (recentBooks.length > 0) {
      const titleList = recentBooks.slice(0, 3).map((b) => `"${b.title}"`).join(', ');
      parts.push(`Most recent: ${titleList}.`);
    }
    const topIntent = intentBreakdown[0];
    if (topIntent !== undefined) {
      parts.push(`Most common intent: ${topIntent.intent} (${String(topIntent.count)} time${topIntent.count === 1 ? '' : 's'}).`);
    }
    return parts.join(' ');
  }
}

export class RecallMemoriesNode extends ScalarNode<ArchivistState, 'recalled', ArchivistServices> {
  readonly name = 'recall-memories';
  readonly outputs = ['recalled'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextType<ArchivistServices>) {
    const memory = context.services.memory;
    const currentGraphIri = state.runId !== '' ? MemoryStore.stateGraphIri(state.runId).value : null;

    // ── Query 1: distinct books in the default graph ─────────────────────
    // recordFindings writes <book> dag:title "<title>" with no named graph
    // (default graph). Collect every unique book IRI.
    const bookTitleRows = memory.select({
      'subject':   '?book',
      'predicate': dagTitle,
      'object':    '?title',
    });

    // Deduplicate by book IRI; keep the last title seen per IRI.
    const bookTitles = new Map<string, string>();
    for (const row of bookTitleRows) {
      const bookIri = row['book']?.value;
      const title   = row['title']?.value;
      if (bookIri === undefined || title === undefined) continue;
      // Only consider book IRIs (not state-graph subjects like run IRIs).
      if (!bookIri.startsWith('urn:dagonizer:book:')) continue;
      bookTitles.set(bookIri, title);
    }

    // Collect first author per book IRI.
    const bookAuthors = new Map<string, string>();
    for (const [bookIri] of bookTitles) {
      const authorRows = memory.select({
        'subject':   MemoryStore.iri(bookIri),
        'predicate': dagAuthor,
        'object':    '?author',
      });
      const firstAuthor = authorRows[0]?.['author']?.value;
      if (firstAuthor !== undefined) bookAuthors.set(bookIri, firstAuthor);
    }

    // Most-recent first; we reverse since books are written in insertion
    // order (oldest run first). Slice to MAX_RECENT_BOOKS.
    const bookEntries = [...bookTitles.entries()].reverse().slice(0, MAX_RECENT_BOOKS);
    const recentBooks: MemoryDigest['recentBooks'] = bookEntries.map(([iri, title]) => ({
      title,
      author: bookAuthors.get(iri) ?? '',
    }));

    // ── Query 2: query count across all prior state graphs ───────────────
    // Collect every state graph IRI except the current run's graph.
    const stateGraphIris = new Set<string>();
    for (const row of memory.select({
      'subject':   '?run',
      'predicate': dagVisitorQuery,
      'object':    '?q',
      'graph':     '?graph',
    })) {
      const graphVal = row['graph']?.value;
      if (graphVal === undefined) continue;
      if (!graphVal.startsWith(STATE_GRAPH_PREFIX)) continue;
      if (currentGraphIri !== null && graphVal === currentGraphIri) continue;
      stateGraphIris.add(graphVal);
    }

    const queryCount = stateGraphIris.size;

    // ── Query 3: intent breakdown from prior state graphs ────────────────
    const intentCounts = new Map<string, number>();
    for (const graphIri of stateGraphIris) {
      const graph = MemoryStore.iri(graphIri);
      const intentRows = memory.select({
        'subject':   '?run',
        'predicate': dagIntent,
        'object':    '?intent',
        'graph':     graph,
      });
      for (const row of intentRows) {
        const intentVal = row['intent']?.value;
        if (intentVal === undefined) continue;
        intentCounts.set(intentVal, (intentCounts.get(intentVal) ?? 0) + 1);
      }
    }

    const intentBreakdown: MemoryDigest['intentBreakdown'] = [...intentCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([intent, count]) => ({ intent, count }));

    // ── Build LLM-ready summary ───────────────────────────────────────────
    let summary = MemorySummarizer.buildSummary(bookTitles, queryCount, recentBooks, intentBreakdown);

    // If the visitor's current query is a short pronoun-acceptance and the
    // last archivist turn mentioned a book, boost the summary so the compose
    // node can resolve the reference against memory.
    const conv = state.conversation;
    if (conv.length >= 2) {
      const lastArchivist = [...conv].reverse().find((t) => t.role === 'archivist');
      const lastVisitor   = conv[conv.length - 1];
      const isPronouns    = lastVisitor !== undefined && /^(yes|sure|ok|okay|let.s|that|it|do it|go ahead|sounds good)/iu.test(lastVisitor.text.trim());
      if (isPronouns && lastArchivist !== undefined) {
        summary = `${summary} The visitor appears to be following up on: "${lastArchivist.text.slice(0, 120)}".`;
      }
    }

    state.memoryDigest = {
      'bookCount':       bookTitles.size,
      'queryCount':      queryCount,
      'recentBooks':     recentBooks,
      'intentBreakdown': intentBreakdown,
      'summary':         summary,
    };

    context.services.logger.info(
      `recall-memories: ${String(bookTitles.size)} books, ${String(queryCount)} prior queries, ${String(intentBreakdown.length)} intent types`,
    );

    return NodeOutputBuilder.of('recalled');
  }
}

/** Singleton node instance referenced by the DAG wiring. */
export const recallMemories = new RecallMemoriesNode();
