/**
 * BookSearchFanoutDAG — reusable query-extract + 4-source parallel scout cluster.
 *
 * Internal flow:
 *
 *   extract-query
 *     └─ success ──► decide-tools
 *   decide-tools
 *     └─ (tools | no-tools) ──► recall-candidates
 *   recall-candidates
 *     └─ recalled ──► book-search-fanout (parallel, combine: collect)
 *          ├─ openlibrary-scout  (OpenLibrary)
 *          ├─ google-books-scout (Google Books)
 *          ├─ subject-scout      (Subject search)
 *          └─ wikipedia-scout    (Wikipedia enrichment)
 *     └─ rank-candidates
 *     └─ merge-candidates
 *          ├─ ranked ──► record-findings
 *          └─ empty  ──► no-results (TerminalNode(failed) → embedded-DAG exits error)
 *     └─ record-findings
 *     └─ has-citations-gate
 *          ├─ pass ──► recall-past-visits ──► END (success)
 *          └─ fail ──► no-results (TerminalNode(failed) → embedded-DAG exits error)
 *
 * Outputs:
 *   success — query extracted, candidates found, ranked, recorded, and recalled
 *   error   — no candidates after merge, or citations gate failed;
 *             signalled by the no-results TerminalNode(failed) placement so
 *             executeEmbeddedDAG routes the parent to its 'error' branch via
 *             innerTerminalOutcome propagation
 *
 * Molecular import pattern:
 *   import { BookSearchFanoutDAG, registerBookSearchFanoutNodes } from './embedded-dags/BookSearchFanoutDAG.ts';
 *   registerBookSearchFanoutNodes(dispatcher);
 *   dispatcher.registerDAG(BookSearchFanoutDAG);
 *
 * The embedded-DAG operates on the parent's state directly (no stateMapping
 * needed) — it reads `state.query` and writes `state.terms`, `state.toolPlan`,
 * `state.candidates`, `state.shortlist`, and `state.priorContext`, which are
 * the same fields every intent branch in the parent DAG expects.
 *
 * Three placements of this DAG replace three inlined fan-out clusters in
 * the parent `the-archivist` DAG. One definition, three usages:
 *   on-topic-search  — general web book search
 *   author-search    — author body-of-work search
 *   similar-search   — recommend-similar fan-out
 *
 * Reviews and describe branches are inlined in the parent because they use
 * distinct post-scout steps (rankByRating and pickBestMatch respectively).
 */

import type { ArchivistState }    from '../ArchivistState.ts';
import { decideTools }        from '../nodes/decideTools.ts';
import { extractQuery }       from '../nodes/extractQuery.ts';
import { hasCitationsGate }   from '../nodes/hasCitationsGate.ts';
import { mergeCandidates }    from '../nodes/mergeCandidates.ts';
import { rankCandidates }     from '../nodes/rankCandidates.ts';
import { recallCandidates }   from '../nodes/recallCandidates.ts';
import { recallPastVisits }   from '../nodes/recallPastVisits.ts';
import { recordFindings }     from '../nodes/recordFindings.ts';
import {
  openLibraryScout,
  googleBooksScout,
  subjectScout,
  wikipediaScout,
} from '../nodes/scouts.ts';
import type { ArchivistServices } from '../services.ts';

import type { Dagonizer  } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer/builder';
import type { DAG } from '@noocodex/dagonizer/entities';

/**
 * The `book-search-fanout` DAG — one packaged unit that any parent DAG
 * can reference via `.embeddedDAG('placement-name', 'book-search-fanout', routes)`.
 */
