/**
 * recallMemories — meta-query memory node.
 *
 * Runs when the visitor asks what the Archivist has seen or remembered.
 * Issues SPARQL-style queries against the MemoryStore to produce a
 * `MemoryDigest` — a structured roll-up of everything accumulated across
 * prior runs — then stores it in `state.memoryDigest`.
 *
 * Three query passes (all use the MemoryStore `select()` API):
 *
 *   1. Book count + recent titles
 *      — Walk the default graph for `(?book dag:title ?t)` triples.
 *        `recordFindings` writes there with no named graph, so this is
 *        the canonical cross-run book store.  Collect distinct book IRIs,
 *        their most-recent title, and the first author if present.
 *
 *   2. Query count
 *      — Walk every `urn:dagonizer:state:<runId>` named graph for
 *        `(?run dag:visitorQuery ?q)` triples. Count them, skipping the
 *        current run so an in-flight `recall-memories` query does not
 *        inflate the count.
 *
 *   3. Intent breakdown
 *      — Same state graphs; collect `(?run dag:intent ?i)` and group by
 *        intent value, tallying occurrences.
 *
 * kind: 'non-deterministic' — SPARQL output depends on accumulated memory.
 * output: 'recalled' — always routes forward; empty memory is a valid
 *   recall result (the digest will have bookCount === 0).
 */

import type { MemoryDigest } from '../ArchivistState.ts';
import { MemoryStore, STATE_GRAPH_PREFIX, stateGraphIri } from '../memory/MemoryStore.ts';

import type { ArchivistNode } from './ArchivistNode.ts';

const dagTitle        = MemoryStore.dagIri('title');
const dagAuthor       = MemoryStore.dagIri('author');
const dagVisitorQuery = MemoryStore.dagIri('visitorQuery');
const dagIntent       = MemoryStore.dagIri('intent');

const MAX_RECENT_BOOKS = 10;

function buildSummary(
  bookTitles: Map<string, string>,
  queryCount: number,
  recentBooks: MemoryDigest['recentBooks'],
  intentBreakdown: MemoryDigest['intentBreakdown'],
): string {
  if (bookTitles.size === 0) return 'My shelves are fresh — no books have been recorded yet.';
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

export const recallMemories: ArchivistNode<'recalled'> = {
  'name':    'recall-memories',
  'kind':    'non-deterministic',
  'outputs': ['recalled'],
  async execute(state, context) {
    const memory = context.services.memory;
    const currentGraphIri = state.runId !== '' ? stateGraphIri(state.runId).value : null;

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

    // Most-recent first — we reverse since books are written in insertion
    // order (oldest run first). Slice to MAX_RECENT_BOOKS.
    const bookEntries = [...bookTitles.entries()].reverse().slice(0, MAX_RECENT_BOOKS);
    const recentBooks: MemoryDigest['recentBooks'] = bookEntries.map(([iri, title]) => {
      const author = bookAuthors.get(iri);
      return author !== undefined ? { title, author } : { title };
    });

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
    const summary = buildSummary(bookTitles, queryCount, recentBooks, intentBreakdown);

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

    return { 'output': 'recalled' };
  },
};
