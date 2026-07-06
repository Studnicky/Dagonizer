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
 *   import { bookSearchScatterDAG } from './embedded-dags/BookSearchScatterDAG.ts';
 *   const nodes = ArchivistNodes.build(services);
 *   dispatcher.registerBundle(toolRegistry.bundle<ArchivistServices>());
 *   dispatcher.registerBundle({ nodes: nodes.bookSearchScatterNodes, dags: [bookSearchScatterDAG] });
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

import type { ArchivistState } from '../ArchivistState.ts';

import { DAGBuilder, PlaceholderNode } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

const extractQuery          = new PlaceholderNode<ArchivistState, 'success' | 'retry' | 'salvage'>('extract-query', ['success', 'retry', 'salvage']);
const extractQuerySalvage   = new PlaceholderNode<ArchivistState, 'done'>('extract-query-salvage', ['done']);
const decideTools           = new PlaceholderNode<ArchivistState, 'tools' | 'no-tools' | 'retry' | 'salvage'>('decide-tools', ['tools', 'no-tools', 'retry', 'salvage']);
const decideToolsSalvage    = new PlaceholderNode<ArchivistState, 'done'>('decide-tools-salvage', ['done']);
const recallCandidates      = new PlaceholderNode<ArchivistState, 'recalled'>('recall-candidates', ['recalled']);
const buildBookWorksets     = new PlaceholderNode<ArchivistState, 'ready'>('build-book-worksets', ['ready']);
const rankCandidates        = new PlaceholderNode<ArchivistState, 'ranked' | 'retry' | 'salvage'>('rank-candidates', ['ranked', 'retry', 'salvage']);
const rankCandidatesSalvage = new PlaceholderNode<ArchivistState, 'done'>('rank-candidates-salvage', ['done']);
const mergeCandidates       = new PlaceholderNode<ArchivistState, 'ranked' | 'empty'>('merge-candidates', ['ranked', 'empty']);
const recordFindings        = new PlaceholderNode<ArchivistState, 'recorded'>('record-findings', ['recorded']);
const hasCitationsGate      = new PlaceholderNode<ArchivistState, 'pass' | 'fail'>('has-citations-gate', ['pass', 'fail']);
const recallPastVisits      = new PlaceholderNode<ArchivistState, 'recalled'>('recall-past-visits', ['recalled']);

export const bookSearchScatterDAG: DAGType = new DAGBuilder('book-search-scatter', '1.0')

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
        'recalled': 'build-book-worksets',
      })

      // ── 2c. build-book-worksets ──────────────────────────────────────────────
      // Converts state.toolPlan into a bookWorksets array where each entry
      // carries { dagName: 'tool:<name>', arguments: {...} }. The scatter
      // placement reads dagName via { dagFrom: 'dagName' } to resolve the body
      // DAG at runtime — each item dispatches to its own tool:<name> embedded DAG.
      .node('build-book-worksets', buildBookWorksets, {
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
