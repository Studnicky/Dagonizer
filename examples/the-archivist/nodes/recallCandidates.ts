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
 * variant: 'deterministic': pure SPARQL pattern-match over a stable store.
 */

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { CandidateType } from '../entities/Book.ts';
import { BookBuilder } from '../entities/Book.ts';
import { BOOK_NS, GRAPH_MEMORY, MemoryStore, RUN_NS, STATE_GRAPH_PREFIX } from '../memory/MemoryStore.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';
import { TextSimilarity } from './textUtils.ts';

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

/**
 * EmbeddingParser: parses JSON-encoded float-array literals from memory triples.
 */
class EmbeddingParser {
  /** Parse a JSON-encoded float-array literal; return null on failure. */
  static parse(value: string): readonly number[] | null {
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
}

export class RecallCandidatesNode extends ScalarNode<ArchivistState, 'recalled', ArchivistServices> {
  readonly name = 'recall-candidates';
  readonly outputs = ['recalled'] as const;
  override get outputSchema(): Record<'recalled', SchemaObjectType> {
    return {
      'recalled': { 'type': 'object' },
    };
  }

  /** Public per-item entry point for tests and dispatch delegation. */
  public async runItem(state: ArchivistState, context: NodeContextType<ArchivistServices>): Promise<NodeOutputType<'recalled'>> {
    return this.executeOne(state, context);
  }

  protected override async executeOne(state: ArchivistState, context: NodeContextType<ArchivistServices>) {
    const memory   = context.services.memory;
    const embedder = context.services.embedder;

    // Use extracted terms when available; fall back to raw query tokens.
    const queryText     = state.terms.length > 0 ? state.terms.join(' ') : state.query;
    const currentTokens = TextSimilarity.tokenise(queryText);
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
      } catch {
        // Embedder threw: fall back to Jaccard similarity for recall.
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
        const priorVec = EmbeddingParser.parse(literal);
        if (priorVec === null) continue;
        score = TextSimilarity.cosine(queryVec, priorVec);
        cosineByRun.set(runIri, score);
      } else {
        const priorTokens = TextSimilarity.tokenise(queryVal);
        score = TextSimilarity.jaccard(currentTokens, priorTokens);
      }

      if (score >= threshold) {
        matchingRunIris.push(runIri);
      }
    }

    if (matchingRunIris.length === 0) {
      return NodeOutputBuilder.of('recalled');
    }

    // ── Collect shortlisted book IRIs from matching runs ──────────────
    const seenIsbns    = new Set<string>();
    const priorCandidates: CandidateType[] = [];

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
          'book':   BookBuilder.from({ 'isbn': isbn, 'title': title, 'authors': authors }),
          'score':  RECALLED_SCORE,
          'source': source,
          'notes':  notes,
        });
      }
    }

    state.priorCandidates = priorCandidates;

    return NodeOutputBuilder.of('recalled');
  }
}

/** Singleton node instance referenced by the DAG wiring. */
export const recallCandidates = new RecallCandidatesNode();
