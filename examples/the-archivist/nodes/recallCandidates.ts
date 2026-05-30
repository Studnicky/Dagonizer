/**
 * recallCandidates: pre-scout prior-memory recall node.
 *
 * Runs INSIDE each `book-search-scatter` embedded-DAG, between
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
 * Recall is best-effort: no prior runs (or no similar ones) is a valid
 * result that routes 'recalled' with an empty `state.priorCandidates`. An
 * embedder failure degrades to Jaccard scoring (capability fallback, not
 * salvage). A defect in the deterministic memory query has no recovery route
 * here, so it propagates; the node never fabricates a recall result.
 *
 * output: 'recalled': the prior-memory pre-load completed (possibly empty).
 * kind:   'deterministic': pure SPARQL pattern-match over a stable store.
 */

import type { Candidate } from '../entities/Book.ts';
import { BOOK_NS, GRAPH_MEMORY, MemoryStore, RUN_NS, STATE_GRAPH_PREFIX } from '../memory/MemoryStore.ts';

import type { ArchivistNode } from './ArchivistNode.ts';
import { cosineSimilarity, jaccard, tokenise } from './textUtils.ts';

const dagVisitorQuery   = MemoryStore.dagIri('visitorQuery');
const dagShortlisted    = MemoryStore.dagIri('shortlisted');
const dagTitle          = MemoryStore.dagIri('title');
const dagSource         = MemoryStore.dagIri('source');
const dagAuthor         = MemoryStore.dagIri('author');
const dagQueryEmbedding = MemoryStore.dagIri('queryEmbedding');

const JACCARD_THRESHOLD = 0.35;
const COSINE_THRESHOLD  = 0.70;
const MAX_PRIOR_CANDIDATES = 10;
const RECALLED_SCORE = 0.5;

/** Parse a JSON-encoded float-array literal from a memory triple; return null on failure. */
function parseEmbeddingLiteral(value: string): readonly number[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const vec: number[] = [];
    for (const n of parsed) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return null;
      vec.push(n);
    }
    return vec.length > 0 ? vec : null;
  } catch {
    return null;
  }
}

export const recallCandidates: ArchivistNode<'recalled'> = {
  'name':    'recall-candidates',
  'kind':    'deterministic',
  'outputs': ['recalled'],
  async execute(state, context) {
    const memory   = context.services.memory;
    const embedder = context.services.embedder;

    // Use extracted terms when available; fall back to raw query tokens.
    const queryText     = state.terms.length > 0 ? state.terms.join(' ') : state.query;
    const currentTokens = tokenise(queryText);
    const currentRunIri = `${RUN_NS}${state.runId}`;

    // ── Step 1: attempt cosine similarity recall via embedder ─────────
    // Compute the current query embedding once, then walk every prior
    // run's `dag:queryEmbedding` literal and score with cosine. Any
    // throw from the embedder (rate limit, OOM) falls through to the
    // Jaccard path below.
    let useCosine = false;
    let queryVec: readonly number[] | null = null;
    if (embedder !== null) {
      try {
        queryVec = await embedder.embed(queryText);
        useCosine = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        context.services.logger.warn(`recall-candidates: embedder threw, falling back to Jaccard: ${message}`);
        useCosine = false;
      }
    }

    // ── Collect prior runs from GRAPH_MEMORY ──────────────────────────
    // Each row gives us a run IRI and its visitor-query literal.
    const runRows = memory.select({
      'subject':   '?run',
      'predicate': dagVisitorQuery,
      'object':    '?q',
      'graph':     GRAPH_MEMORY,
    });

    // Score each run; collect those >= threshold for the chosen metric.
    const matchingRunIris: string[] = [];
    const threshold = useCosine ? COSINE_THRESHOLD : JACCARD_THRESHOLD;
    const cosineByRun = new Map<string, number>();

    for (const row of runRows) {
      const runIri   = row['run']?.value;
      const queryVal = row['q']?.value;
      if (runIri === undefined || queryVal === undefined) continue;
      // Skip the current run.
      if (runIri === currentRunIri) continue;
      // Also skip if the run's state graph is the current run (belt-and-suspenders).
      if (runIri.replace(RUN_NS, STATE_GRAPH_PREFIX) === `${STATE_GRAPH_PREFIX}${state.runId}`) continue;

      let score: number;
      if (useCosine && queryVec !== null) {
        // Look up the prior run's stored query embedding.
        const embRows = memory.select({
          'subject':   MemoryStore.iri(runIri),
          'predicate': dagQueryEmbedding,
          'object':    '?v',
          'graph':     GRAPH_MEMORY,
        });
        const literal = embRows[0]?.['v']?.value;
        if (literal === undefined) {
          // No embedding stored for this run; skip rather than mix metrics.
          // Older runs predating the embedder rollout won't have a vector;
          // they're only reachable via Jaccard fallback (covered below).
          continue;
        }
        const priorVec = parseEmbeddingLiteral(literal);
        if (priorVec === null) continue;
        score = cosineSimilarity(queryVec, priorVec);
        cosineByRun.set(runIri, score);
      } else {
        const priorTokens = tokenise(queryVal);
        score = jaccard(currentTokens, priorTokens);
      }

      if (score >= threshold) {
        matchingRunIris.push(runIri);
      }
    }

    if (matchingRunIris.length === 0) {
      const reason = useCosine
        ? 'no similar prior runs (cosine >= 0.70)'
        : 'no similar prior runs (Jaccard >= 0.35, embedder unreachable)';
      context.services.logger.info(`recall-candidates: ${reason}`);
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

        const notes: Record<string, unknown> = { 'fromPriorMemory': true };
        const cs = cosineByRun.get(runIri);
        if (cs !== undefined) notes['cosineSimilarity'] = cs;

        priorCandidates.push({
          'book': {
            'isbn':    isbn,
            'title':   title,
            'authors': authors,
            'price':   { 'amount': 0, 'currency': 'USD' },
          },
          'score':  RECALLED_SCORE,
          'source': source,
          'notes':  notes,
        });
      }
    }

    state.priorCandidates = priorCandidates;

    const detail = useCosine ? 'cosine >= 0.70' : 'Jaccard >= 0.35, embedder unreachable';
    context.services.logger.info(
      `recall-candidates: ${String(priorCandidates.length)} prior shortlisted books from ${String(matchingRunIris.length)} similar prior runs (${detail})`,
    );

    return { 'output': 'recalled' };
  },
};
