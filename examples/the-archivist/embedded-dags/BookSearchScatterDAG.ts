/**
 * BookSearchScatterDAG: reusable query-extract + 4-source scatter scout cluster.
 *
 * Internal flow:
 *
 *   extract-query
 *     └─ success ──► decide-tools
 *   decide-tools
 *     └─ (tools | no-tools) ──► recall-candidates
 *   recall-candidates
 *     └─ recalled ──► book-search-scatter (scatter over scoutProviders, concurrency 4)
 *          body: scoutDispatch (reads currentItem, routes to matching scout logic)
 *          gather: scout-merge (flat-merges candidates + failureCause from clones)
 *          reducer: any-success (routes 'success' if any clone found results)
 *     └─ rank-candidates
 *     └─ merge-candidates
 *          ├─ ranked ──► record-findings
 *          └─ empty  ──► no-results (TerminalNode(failed) → parent EmbeddedDAGNode routes parent error)
 *     └─ record-findings
 *     └─ has-citations-gate
 *          ├─ pass ──► recall-past-visits ──► END (success)
 *          └─ fail ──► no-results (TerminalNode(failed) → parent EmbeddedDAGNode routes parent error)
 *
 * Outputs:
 *   success: query extracted, candidates found, ranked, recorded, and recalled
 *   error:   no candidates after merge, or citations gate failed;
 *             signalled by the no-results TerminalNode(failed) placement so
 *             the parent EmbeddedDAGNode routes the parent placement to its
 *             'error' branch
 *
 * Molecular import pattern:
 *   import { bookSearchScatterBundle } from './embedded-dags/BookSearchScatterDAG.ts';
 *   dispatcher.registerBundle(bookSearchScatterBundle);
 *
 * The sub-DAG reads `state.query` directly (no input stateMapping; the field
 * names already align with the parent). Each parent placement supplies an
 * `outputs` stateMapping that copies the fields the sub-DAG writes:
 * `terms`, `toolPlan`, `candidates`, `shortlist`, `priorContext`,
 * `failureCause` back onto the parent state so the downstream compose,
 * group-by-year, and recall steps can read them.
 *
 * Three EmbeddedDAGNode placements in the parent `the-archivist` DAG reference
 * this one definition. One definition, three usages:
 *   on-topic-search:  general web book search
 *   author-search:    author body-of-work search
 *   similar-search:   recommend-similar search
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
  decideToolsSalvage,
  extractQuerySalvage,
  rankCandidatesSalvage,
} from '../nodes/salvage.ts';
import {
  scoutDispatch,
} from '../nodes/scouts.ts';
import type { ArchivistServices } from '../services.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

/**
 * The `book-search-scatter` DAG: one packaged unit that any parent DAG
 * can reference via `.embeddedDAG('placement-name', 'book-search-scatter', routes)`.
 */
