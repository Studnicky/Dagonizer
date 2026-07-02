/**
 * BookSearchScatterDAG: reusable query-extract + tool-registry scatter cluster.
 *
 * Internal flow:
 *
 *   extract-query
 *     └─ success ──► decide-tools
 *   decide-tools
 *     └─ (tools | no-tools) ──► recall-candidates
 *   recall-candidates
 *     └─ recalled ──► build-book-worksets
 *   build-book-worksets
 *     └─ ready ──► book-search-scatter (scatter over bookWorksets, concurrency 4)
 *          body: { dagFrom: 'dagName' } (resolves tool:<name> DAG per item at runtime)
 *          gather: tool-candidate-merge (reads clone output via accessor, no cast)
 *          reducer: any-success (routes 'success' if any tool found results)
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
 *   import { BookSearchScatterBundleFactory } from './embedded-dags/BookSearchScatterDAG.ts';
 *   const nodes = ArchivistNodes.build(services);
 *   dispatcher.registerBundle(toolRegistry.bundle<ArchivistServices>());
 *   dispatcher.registerBundle(BookSearchScatterBundleFactory.create(nodes));
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
import type { ArchivistNodes }    from '../nodes/ArchivistNodes.ts';

import type { DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

/**
 * Factory for the `book-search-scatter` bundle: one packaged unit that any
 * parent DAG can reference via
 * `.embeddedDAG('placement-name', 'book-search-scatter', routes)`.
 */
