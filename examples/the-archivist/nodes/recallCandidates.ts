/**
 * recallCandidates — pre-scout prior-memory salvage node.
 *
 * Runs INSIDE each `book-search-fanout` embedded-DAG, between
 * `decide-tools` and the parallel scout cluster. Queries the
 * `urn:dagonizer:memory` graph for prior shortlisted books whose
 * associated visitor query has Jaccard >= 0.35 token overlap with the
 * current query terms.
 *
 * Algorithm:
 *   1. Collect every `dag:Run` IRI in GRAPH_MEMORY (via `dag:visitorQuery`).
 *   2. Skip the current run (state.runId).
 *   3. Jaccard-score each prior query's tokens against `state.terms` (or
 *      `state.query` tokens when `state.terms` is empty).
 *   4. For each run whose score >= 0.35, collect books reachable via
 *      `dag:shortlisted` (run → book IRI).
 *   5. For each book IRI, materialise a `Candidate` from memory triples
 *      (`dag:title`, `dag:score`, `dag:source`, `dag:author`). Use score
 *      0.5 (mid-confidence) since these are recalled, not freshly ranked.
 *   6. Deduplicate by ISBN, cap at 10, write to `state.priorCandidates`.
 *
 * Salvage contract: any timeout, error, or empty result returns 'recalled'
 * with an empty (or already-populated) `state.priorCandidates`. Never throws.
 *
 * output: 'recalled' — always routes forward.
 * kind:   'deterministic' — pure SPARQL pattern-match over a stable store.
 */

import type { Candidate } from '../entities/Book.ts';
import { BOOK_NS, GRAPH_MEMORY, MemoryStore, RUN_NS, STATE_GRAPH_PREFIX } from '../memory/MemoryStore.ts';

import type { ArchivistNode } from './ArchivistNode.ts';

const dagVisitorQuery = MemoryStore.dagIri('visitorQuery');
const dagShortlisted  = MemoryStore.dagIri('shortlisted');
const dagTitle        = MemoryStore.dagIri('title');
const dagSource       = MemoryStore.dagIri('source');
const dagAuthor       = MemoryStore.dagIri('author');

const JACCARD_THRESHOLD = 0.35;
const MAX_PRIOR_CANDIDATES = 10;
const RECALLED_SCORE = 0.5;

/** Return a set of lowercase tokens from a query string (length > 2 only). */
function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2),
  );
}

/** Jaccard similarity: |intersection| / |union|. Returns 0 when both empty. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersect = 0;
  for (const tok of a) if (b.has(tok)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

export const recallCandidates: ArchivistNode<'recalled'> = {
  'name':    'recall-candidates',
  'kind':    'deterministic',
  'outputs': ['recalled'],
  async execute(state, context) {
    try {
      const memory = context.services.memory;

      // Use extracted terms when available; fall back to raw query tokens.
      const queryText    = state.terms.length > 0 ? state.terms.join(' ') : state.query;
      const currentTokens = tokenise(queryText);
      const currentRunIri = `${RUN_NS}${state.runId}`;

      // ── Collect prior runs from GRAPH_MEMORY ──────────────────────────
      // Each row gives us a run IRI and its visitor-query literal.
      const runRows = memory.select({
        'subject':   '?run',
        'predicate': dagVisitorQuery,
        'object':    '?q',
        'graph':     GRAPH_MEMORY,
      });

      // Score each run by Jaccard similarity; collect those >= threshold.
      const matchingRunIris: string[] = [];
      for (const row of runRows) {
        const runIri   = row['run']?.value;
        const queryVal = row['q']?.value;
        if (runIri === undefined || queryVal === undefined) continue;
        // Skip the current run.
        if (runIri === currentRunIri) continue;
        // Also skip if the run's state graph is the current run (belt-and-suspenders).
        if (runIri.replace(RUN_NS, STATE_GRAPH_PREFIX) === `${STATE_GRAPH_PREFIX}${state.runId}`) continue;

        const priorTokens = tokenise(queryVal);
        const score = jaccard(currentTokens, priorTokens);
        if (score >= JACCARD_THRESHOLD) {
          matchingRunIris.push(runIri);
        }
      }

      if (matchingRunIris.length === 0) {
        context.services.logger.info('recall-candidates: no similar prior runs (Jaccard >= 0.35)');
        return { 'output': 'recalled' };
      }

      // ── Collect shortlisted book IRIs from matching runs ──────────────
      const seenIsbns    = new Set<string>();
      const priorCandidates: Candidate[] = [];

      for (const runIri of matchingRunIris) {
        if (priorCandidates.length >= MAX_PRIOR_CANDIDATES) break;
        const runTerm = MemoryStore.iri(runIri);

        const shortlistedRows = memory.select({
          'subject':   runTerm,
          'predicate': dagShortlisted,
          'object':    '?book',
          'graph':     GRAPH_MEMORY,
        });

        for (const sRow of shortlistedRows) {
          if (priorCandidates.length >= MAX_PRIOR_CANDIDATES) break;
          const bookTerm = sRow['book'];
          if (bookTerm === undefined) continue;

          const isbn = bookTerm.value.replace(BOOK_NS, '');
          if (seenIsbns.has(isbn)) continue;
          seenIsbns.add(isbn);

          // Materialise the candidate from memory triples.
          const titleRows  = memory.select({ 'subject': bookTerm, 'predicate': dagTitle,  'object': '?v', 'graph': GRAPH_MEMORY });
          const sourceRows = memory.select({ 'subject': bookTerm, 'predicate': dagSource, 'object': '?v', 'graph': GRAPH_MEMORY });
          const authorRows = memory.select({ 'subject': bookTerm, 'predicate': dagAuthor, 'object': '?v', 'graph': GRAPH_MEMORY });

          const title   = titleRows[0]?.['v']?.value ?? isbn;
          const source  = sourceRows[0]?.['v']?.value ?? 'memory';
          const authors = authorRows.map((r) => r['v']?.value ?? '').filter(Boolean);

          priorCandidates.push({
            'book': {
              'isbn':    isbn,
              'title':   title,
              'authors': authors,
              'price':   { 'amount': 0, 'currency': 'USD' },
            },
            'score':  RECALLED_SCORE,
            'source': source,
            'notes':  { 'fromPriorMemory': true },
          });
        }
      }

      state.priorCandidates = priorCandidates;

      context.services.logger.info(
        `recall-candidates: ${String(priorCandidates.length)} prior shortlisted books from ${String(matchingRunIris.length)} similar prior runs (Jaccard >= 0.35)`,
      );
    } catch {
      // Salvage: log and continue. priorCandidates stays as-is (empty or previously set).
      context.services.logger.warn('recall-candidates: error during memory query, continuing with empty prior candidates');
    }

    return { 'output': 'recalled' };
  },
};
