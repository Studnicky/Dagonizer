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
 *          body: DagReference(item.dagIri) (resolves declared tool DAG IRI per item)
 *          book-search-gather: tool-candidate-merge (reads clone output via accessor, no cast)
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

import { DAGBuilder, DAGIdentity, PlaceholderNode } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

const BOOK_SEARCH_SCATTER_DAG_IRI = 'urn:noocodec:dag:book-search-scatter';
const placement = (placementIdentifier: string): string => DAGIdentity.placementId(BOOK_SEARCH_SCATTER_DAG_IRI, placementIdentifier);
const display = <T extends string>(name: T): { name: T } => ({ name });

const BOOK_SEARCH_TOOL_DAGS = [
  'urn:noocodec:tool:web_search_books',
  'urn:noocodec:tool:google_books_search',
  'urn:noocodec:tool:subject_search',
  'urn:noocodec:tool:wikipedia_summary',
] as const;

const extractQuery          = new PlaceholderNode<ArchivistState, 'success' | 'retry' | 'salvage'>('urn:noocodec:node:extract-query', ['success', 'retry', 'salvage']);
const extractQuerySalvage   = new PlaceholderNode<ArchivistState, 'done'>('urn:noocodec:node:extract-query-salvage', ['done']);
const decideTools           = new PlaceholderNode<ArchivistState, 'tools' | 'no-tools' | 'retry' | 'salvage'>('urn:noocodec:node:decide-tools', ['tools', 'no-tools', 'retry', 'salvage']);
const decideToolsSalvage    = new PlaceholderNode<ArchivistState, 'done'>('urn:noocodec:node:decide-tools-salvage', ['done']);
const recallCandidates      = new PlaceholderNode<ArchivistState, 'recalled'>('urn:noocodec:node:recall-candidates', ['recalled']);
const buildBookWorksets     = new PlaceholderNode<ArchivistState, 'ready'>('urn:noocodec:node:build-book-worksets', ['ready']);
const rankCandidates        = new PlaceholderNode<ArchivistState, 'ranked' | 'retry' | 'salvage'>('urn:noocodec:node:rank-candidates', ['ranked', 'retry', 'salvage']);
const rankCandidatesSalvage = new PlaceholderNode<ArchivistState, 'done'>('urn:noocodec:node:rank-candidates-salvage', ['done']);
const mergeCandidates       = new PlaceholderNode<ArchivistState, 'ranked' | 'empty'>('urn:noocodec:node:merge-candidates', ['ranked', 'empty']);
const recordFindings        = new PlaceholderNode<ArchivistState, 'recorded'>('urn:noocodec:node:record-findings', ['recorded']);
const hasCitationsGate      = new PlaceholderNode<ArchivistState, 'pass' | 'fail'>('urn:noocodec:node:has-citations-gate', ['pass', 'fail']);
const recallPastVisits      = new PlaceholderNode<ArchivistState, 'recalled'>('urn:noocodec:node:recall-past-visits', ['recalled']);