export class BookSearchScatterBundleFactory {
  static create(nodes: ArchivistNodes): DispatcherBundleType<ArchivistState> {
    const dag = new DAGBuilder('book-search-scatter', '1.0')

      // ── 1. extract-query ─────────────────────────────────────────────────────
      // LLM parses the raw visitor question into structured search terms.
      // Writes state.terms for the scouts and decide-tools to consume.
      // 'retry' loops back (bounded by the state retry budget); 'salvage' routes to
      // a deterministic recovery node; never a fabricated term list on the node.
      // #region retry-salvage-wiring
      .node('extract-query', nodes.extractQuery, {
        'success': 'decide-tools',
        'retry':   'extract-query',          // flow-shape retry loop (self-edge)
        'salvage': 'extract-query-salvage',  // recovery route
      })
      .node('extract-query-salvage', nodes.extractQuerySalvage, {
        'done': 'decide-tools',              // deterministic recovery rejoins the happy path
      })
      // #endregion retry-salvage-wiring

      // ── 2. decide-tools ──────────────────────────────────────────────────────
      // LLM decides which external sources to invoke. Both outputs route into
      // recall-candidates so prior memory is loaded before scouts fire.
      // 'retry' loops back (bounded); 'salvage' routes to the minimal-plan node.
      .node('decide-tools', nodes.decideTools, {
        'tools':    'recall-candidates',
        'no-tools': 'recall-candidates',
        'retry':    'decide-tools',
        'salvage':  'decide-tools-salvage',
      })
      .node('decide-tools-salvage', nodes.decideToolsSalvage, {
        'done': 'recall-candidates',
      })

      // ── 2b. recall-candidates ────────────────────────────────────────────────
      // Pre-loads state.priorCandidates from memory: shortlisted books from prior
      // runs whose visitor query has Jaccard >= 0.35 overlap with the current
      // query. Cap 10. Always routes 'recalled', even when no prior runs match.
      .node('recall-candidates', nodes.recallCandidates, {
        'recalled': 'build-book-worksets',
      })

      // ── 2c. build-book-worksets ──────────────────────────────────────────────
      // Converts state.toolPlan into a bookWorksets array where each entry
      // carries { dagName: 'tool:<name>', arguments: {...} }. The scatter
      // placement reads dagName via { dagFrom: 'dagName' } to resolve the body
      // DAG at runtime — each item dispatches to its own tool:<name> embedded DAG.
      .node('build-book-worksets', nodes.buildBookWorksets, {
        'ready': 'book-search-scatter',
      })

      // ── 3. book-search-scatter ───────────────────────────────────────────────
      // Tool-registry scatter: bookWorksets items fan out concurrently. Each item
      // names its own tool:<name> embedded DAG via dagName; { dagFrom: 'dagName' }
      // resolves the body DAG at runtime from the item. ToolInvokeNode reads the
      // item's arguments field and calls the bound tool. tool-candidate-merge
      // gather reads each clone's ToolInvocationState.output (via accessor, no cast)
      // and folds the CandidateType[] into the parent state's candidates.
      // any-success reducer: 'success' → rank-candidates when at least one tool hit;
      // 'error' → rank-candidates to allow graceful empty-candidates handling.
      .scatter('book-search-scatter', 'bookWorksets', { 'dagFrom': 'dagName' }, {
        'success': 'rank-candidates',
        'error':   'rank-candidates',
        'empty':   'rank-candidates',
      }, {
        'execution': { 'mode': 'item', 'concurrency': 4 },
        'gather': { 'strategy': 'tool-candidate-merge' },
        'reducer': 'any-success',
      })

      // ── 4. rank-candidates ───────────────────────────────────────────────────
      // LLM-driven relevance scoring. Routes 'ranked' on success (an empty set is
      // still a valid ranking, so merge can soft-gate on zero candidates).
      // 'retry' loops back (bounded); 'salvage' passes candidates through unranked
      // via a dedicated node rather than emitting them as if they were ranked.
      .node('rank-candidates', nodes.rankCandidates, {
        'ranked':  'merge-candidates',
        'retry':   'rank-candidates',
        'salvage': 'rank-candidates-salvage',
      })
      .node('rank-candidates-salvage', nodes.rankCandidatesSalvage, {
        'done': 'merge-candidates',
      })

      // ── 5. merge-candidates ──────────────────────────────────────────────────
      // Cross-source dedupe via CanonicalId, top-5. Routes 'empty' to
      // no-results (TerminalNode(failed)) so the parent EmbeddedDAGNode's
      // terminal outcome routes the parent placement to its 'error' branch.
      .node('merge-candidates', nodes.mergeCandidates, {
        'ranked': 'record-findings',
        'empty':  'no-results',
      })

      // ── 6. record-findings ───────────────────────────────────────────────────
      // Deterministic RDF write: same input always produces the same triples.
      .node('record-findings', nodes.recordFindings, {
        'recorded': 'has-citations-gate',
      })

      // ── 7. has-citations-gate ────────────────────────────────────────────────
      // SPARQL ASK over the per-run state graph. Symbolic fence for the LLM.
      // 'fail' routes to no-results (TerminalNode(failed)) so the parent
      // EmbeddedDAGNode routes the parent placement to 'error'.
      .node('has-citations-gate', nodes.hasCitationsGate, {
        'pass': 'recall-past-visits',
        'fail': 'no-results',
      })

      // ── 8. recall-past-visits ────────────────────────────────────────────────
      // Injects prior-session context (prior queries + shortlisted titles) into
      // state.priorContext, then routes to the canonical `found` TerminalNode
      // (completed) so the parent EmbeddedDAGNode resolves its 'success' branch.
      .node('recall-past-visits', nodes.recallPastVisits, {
        'recalled': 'found',
      })

      // ── 9. Terminal nodes ────────────────────────────────────────────────────
      // Both sub-DAG exits are canonical TerminalNode placements (no bare null
      // routes): `found` (completed) drives the parent EmbeddedDAGNode's 'success'
      // branch; `no-results` (failed) drives its 'error' branch.
      .terminal('found', { outcome: 'completed' })
      .terminal('no-results', { outcome: 'failed' })

      .build();

    return {
      'nodes': [
        nodes.extractQuery, nodes.decideTools, nodes.recallCandidates, nodes.buildBookWorksets,
        nodes.rankCandidates, nodes.mergeCandidates, nodes.recordFindings, nodes.hasCitationsGate,
        nodes.recallPastVisits, nodes.extractQuerySalvage, nodes.decideToolsSalvage,
        nodes.rankCandidatesSalvage,
      ],
      'dags': [dag],
    };
  }
}