export const BookSearchFanoutDAG: DAG = new DAGBuilder('book-search-fanout', '1.0')

  // ── 1. extract-query ─────────────────────────────────────────────────────
  // LLM parses the raw visitor question into structured search terms.
  // Writes state.terms for the scouts and decide-tools to consume.
  .node('extract-query', extractQuery, {
    'success': 'decide-tools',
  })

  // ── 2. decide-tools ──────────────────────────────────────────────────────
  // LLM decides which external sources to invoke. Both outputs route into
  // recall-candidates so prior memory is loaded before scouts fire.
  .node('decide-tools', decideTools, {
    'tools':    'recall-candidates',
    'no-tools': 'recall-candidates',
  })

  // ── 2b. recall-candidates ────────────────────────────────────────────────
  // Pre-loads state.priorCandidates from memory: shortlisted books from prior
  // runs whose visitor query has Jaccard >= 0.35 overlap with the current
  // query. Cap 10. Always routes 'recalled' — even when no prior runs match.
  .node('recall-candidates', recallCandidates, {
    'recalled': 'book-search-fanout',
  })

  // ── 3. book-search-fanout ────────────────────────────────────────────────
  // All four scouts run concurrently. combine:'collect' waits for all four
  // and merges their state mutations. Each scout writes to state.candidates.
  .parallel('book-search-fanout', ['openlibrary-scout', 'google-books-scout', 'subject-scout', 'wikipedia-scout'], 'collect', {
    'success': 'rank-candidates',
    'error':   'rank-candidates',
  })
  .node('openlibrary-scout',  openLibraryScout, { 'success': null, 'empty': null })
  .node('google-books-scout', googleBooksScout, { 'success': null, 'empty': null })
  .node('subject-scout',      subjectScout,     { 'success': null, 'empty': null })
  .node('wikipedia-scout',    wikipediaScout,   { 'success': null, 'empty': null })

  // ── 4. rank-candidates ───────────────────────────────────────────────────
  // LLM-driven relevance scoring. Always routes 'ranked' — even an empty
  // set — so merge can soft-gate on zero candidates.
  .node('rank-candidates', rankCandidates, {
    'ranked': 'merge-candidates',
  })

  // ── 5. merge-candidates ──────────────────────────────────────────────────
  // Cross-source dedupe via CanonicalId, top-5. Routes 'empty' to
  // no-results (TerminalNode(failed)) so executeEmbeddedDAG routes the
  // parent to its 'error' branch via innerTerminalOutcome propagation.
  .node('merge-candidates', mergeCandidates, {
    'ranked': 'record-findings',
    'empty':  'no-results',
  })

  // ── 6. record-findings ───────────────────────────────────────────────────
  // Deterministic RDF write — same input always produces the same triples.
  .node('record-findings', recordFindings, {
    'recorded': 'has-citations-gate',
  })

  // ── 7. has-citations-gate ────────────────────────────────────────────────
  // SPARQL ASK over the per-run state graph. Symbolic fence for the LLM.
  // 'fail' routes to no-results (TerminalNode(failed)) so the parent
  // receives 'error' via innerTerminalOutcome propagation.
  .node('has-citations-gate', hasCitationsGate, {
    'pass': 'recall-past-visits',
    'fail': 'no-results',
  })

  // ── 8. recall-past-visits ────────────────────────────────────────────────
  // Injects prior-session context (prior queries + shortlisted titles) into
  // state.priorContext. Terminal node — embedded-DAG exits cleanly → 'success'.
  .node('recall-past-visits', recallPastVisits, {
    'recalled': null,
  })

  // ── 9. no-results ────────────────────────────────────────────────────────
  // TerminalNode(failed) — executeEmbeddedDAG reads innerTerminalOutcome and
  // routes the parent placement to its 'error' branch. No backing node or
  // collectError call required.
  .terminal('no-results', 'failed')

  .build();

/**
 * Register all nodes used by `BookSearchFanoutDAG` onto a dispatcher.
 *
 * Call this before `dispatcher.registerDAG(BookSearchFanoutDAG)`. Accepts
 * any `Dagonizer`-compatible dispatcher to allow consumers to use their
 * own subclass while still pulling in the molecular node set.
 *
 * @example
 * ```ts
 * registerBookSearchFanoutNodes(dispatcher);
 * dispatcher.registerDAG(BookSearchFanoutDAG);
 * ```
 */
export function registerBookSearchFanoutNodes(
  dispatcher: Dagonizer<ArchivistState, ArchivistServices>,
): void {
  for (const node of [
    extractQuery,
    decideTools,
    recallCandidates,
    openLibraryScout,
    googleBooksScout,
    subjectScout,
    wikipediaScout,
    rankCandidates,
    mergeCandidates,
    recordFindings,
    hasCitationsGate,
    recallPastVisits,
  ]) {
    dispatcher.registerNode(node);
  }
}
