/**
 * BookSearchFanoutDAG — reusable query-extract + 4-source parallel scout cluster.
 *
 * Internal flow:
 *
 *   bsf-extract-query
 *     └─ success ──► bsf-decide-tools
 *   bsf-decide-tools
 *     └─ (tools | no-tools) ──► book-search-fan-out (parallel, combine: collect)
 *          ├─ bsf-ol       (OpenLibrary)
 *          ├─ bsf-gb       (Google Books)
 *          ├─ bsf-subject  (Subject search)
 *          └─ bsf-wiki     (Wikipedia enrichment)
 *     └─ bsf-rank-candidates
 *     └─ bsf-merge-candidates
 *          ├─ ranked ──► bsf-record-findings
 *          └─ empty  ──► bsf-no-results (TerminalNode(failed) → deep-DAG exits error)
 *     └─ bsf-record-findings
 *     └─ bsf-has-citations-gate
 *          ├─ pass ──► bsf-recall-past-visits ──► END (success)
 *          └─ fail ──► bsf-no-results (TerminalNode(failed) → deep-DAG exits error)
 *
 * Outputs:
 *   success — query extracted, candidates found, ranked, recorded, and recalled
 *   error   — no candidates after merge, or citations gate failed;
 *             signalled by the bsf-no-results TerminalNode(failed) placement so
 *             executeDeepDAG routes the parent to its 'error' branch via
 *             innerTerminalOutcome propagation
 *
 * Molecular import pattern:
 *   import { BookSearchFanoutDAG, registerBookSearchFanoutNodes } from './deepdags/BookSearchFanoutDAG.ts';
 *   registerBookSearchFanoutNodes(dispatcher);
 *   dispatcher.registerDAG(BookSearchFanoutDAG);
 *
 * The deep-DAG operates on the parent's state directly (no stateMapping
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
import { decideTools }       from '../nodes/decideTools.ts';
import { extractQuery }      from '../nodes/extractQuery.ts';
import { hasCitationsGate }  from '../nodes/hasCitationsGate.ts';
import { mergeCandidates }   from '../nodes/mergeCandidates.ts';
import { rankCandidates }    from '../nodes/rankCandidates.ts';
import { recallPastVisits }  from '../nodes/recallPastVisits.ts';
import { recordFindings }    from '../nodes/recordFindings.ts';
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
 * can reference via `.deepDAG('placement-name', 'book-search-fanout', routes)`.
 */
export const BookSearchFanoutDAG: DAG = new DAGBuilder('book-search-fanout', '1.0')

  // ── 1. extract-query ─────────────────────────────────────────────────────
  // LLM parses the raw visitor question into structured search terms.
  // Writes state.terms for the scouts and decide-tools to consume.
  .node('bsf-extract-query', extractQuery, {
    'success': 'bsf-decide-tools',
  })

  // ── 2. decide-tools ──────────────────────────────────────────────────────
  // LLM decides which external sources to invoke. Both outputs route into
  // the parallel fan-out — each scout gates internally on state.toolPlan.
  .node('bsf-decide-tools', decideTools, {
    'tools':    'book-search-fan-out',
    'no-tools': 'book-search-fan-out',
  })

  // ── 3. book-search-fan-out ───────────────────────────────────────────────
  // All four scouts run concurrently. combine:'collect' waits for all four
  // and merges their state mutations. Each scout writes to state.candidates.
  .parallel('book-search-fan-out', ['bsf-ol', 'bsf-gb', 'bsf-subject', 'bsf-wiki'], 'collect', {
    'success': 'bsf-rank-candidates',
    'error':   'bsf-rank-candidates',
  })
  .node('bsf-ol',      openLibraryScout, { 'success': null, 'empty': null })
  .node('bsf-gb',      googleBooksScout, { 'success': null, 'empty': null })
  .node('bsf-subject', subjectScout,     { 'success': null, 'empty': null })
  .node('bsf-wiki',    wikipediaScout,   { 'success': null, 'empty': null })

  // ── 4. rank-candidates ───────────────────────────────────────────────────
  // LLM-driven relevance scoring. Always routes 'ranked' — even an empty
  // set — so merge can soft-gate on zero candidates.
  .node('bsf-rank-candidates', rankCandidates, {
    'ranked': 'bsf-merge-candidates',
  })

  // ── 5. merge-candidates ──────────────────────────────────────────────────
  // Cross-source dedupe via CanonicalId, top-5. Routes 'empty' to
  // bsf-no-results (TerminalNode(failed)) so executeDeepDAG routes the
  // parent to its 'error' branch via innerTerminalOutcome propagation.
  .node('bsf-merge-candidates', mergeCandidates, {
    'ranked': 'bsf-record-findings',
    'empty':  'bsf-no-results',
  })

  // ── 6. record-findings ───────────────────────────────────────────────────
  // Deterministic RDF write — same input always produces the same triples.
  .node('bsf-record-findings', recordFindings, {
    'recorded': 'bsf-has-citations-gate',
  })

  // ── 7. has-citations-gate ────────────────────────────────────────────────
  // SPARQL ASK over the per-run state graph. Symbolic fence for the LLM.
  // 'fail' routes to bsf-no-results (TerminalNode(failed)) so the parent
  // receives 'error' via innerTerminalOutcome propagation.
  .node('bsf-has-citations-gate', hasCitationsGate, {
    'pass': 'bsf-recall-past-visits',
    'fail': 'bsf-no-results',
  })

  // ── 8. recall-past-visits ────────────────────────────────────────────────
  // Injects prior-session context (prior queries + shortlisted titles) into
  // state.priorContext. Terminal node — deep-DAG exits cleanly → 'success'.
  .node('bsf-recall-past-visits', recallPastVisits, {
    'recalled': null,
  })

  // ── 9. bsf-no-results ────────────────────────────────────────────────────
  // TerminalNode(failed) — executeDeepDAG reads innerTerminalOutcome and
  // routes the parent placement to its 'error' branch. No backing node or
  // collectError call required.
  .terminal('bsf-no-results', 'failed')

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