export const bookSearchScatterDAG: DAGType = new DAGBuilder(BOOK_SEARCH_SCATTER_DAG_IRI, '1.0', display('book-search-scatter'))

      // ── 1. extract-query ─────────────────────────────────────────────────────
      // LLM parses the raw visitor question into structured search terms.
      // Writes state.terms for the scouts and decide-tools to consume.
      // 'retry' loops back (bounded by the state retry budget); 'salvage' routes to
      // a deterministic recovery node; never a fabricated term list on the node.
      // #region retry-salvage-wiring
      .node(placement('extract-query'), extractQuery, {
        'success': placement('decide-tools'),
        'retry':   placement('extract-query'),          // flow-shape retry loop (self-edge)
        'salvage': placement('extract-query-salvage'),  // recovery route
      }, display('extract-query'))
      .node(placement('extract-query-salvage'), extractQuerySalvage, {
        'done': placement('decide-tools'),              // deterministic recovery rejoins the happy path
      }, display('extract-query-salvage'))
      // #endregion retry-salvage-wiring

      // ── 2. decide-tools ──────────────────────────────────────────────────────
      // LLM decides which external sources to invoke. Both outputs route into
      // recall-candidates so prior memory is loaded before scouts fire.
      // 'retry' loops back (bounded); 'salvage' routes to the minimal-plan node.
      .node(placement('decide-tools'), decideTools, {
        'tools':    placement('recall-candidates'),
        'no-tools': placement('recall-candidates'),
        'retry':    placement('decide-tools'),
        'salvage':  placement('decide-tools-salvage'),
      }, display('decide-tools'))
      .node(placement('decide-tools-salvage'), decideToolsSalvage, {
        'done': placement('recall-candidates'),
      }, display('decide-tools-salvage'))

      // ── 2b. recall-candidates ────────────────────────────────────────────────
      // Pre-loads state.priorCandidates from memory: shortlisted books from prior
      // runs whose visitor query has Jaccard >= 0.35 overlap with the current
      // query. Cap 10. Always routes 'recalled', even when no prior runs match.
      .node(placement('recall-candidates'), recallCandidates, {
        'recalled': placement('build-book-worksets'),
      }, display('recall-candidates'))

      // ── 2c. build-book-worksets ──────────────────────────────────────────────
      // Converts state.toolPlan into a bookWorksets array where each entry
      // carries { dagIri: 'urn:noocodec:tool:<name>', arguments: {...} }. The scatter
      // placement reads dagIri through an item-scoped DagReference to resolve
      // the body DAG at runtime.
      .node(placement('build-book-worksets'), buildBookWorksets, {
        'ready': placement('book-search-scatter'),
      }, display('build-book-worksets'))

      // ── 3. book-search-scatter ───────────────────────────────────────────────
      // Tool-registry scatter: bookWorksets items fan out concurrently. Each item
      // carries its own tool DAG IRI via dagIri; the DagReference
      // resolves the body DAG at runtime from the item. ToolInvokeNode reads the
      // item's arguments field and calls the bound tool. The following GatherNode
      // reads each clone's ToolInvocationState.output (via accessor, no cast)
      // and folds the CandidateType[] into the parent state's candidates.
      // any-success reducer: 'success' → rank-candidates when at least one tool hit;
      // 'error' → rank-candidates to allow graceful empty-candidates handling.
      .scatter(placement('book-search-scatter'), 'bookWorksets', { 'dag': { 'from': 'item', 'path': 'dagIri', 'candidates': BOOK_SEARCH_TOOL_DAGS } }, {
        'success': placement('book-search-gather'),
        'error':   placement('book-search-gather'),
        'empty':   placement('rank-candidates'),
      }, {
        'name': 'book-search-scatter',
        'execution': { 'mode': 'item', 'concurrency': 4 },
        'reducer': 'any-success',
      })
      .gather(placement('book-search-gather'), { [placement('book-search-scatter')]: {} }, { 'strategy': 'tool-candidate-merge' }, {
        'success': placement('rank-candidates'),
        'error':   placement('rank-candidates'),
        'empty':   placement('rank-candidates'),
      }, display('book-search-gather'))

      // ── 4. rank-candidates ───────────────────────────────────────────────────
      // LLM-driven relevance scoring. Routes 'ranked' on success (an empty set is
      // still a valid ranking, so merge can soft-gate on zero candidates).
      // 'retry' loops back (bounded); 'salvage' passes candidates through unranked
      // via a dedicated node rather than emitting them as if they were ranked.
      .node(placement('rank-candidates'), rankCandidates, {
        'ranked':  placement('merge-candidates'),
        'retry':   placement('rank-candidates'),
        'salvage': placement('rank-candidates-salvage'),
      }, display('rank-candidates'))
      .node(placement('rank-candidates-salvage'), rankCandidatesSalvage, {
        'done': placement('merge-candidates'),
      }, display('rank-candidates-salvage'))

      // ── 5. merge-candidates ──────────────────────────────────────────────────
      // Cross-source dedupe via CanonicalId, top-5. Routes 'empty' to
      // no-results (TerminalNode(failed)) so the parent EmbeddedDAGNode's
      // terminal outcome routes the parent placement to its 'error' branch.
      .node(placement('merge-candidates'), mergeCandidates, {
        'ranked': placement('record-findings'),
        'empty':  placement('no-results'),
      }, display('merge-candidates'))

      // ── 6. record-findings ───────────────────────────────────────────────────
      // Deterministic RDF write: same input always produces the same triples.
      .node(placement('record-findings'), recordFindings, {
        'recorded': placement('has-citations-gate'),
      }, display('record-findings'))

      // ── 7. has-citations-gate ────────────────────────────────────────────────
      // SPARQL ASK over the per-run state graph. Symbolic fence for the LLM.
      // 'fail' routes to no-results (TerminalNode(failed)) so the parent
      // EmbeddedDAGNode routes the parent placement to 'error'.
      .node(placement('has-citations-gate'), hasCitationsGate, {
        'pass': placement('recall-past-visits'),
        'fail': placement('no-results'),
      }, display('has-citations-gate'))

      // ── 8. recall-past-visits ────────────────────────────────────────────────
      // Injects prior-session context (prior queries + shortlisted titles) into
      // state.priorContext, then routes to the canonical `found` TerminalNode
      // (completed) so the parent EmbeddedDAGNode resolves its 'success' branch.
      .node(placement('recall-past-visits'), recallPastVisits, {
        'recalled': placement('found'),
      }, display('recall-past-visits'))

      // ── 9. Terminal nodes ────────────────────────────────────────────────────
      // Both sub-DAG exits are canonical TerminalNode placements (no bare null
      // routes): `found` (completed) drives the parent EmbeddedDAGNode's 'success'
      // branch; `no-results` (failed) drives its 'error' branch.
      .terminal(placement('found'), { outcome: 'completed', name: 'found' })
      .terminal(placement('no-results'), { outcome: 'failed', name: 'no-results' })

      .build();