export const BookSearchScatterDAG: DAGType = new DAGBuilder('book-search-scatter', '1.0')

  // ── 1. extract-query ─────────────────────────────────────────────────────
  // LLM parses the raw visitor question into structured search terms.
  // Writes state.terms for the scouts and decide-tools to consume.
  // 'retry' loops back (bounded by the state retry budget); 'salvage' routes to
  // a deterministic recovery node; never a fabricated term list on the node.
  // #region retry-salvage-wiring
  .node('extract-query', extractQuery, {
    'success': 'decide-tools',
    'retry':   'extract-query',          // flow-shape retry loop (self-edge)
    'salvage': 'extract-query-salvage',  // recovery route
  })
  .node('extract-query-salvage', extractQuerySalvage, {
    'done': 'decide-tools',              // deterministic recovery rejoins the happy path
  })
  // #endregion retry-salvage-wiring

  // ── 2. decide-tools ──────────────────────────────────────────────────────
  // LLM decides which external sources to invoke. Both outputs route into
  // recall-candidates so prior memory is loaded before scouts fire.
  // 'retry' loops back (bounded); 'salvage' routes to the minimal-plan node.
  .node('decide-tools', decideTools, {
    'tools':    'recall-candidates',
    'no-tools': 'recall-candidates',
    'retry':    'decide-tools',
    'salvage':  'decide-tools-salvage',
  })
  .node('decide-tools-salvage', decideToolsSalvage, {
    'done': 'recall-candidates',
  })

  // ── 2b. recall-candidates ────────────────────────────────────────────────
  // Pre-loads state.priorCandidates from memory: shortlisted books from prior
  // runs whose visitor query has Jaccard >= 0.35 overlap with the current
  // query. Cap 10. Always routes 'recalled', even when no prior runs match.
  .node('recall-candidates', recallCandidates, {
    'recalled': 'book-search-scatter',
  })

  // ── 3. book-search-scatter ───────────────────────────────────────────────
  // Heterogeneous scatter: four provider descriptors fan out concurrently.
  // scoutDispatch reads state.scoutProviders items via the currentItem
  // metadata key and routes to the matching scout logic.
  // scout-merge gather flat-merges candidates + failureCause from all four
  // clones. any-success reducer: 'success' → rank-candidates (at least one
  // hit); 'error' → rank-candidates (proceed even when all scouts return
  // empty — rank handles the empty-candidates case gracefully).
  .scatter('book-search-scatter', 'scoutProviders', scoutDispatch, {
    'success': 'rank-candidates',
    'error':   'rank-candidates',
    'empty':   'rank-candidates',
  }, {
    'concurrency': 4,
    'gather': { 'strategy': 'scout-merge' },
    'reducer': 'any-success',
  })

  // ── 4. rank-candidates ───────────────────────────────────────────────────
  // LLM-driven relevance scoring. Routes 'ranked' on success (an empty set is
  // still a valid ranking, so merge can soft-gate on zero candidates).
  // 'retry' loops back (bounded); 'salvage' passes candidates through unranked
  // via a dedicated node rather than emitting them as if they were ranked.
  .node('rank-candidates', rankCandidates, {
    'ranked':  'merge-candidates',
    'retry':   'rank-candidates',
    'salvage': 'rank-candidates-salvage',
  })
  .node('rank-candidates-salvage', rankCandidatesSalvage, {
    'done': 'merge-candidates',
  })

  // ── 5. merge-candidates ──────────────────────────────────────────────────
  // Cross-source dedupe via CanonicalId, top-5. Routes 'empty' to
  // no-results (TerminalNode(failed)) so the parent EmbeddedDAGNode's
  // terminal outcome routes the parent placement to its 'error' branch.
  .node('merge-candidates', mergeCandidates, {
    'ranked': 'record-findings',
    'empty':  'no-results',
  })

  // ── 6. record-findings ───────────────────────────────────────────────────
  // Deterministic RDF write: same input always produces the same triples.
  .node('record-findings', recordFindings, {
    'recorded': 'has-citations-gate',
  })

  // ── 7. has-citations-gate ────────────────────────────────────────────────
  // SPARQL ASK over the per-run state graph. Symbolic fence for the LLM.
  // 'fail' routes to no-results (TerminalNode(failed)) so the parent
  // EmbeddedDAGNode routes the parent placement to 'error'.
  .node('has-citations-gate', hasCitationsGate, {
    'pass': 'recall-past-visits',
    'fail': 'no-results',
  })

  // ── 8. recall-past-visits ────────────────────────────────────────────────
  // Injects prior-session context (prior queries + shortlisted titles) into
  // state.priorContext, then routes to the canonical `found` TerminalNode
  // (completed) so the parent EmbeddedDAGNode resolves its 'success' branch.
  .node('recall-past-visits', recallPastVisits, {
    'recalled': 'found',
  })

  // ── 9. Terminal nodes ────────────────────────────────────────────────────
  // Both sub-DAG exits are canonical TerminalNode placements (no bare null
  // routes): `found` (completed) drives the parent EmbeddedDAGNode's 'success'
  // branch; `no-results` (failed) drives its 'error' branch.
  .terminal('found', { outcome: 'completed' })
  .terminal('no-results', { outcome: 'failed' })

  .build();

/**
 * Bundle of every node used by `BookSearchScatterDAG` plus the DAG itself.
 * Register with `dispatcher.registerBundle(bookSearchScatterBundle)`; nodes
 * register before the DAG so the validator resolves all node references.
 */
export const bookSearchScatterBundle: DispatcherBundleType<ArchivistState, ArchivistServices> = {
  'nodes': [
    extractQuery, decideTools, recallCandidates, scoutDispatch,
    rankCandidates, mergeCandidates, recordFindings, hasCitationsGate,
    recallPastVisits, extractQuerySalvage, decideToolsSalvage,
    rankCandidatesSalvage,
  ],
  'dags': [BookSearchScatterDAG],
};
