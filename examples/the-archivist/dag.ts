/**
 * The Archivist: canonical DAG, built with DAGBuilder. Version 6.0.
 *
 * Molecular composition: the parent DAG is composed of two reusable
 * sub-DAGs that ship as independent components and are imported as
 * `.embed(name, dagIri, routes)` placements. The sub-DAGs are registered
 * separately and referenced by canonical IRI; the parent DAG never knows
 * their internals.
 *
 *   recall-context
 *     └─ recalled ──► classify-intent
 *
 *   classify-intent
 *     ├─ off-topic         ──► decline-off-topic ──► END
 *     │
 *     ├─ on-topic          ──► [book-search-scatter] (extract+decide+4scouts+rank+merge+record+gate+recall)
 *     │                             ├─ success ──► [compose-retry-loop] (compose+validate+retry)
 *     │                             └─ error   ──► compose-empty ──┐
 *     │                                                             │
 *     ├─ lookup-author     ──► [book-search-scatter]                │
 *     │                             ├─ success ──► group-by-year ──► [compose-retry-loop]
 *     │                             └─ error   ──► compose-empty ──┐
 *
 *     │                                                             ▼
 *     ├─ find-reviews      ──► reviews-extract ──►  [compose-retry-loop] (success) ──► respond-to-visitor ──► END
 *     │                             (inline: decide+4scouts+rankByRating+merge+record+gate+recall)       ▲
 *     │                                                             ▲
 *     ├─ describe-book     ──► describe-extract ──► [compose-retry-loop]
 *     │                             (inline: decide+4scouts+pickBestMatch+merge+record+gate+recall)
 *     │
 *     ├─ recommend         ──► recommend-extract ──►  [compose-retry-loop] (success) ──► respond-to-visitor ──► END
 *     │                             (inline: decide+4scouts+rankByRating+merge+record+gate+recall)        ▲
 *     │                                                             ▲
 *     ├─ recall-memories   ──► memory-recall ──► compose-memory-recall ──────────────────────────────┐
 *     │                                                                                               ▼
 *     └─ recommend-similar ──► recommend-similar-gate                                  respond-to-visitor ──► END
 *                               ├─ seeded ──► [book-search-scatter]                                  ▲
 *                               │                ├─ success ──► [compose-retry-loop] (success) ──────┘
 *                               │                └─ error   ──► compose-empty ──────────────────────►┘
 *                               └─ empty  ──► compose-empty ───────────────────────────────────────►┘
 *
 * Convergence policy (v6.0): all response-producing branches converge into ONE
 * shared `respond-to-visitor` terminal at this (parent) level. The
 * compose-retry-loop embedded-DAG exits with `success` after producing state.draft
 * and does NOT contain respondToVisitor internally. This ensures exactly one
 * terminal node fires per run with the full converged state.draft.
 *
 * Embedded-DAGs (molecular components):
 *   book-search-scatter: extract-query + decide-tools + 4-source parallel scouts
 *                         (OpenLibrary, Google Books, Subject, Wikipedia) + rankCandidates
 *                         + mergeCandidates + recordFindings + hasCitationsGate +
 *                         recallPastVisits. Three placements in this DAG:
 *                         on-topic-search, author-search, similar-search.
 *
 *   compose-retry-loop: composeResponse + validateResponse (with bounded retry loop)
 *                         + respondToVisitor. Four placements in this DAG:
 *                         compose-loop (shared by all four convergent branches).
 *
 * Inlined branches (reviews, describe, recommend-top-rated):
 *   Reviews and recommend-top-rated both use `rankByRating` (deterministic,
 *   rating-weighted) instead of `rankCandidates` (LLM-driven); recommend-top-rated
 *   is the structural sibling of find-reviews, reusing the same node objects at
 *   `recommend-*` placements, for the vague "good book / good story" recommend
 *   intent that has no topic to rank by relevance. Describe uses `pickBestMatch`
 *   to narrow to the top-3 title-similar candidates before merge. All three are
 *   structurally identical to book-search-scatter except for the post-scout
 *   ranking step; keeping them inline makes the intentional distinction explicit
 *   rather than hiding it behind a embedded-DAG parameter.
 *
 * Empty-result handling (v5.2):
 *   Empty results route through `compose-empty` → `respond-to-visitor`.
 *   `compose-empty` calls the LLM with `state.failureCause` (accumulated by
 *   scouts) to produce an in-character message that acknowledges what was
 *   searched and offers a concrete next step.
 *
 * Builder output shape:
 *   DAGBuilder.node(name, dagNode, routes) emits a
 *   { type: 'single', name, node: dagNode.name, outputs: routes }
 *   object. build() returns a plain DAG passed straight to
 *   DAGDocument.load().
 *
 * DAG containment (WorkerThreadContainer) — why the archivist stays in-process:
 *   The container/worker feature is most natural for CPU-bound, self-contained
 *   per-item work: pure data transforms that only read from state and write a
 *   result back (see the-cartographer, which routes its canonical-event enrichment
 *   sub-DAG through a WorkerThreadContainer — haversine, GDPR redaction, pricing
 *   and ETA are pure arithmetic on serialisable data).
 *
 *   The archivist's scatter items (the four scout providers) are LLM / network
 *   bound: each clone calls a live language model and external book APIs. Workers
 *   cannot share the LLM provider instance (it is not serialisable), and each
 *   scatter item's payload — prompt context, live API credentials, LLM adapter
 *   state — crosses the worker message channel as structured-clone, which drops
 *   functions, closures, class instances, and streams.
 *
 *   Worker containment suits CPU / data DAGs. LLM-cascade DAGs — where nodes
 *   carry network clients, streaming responses, and rich provider objects — run
 *   in-process and rely on async concurrency (Promise.all, scatter concurrency)
 *   rather than OS-level thread isolation for parallelism.
 */


import type { ArchivistState } from './ArchivistState.ts';
import './nodes/scouts.ts'; // registers 'tool-candidate-merge' gather strategy

import { DAGBuilder, DAGIdentity, PlaceholderNode } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

// #region dispatcher-bundle
//
// IRI identity: DAGBuilder embeds the canonical DAG_CONTEXT in every built
// DAG's `@context` field. The archivist uses explicit placement IRIs via
// DAGIdentity.placementId(dagIri, placementIdentifier) so route targets,
// gather sources, and entrypoint wiring all stay on canonical IRIs while the
// placement `name` field remains display-only.
//
// @id values on each node placement follow the urn:noocodec:dag:<dagName>/node/<placementName>
// convention produced by DAGIdentity.placementId(), e.g.:
//   urn:noocodec:dag:the-archivist/node/recall-context
//
// A plugin shipping nodes under its own namespace would declare a prefix in
// the bundle's `context` field — e.g. { context: { archivist: 'https://archivist.example.com/' } }
// — and use prefixed names like 'archivist:recallContext' to prevent collisions
// with other plugins that might register a node named 'recallContext'.
// See docs/guide/iri-identity.md for the full expansion rule set.
const BOOK_SEARCH_TOOL_DAGS = [
  'urn:noocodec:tool:web_search_books',
  'urn:noocodec:tool:google_books_search',
  'urn:noocodec:tool:subject_search',
  'urn:noocodec:tool:wikipedia_summary',
] as const;

const ARCHIVIST_DAG_IRI = 'urn:noocodec:dag:the-archivist';
const BOOK_SEARCH_SCATTER_DAG_IRI = 'urn:noocodec:dag:book-search-scatter';
const COMPOSE_RETRY_LOOP_DAG_IRI = 'urn:noocodec:dag:compose-retry-loop';
const placement = (placementIdentifier: string): string => DAGIdentity.placementId(ARCHIVIST_DAG_IRI, placementIdentifier);
const display = <T extends string>(name: T): { name: T } => ({ name });

const nodes = {
  'preRunSetup': new PlaceholderNode<ArchivistState, 'ready'>('urn:noocodec:node:pre-run-setup', ['ready']),
  'parkForInput': new PlaceholderNode<ArchivistState, 'parked' | 'resumed'>('urn:noocodec:node:park-for-input', ['parked', 'resumed']),
  'recallContext': new PlaceholderNode<ArchivistState, 'recalled'>('urn:noocodec:node:recall-context', ['recalled']),
  'classifyIntent': new PlaceholderNode<ArchivistState, 'lookup-author' | 'find-reviews' | 'describe-book' | 'recommend-similar' | 'recall-memories' | 'on-topic' | 'recommend-top-rated' | 'off-topic' | 'retry' | 'salvage'>('urn:noocodec:node:classify-intent', ['lookup-author', 'find-reviews', 'describe-book', 'recommend-similar', 'recall-memories', 'on-topic', 'recommend-top-rated', 'off-topic', 'retry', 'salvage']),
  'classifyIntentSalvage': new PlaceholderNode<ArchivistState, 'done'>('urn:noocodec:node:classify-intent-salvage', ['done']),
  'extractQuery': new PlaceholderNode<ArchivistState, 'success' | 'retry' | 'salvage'>('urn:noocodec:node:extract-query', ['success', 'retry', 'salvage']),
  'extractQuerySalvage': new PlaceholderNode<ArchivistState, 'done'>('urn:noocodec:node:extract-query-salvage', ['done']),
  'decideTools': new PlaceholderNode<ArchivistState, 'tools' | 'no-tools' | 'retry' | 'salvage'>('urn:noocodec:node:decide-tools', ['tools', 'no-tools', 'retry', 'salvage']),
  'decideToolsSalvage': new PlaceholderNode<ArchivistState, 'done'>('urn:noocodec:node:decide-tools-salvage', ['done']),
  'buildBookWorksets': new PlaceholderNode<ArchivistState, 'ready'>('urn:noocodec:node:build-book-worksets', ['ready']),
  'rankByRating': new PlaceholderNode<ArchivistState, 'ranked'>('urn:noocodec:node:rank-by-rating', ['ranked']),
  'pickBestMatch': new PlaceholderNode<ArchivistState, 'picked'>('urn:noocodec:node:pick-best-match', ['picked']),
  'mergeCandidates': new PlaceholderNode<ArchivistState, 'ranked' | 'empty'>('urn:noocodec:node:merge-candidates', ['ranked', 'empty']),
  'recordFindings': new PlaceholderNode<ArchivistState, 'recorded'>('urn:noocodec:node:record-findings', ['recorded']),
  'hasCitationsGate': new PlaceholderNode<ArchivistState, 'pass' | 'fail'>('urn:noocodec:node:has-citations-gate', ['pass', 'fail']),
  'groupByYear': new PlaceholderNode<ArchivistState, 'ordered'>('urn:noocodec:node:group-by-year', ['ordered']),
  'recallPastVisits': new PlaceholderNode<ArchivistState, 'recalled'>('urn:noocodec:node:recall-past-visits', ['recalled']),
  'recommendSimilar': new PlaceholderNode<ArchivistState, 'seeded' | 'empty'>('urn:noocodec:node:recommend-similar', ['seeded', 'empty']),
  'recallMemories': new PlaceholderNode<ArchivistState, 'recalled'>('urn:noocodec:node:recall-memories', ['recalled']),
  'composeMemoryResponse': new PlaceholderNode<ArchivistState, 'drafted' | 'retry' | 'salvage'>('urn:noocodec:node:compose-memory-response', ['drafted', 'retry', 'salvage']),
  'composeMemoryResponseSalvage': new PlaceholderNode<ArchivistState, 'done'>('urn:noocodec:node:compose-memory-salvage', ['done']),
  'respondToVisitor': new PlaceholderNode<ArchivistState, 'success'>('urn:noocodec:node:respond-to-visitor', ['success']),
  'declineOffTopic': new PlaceholderNode<ArchivistState, 'success'>('urn:noocodec:node:decline-off-topic', ['success']),
  'composeEmptyResponse': new PlaceholderNode<ArchivistState, 'drafted' | 'retry' | 'salvage'>('urn:noocodec:node:compose-empty', ['drafted', 'retry', 'salvage']),
  'composeEmptyResponseSalvage': new PlaceholderNode<ArchivistState, 'done'>('urn:noocodec:node:compose-empty-salvage', ['done']),
} as const;

export const archivistDAG: DAGType = new DAGBuilder(ARCHIVIST_DAG_IRI, '6.0', display('the-archivist'))

      // ── pre-phase: setup ─────────────────────────────────────────────────────
      // Stamps state.runId and clears any stale draft before the main loop starts.
      // PhaseNode placement: runs before the entrypoint node; errors abort the run.
      // No routing: phase placements are out-of-band and never set the entrypoint.
      .phase(placement('setup'), 'pre', nodes.preRunSetup, display('setup'))

      // ── 0. park-for-input (HITL gate) ────────────────────────────────────────
      // First added → auto-entrypoint. Parks the flow when state.query is empty,
      // waiting for the human to supply input via the browser HITL banner. On
      // resume, `state.query` is set by the caller before `dispatcher.resume()`;
      // the node then routes `'resumed'` and proceeds to `recall-context`.
      // The `'parked'` output routes to the engine park machinery (null wiring).
      .node(placement('park-for-input'), nodes.parkForInput, {
        'parked':  placement('park-for-input'),
        'resumed': placement('recall-context'),
      }, display('park-for-input'))

      // ── 1. recall-context ────────────────────────────────────────────────────
      // Runs before classifyIntent so the classifier can benefit from
      // prior-session continuity hints.
      .node(placement('recall-context'), nodes.recallContext, {
        'recalled': placement('classify-intent'),
      }, display('recall-context'))

      // #region intent-routes
      // ── 1. classify-intent ───────────────────────────────────────────────────
      // Wide output union routes to seven branches. EmbeddedDAG placements and inline
      // branches share the same shared terminal: compose-loop and compose-empty.
      // recall-memories routes directly to memory-recall → compose-memory-recall
      // → memory-respond (no search needed; the memory store is the source).
      .node(placement('classify-intent'), nodes.classifyIntent, {
        'lookup-author':        placement('author-search'),
        'find-reviews':         placement('reviews-extract'),
        'describe-book':        placement('describe-extract'),
        'recommend-similar':    placement('recommend-similar'),
        'recall-memories':      placement('memory-recall'),
        'on-topic':             placement('on-topic-search'),
        'recommend-top-rated':  placement('recommend-extract'),
        'off-topic':            placement('decline-off-topic'),
        // Own timeout / classifier failure → retry budget decides. 'retry' loops
        // back; 'salvage' defaults to the broadest on-topic search via a node.
        'retry':                placement('classify-intent'),
        'salvage':              placement('classify-intent-salvage'),
      }, display('classify-intent'))
      .node(placement('classify-intent-salvage'), nodes.classifyIntentSalvage, {
        'done': placement('on-topic-search'),
      }, display('classify-intent-salvage'))
      // #endregion intent-routes

      // #region embedded-dag-placements
      // ── on-topic branch ──────────────────────────────────────────────────────
      // EmbeddedDAGNode: book-search-scatter handles extract-query, decide-tools,
      // all four scouts, rank-candidates, merge, record, gate, and recall.
      // One packaged cluster; first of three placements of the same sub-DAG.
      // gather.map copies the fields the sub-DAG writes back to the parent state
      // so compose-loop and group-by-year can read them.
      .embed(placement('on-topic-search'), BOOK_SEARCH_SCATTER_DAG_IRI, {
        'success': placement('compose-loop'),
        'error':   placement('compose-empty'),
      }, {
        'name': 'on-topic-search',
        'outputs': {
          'terms':         'terms',
          'toolPlan':      'toolPlan',
          'candidates':    'candidates',
          'shortlist':     'shortlist',
          'priorContext':  'priorContext',
          'failureCause':  'failureCause',
        },
      })

      // ── lookup-author branch ─────────────────────────────────────────────────
      // EmbeddedDAGNode: same book-search-scatter cluster, second placement.
      // After success, group-by-year sorts results chronologically before the
      // compose loop; author surveys read better in publication-timeline order.
      .embed(placement('author-search'), BOOK_SEARCH_SCATTER_DAG_IRI, {
        'success': placement('group-by-year'),
        'error':   placement('compose-empty'),
      }, {
        'name': 'author-search',
        'outputs': {
          'terms':         'terms',
          'toolPlan':      'toolPlan',
          'candidates':    'candidates',
          'shortlist':     'shortlist',
          'priorContext':  'priorContext',
          'failureCause':  'failureCause',
        },
      })
      // group-by-year is author-branch-specific: sorts shortlist chronologically.
      .node(placement('group-by-year'), nodes.groupByYear, {
        'ordered': placement('compose-loop'),
      }, display('group-by-year'))

      // ── find-reviews branch ───────────────────────────────────────────────────
      // Inlined. Uses rankByRating (deterministic, rating-weighted) in place of
      // rankCandidates (LLM-driven). The Google Books scout carries notes.rating /
      // notes.ratingsCount; rankByRating weights those for reviews-style output.
      .node(placement('reviews-extract'), nodes.extractQuery, {
        'success': placement('reviews-decide-tools'),
        'retry':   placement('reviews-extract'),
        'salvage': placement('reviews-extract-salvage'),
      }, display('reviews-extract'))
      .node(placement('reviews-extract-salvage'), nodes.extractQuerySalvage, {
        'done': placement('reviews-decide-tools'),
      }, display('reviews-extract-salvage'))
      .node(placement('reviews-decide-tools'), nodes.decideTools, {
        'tools':    placement('reviews-build-worksets'),
        'no-tools': placement('reviews-build-worksets'),
        'retry':    placement('reviews-decide-tools'),
        'salvage':  placement('reviews-decide-tools-salvage'),
      }, display('reviews-decide-tools'))
      .node(placement('reviews-decide-tools-salvage'), nodes.decideToolsSalvage, {
        'done': placement('reviews-build-worksets'),
      }, display('reviews-decide-tools-salvage'))
      // Build scatter worksets: converts toolPlan into bookWorksets items so the
      // scatter can dispatch to each declared tool DAG IRI.
      .node(placement('reviews-build-worksets'), nodes.buildBookWorksets, {
        'ready': placement('reviews-scatter'),
      }, display('reviews-build-worksets'))
      // Tool-registry scatter: each bookWorksets item carries its own tool DAG
  // IRI. The following GatherNode reads each clone's output via
      // accessor (no cast) and folds CandidateType[] into parent candidates.
      .scatter(placement('reviews-scatter'), 'bookWorksets', { 'dag': { 'from': 'item', 'path': 'dagIri', 'candidates': BOOK_SEARCH_TOOL_DAGS } }, {
        'success': placement('reviews-gather'),
        'error': placement('reviews-gather'),
        'empty':   placement('reviews-rank'),
      }, {
        'name': 'reviews-scatter',
        'execution': { 'mode': 'item', 'concurrency': 4 },
        'reducer': 'any-success',
      })
  .gather(placement('reviews-gather'), { [placement('reviews-scatter')]: {} }, { 'strategy': 'tool-candidate-merge' }, {
    'success': placement('reviews-rank'),
    'error': placement('reviews-rank'),
    'empty': placement('reviews-rank'),
  }, display('reviews-gather'))
      .node(placement('reviews-rank'),    nodes.rankByRating,     { 'ranked': placement('reviews-merge') }, display('reviews-rank'))
      .node(placement('reviews-merge'),   nodes.mergeCandidates,  { 'ranked': placement('reviews-record'), 'empty': placement('compose-empty') }, display('reviews-merge'))
      .node(placement('reviews-record'),  nodes.recordFindings,   { 'recorded': placement('reviews-gate') }, display('reviews-record'))
      .node(placement('reviews-gate'),    nodes.hasCitationsGate, { 'pass': placement('reviews-recall'), 'fail': placement('compose-empty') }, display('reviews-gate'))
      .node(placement('reviews-recall'),  nodes.recallPastVisits, { 'recalled': placement('compose-loop') }, display('reviews-recall'))

      // ── recommend-top-rated branch ───────────────────────────────────────────
      // Inlined, structural sibling of find-reviews. Reuses rankByRating
      // (deterministic, rating-weighted) instead of rankCandidates (LLM-driven)
      // because a vague "good book / good story" request carries no topic for
      // relevance ranking — rating is the only signal that makes sense.
      .node(placement('recommend-extract'), nodes.extractQuery, {
        'success': placement('recommend-decide-tools'),
        'retry':   placement('recommend-extract'),
        'salvage': placement('recommend-extract-salvage'),
      }, display('recommend-extract'))
      .node(placement('recommend-extract-salvage'), nodes.extractQuerySalvage, {
        'done': placement('recommend-decide-tools'),
      }, display('recommend-extract-salvage'))
      .node(placement('recommend-decide-tools'), nodes.decideTools, {
        'tools':    placement('recommend-build-worksets'),
        'no-tools': placement('recommend-build-worksets'),
        'retry':    placement('recommend-decide-tools'),
        'salvage':  placement('recommend-decide-tools-salvage'),
      }, display('recommend-decide-tools'))
      .node(placement('recommend-decide-tools-salvage'), nodes.decideToolsSalvage, {
        'done': placement('recommend-build-worksets'),
      }, display('recommend-decide-tools-salvage'))
      // Build scatter worksets: converts toolPlan into bookWorksets items so the
      // scatter can dispatch to each declared tool DAG IRI.
      .node(placement('recommend-build-worksets'), nodes.buildBookWorksets, {
        'ready': placement('recommend-scatter'),
      }, display('recommend-build-worksets'))
      // Tool-registry scatter: each bookWorksets item carries its own tool DAG
  // IRI. The following GatherNode reads each clone's output via
      // accessor (no cast) and folds CandidateType[] into parent candidates.
      .scatter(placement('recommend-scatter'), 'bookWorksets', { 'dag': { 'from': 'item', 'path': 'dagIri', 'candidates': BOOK_SEARCH_TOOL_DAGS } }, {
        'success': placement('recommend-gather'),
        'error': placement('recommend-gather'),
        'empty':   placement('recommend-rank'),
      }, {
        'name': 'recommend-scatter',
        'execution': { 'mode': 'item', 'concurrency': 4 },
        'reducer': 'any-success',
      })
  .gather(placement('recommend-gather'), { [placement('recommend-scatter')]: {} }, { 'strategy': 'tool-candidate-merge' }, {
    'success': placement('recommend-rank'),
    'error': placement('recommend-rank'),
    'empty': placement('recommend-rank'),
  }, display('recommend-gather'))
      .node(placement('recommend-rank'),   nodes.rankByRating,     { 'ranked': placement('recommend-merge') }, display('recommend-rank'))
      .node(placement('recommend-merge'),  nodes.mergeCandidates,  { 'ranked': placement('recommend-record'), 'empty': placement('compose-empty') }, display('recommend-merge'))
      .node(placement('recommend-record'), nodes.recordFindings,   { 'recorded': placement('recommend-gate') }, display('recommend-record'))
      .node(placement('recommend-gate'),   nodes.hasCitationsGate, { 'pass': placement('recommend-recall'), 'fail': placement('compose-empty') }, display('recommend-gate'))
      .node(placement('recommend-recall'), nodes.recallPastVisits, { 'recalled': placement('compose-loop') }, display('recommend-recall'))

      // ── describe-book branch ─────────────────────────────────────────────────
      // Inlined. Uses pickBestMatch to narrow multi-hit results to the top-3
      // title-similar candidates before merge. Ensures the composer receives the
      // specific book the visitor named, not arbitrary top-5 hits.
      .node(placement('describe-extract'),      nodes.extractQuery,     { 'success': placement('describe-decide-tools'), 'retry': placement('describe-extract'), 'salvage': placement('describe-extract-salvage') }, display('describe-extract'))
      .node(placement('describe-extract-salvage'), nodes.extractQuerySalvage, { 'done': placement('describe-decide-tools') }, display('describe-extract-salvage'))
      .node(placement('describe-decide-tools'), nodes.decideTools,      { 'tools': placement('describe-build-worksets'), 'no-tools': placement('describe-build-worksets'), 'retry': placement('describe-decide-tools'), 'salvage': placement('describe-decide-tools-salvage') }, display('describe-decide-tools'))
      .node(placement('describe-decide-tools-salvage'), nodes.decideToolsSalvage, { 'done': placement('describe-build-worksets') }, display('describe-decide-tools-salvage'))
      // Build scatter worksets before dispatch.
      .node(placement('describe-build-worksets'), nodes.buildBookWorksets, {
        'ready': placement('describe-scatter'),
      }, display('describe-build-worksets'))
      // Tool-registry scatter: DagReference resolves body DAG from each item's dagName.
      // any-success reducer: 'success' → describe-pick, 'error' → compose-empty.
      // 'error' fires when all tool scouts return empty.
      .scatter(placement('describe-scatter'), 'bookWorksets', { 'dag': { 'from': 'item', 'path': 'dagIri', 'candidates': BOOK_SEARCH_TOOL_DAGS } }, {
        'success': placement('describe-gather'),
        'error':   placement('compose-empty'),
        'empty':   placement('compose-empty'),
      }, {
        'name': 'describe-scatter',
        'execution': { 'mode': 'item', 'concurrency': 4 },
        'reducer': 'any-success',
      })
  .gather(placement('describe-gather'), { [placement('describe-scatter')]: {} }, { 'strategy': 'tool-candidate-merge' }, {
    'success': placement('describe-pick'),
    'error': placement('compose-empty'),
    'empty': placement('compose-empty'),
  }, display('describe-gather'))
      .node(placement('describe-pick'),   nodes.pickBestMatch,    { 'picked': placement('describe-merge') }, display('describe-pick'))
      .node(placement('describe-merge'),  nodes.mergeCandidates,  { 'ranked': placement('describe-record'), 'empty': placement('compose-empty') }, display('describe-merge'))
      .node(placement('describe-record'), nodes.recordFindings,   { 'recorded': placement('describe-gate') }, display('describe-record'))
      .node(placement('describe-gate'),   nodes.hasCitationsGate, { 'pass': placement('describe-recall'), 'fail': placement('compose-empty') }, display('describe-gate'))
      .node(placement('describe-recall'), nodes.recallPastVisits, { 'recalled': placement('compose-loop') }, display('describe-recall'))

      // ── recommend-similar branch ─────────────────────────────────────────────
      // recommendSimilar seeds state.terms from prior-run shortlist memory.
      // 'seeded' routes to the book-search-scatter sub-DAG; third placement of
      // the same packaged cluster. 'empty' routes to the compose-empty terminal.
      .node(placement('recommend-similar'), nodes.recommendSimilar, {
        'seeded': placement('similar-search'),
        'empty':  placement('compose-empty'),
      }, display('recommend-similar'))

      // EmbeddedDAGNode: same book-search-scatter, third and final placement.
      .embed(placement('similar-search'), BOOK_SEARCH_SCATTER_DAG_IRI, {
        'success': placement('compose-loop'),
        'error':   placement('compose-empty'),
      }, {
        'name': 'similar-search',
        'outputs': {
          'terms':         'terms',
          'toolPlan':      'toolPlan',
          'candidates':    'candidates',
          'shortlist':     'shortlist',
          'priorContext':  'priorContext',
          'failureCause':  'failureCause',
        },
      })

      // ── compose-loop: shared compose/validate sub-DAG ──────────────────────────
      // All branches that successfully find candidates converge here.
      // composeResponse → validateResponse (retry loop, bounded by the retry budget on state (retriesFor('compose'))).
      // One sub-DAG definition serves all four convergent branches.
      // stateMapping.outputs copies the compose loop's writes back to the parent.
      //
      // Convergence policy: 'success' routes to the shared respond-to-visitor terminal
      // at the parent level; the sub-DAG produces state.draft and exits cleanly;
      // exactly ONE respond-to-visitor fires per run regardless of branch count.
      // 'error' (retry budget exhausted) falls through to compose-empty so the
      // visitor always receives an in-character response rather than a silent drop.
      .embed(placement('compose-loop'), COMPOSE_RETRY_LOOP_DAG_IRI, {
        'success': placement('respond-to-visitor'),
        'error':   placement('compose-empty'),
      }, {
        'name': 'compose-loop',
        'outputs': {
          'draft':         'draft',
          'approvalState': 'approvalState',
        },
      })
      // #endregion embedded-dag-placements

      // ── respond-to-visitor: single shared happy-path terminal ───────────────
      // Every branch that successfully composes a response converges here.
      // compose-loop (success) and both memory + empty-result paths all route
      // through this one placement. Convergence policy: exactly ONE respond-to-visitor
      // fires per run with the full converged state.draft in context. Success routes
      // to the canonical `end` TerminalNode rather than a bare null end-of-flow.
      .node(placement('respond-to-visitor'), nodes.respondToVisitor, { 'success': placement('end') }, display('respond-to-visitor'))

      // ── recall-memories branch ───────────────────────────────────────────────
      // No search needed; the memory store is queried directly.
      // recallMemories → composeMemoryResponse → respond-to-visitor (shared terminal).
      .node(placement('memory-recall'),          nodes.recallMemories,       { 'recalled': placement('compose-memory-recall') }, display('memory-recall'))
      .node(placement('compose-memory-recall'),  nodes.composeMemoryResponse, {
        'drafted': placement('respond-to-visitor'),
        'retry':   placement('compose-memory-recall'),
        'salvage': placement('compose-memory-salvage'),
      }, display('compose-memory-recall'))
      .node(placement('compose-memory-salvage'), nodes.composeMemoryResponseSalvage, { 'done': placement('respond-to-visitor') }, display('compose-memory-salvage'))

      // #region terminal-placements
      // ── Terminal nodes ───────────────────────────────────────────────────────
      .node(placement('decline-off-topic'), nodes.declineOffTopic, { 'success': placement('end') }, display('decline-off-topic'))
      .node(placement('compose-empty'),     nodes.composeEmptyResponse,  {
        'drafted': placement('respond-to-visitor'),
        'retry':   placement('compose-empty'),
        'salvage': placement('compose-empty-salvage'),
      }, display('compose-empty'))
      .node(placement('compose-empty-salvage'), nodes.composeEmptyResponseSalvage, { 'done': placement('respond-to-visitor') }, display('compose-empty-salvage'))

      // Canonical end-of-flow: every completed path (a composed answer or an
      // off-topic decline) routes to this one `TerminalNode(completed)` instead of
      // a bare `null` route. The flow ends explicitly, not by absence of a route.
      .terminal(placement('end'), { outcome: 'completed', name: 'end' })
      // #endregion terminal-placements

      .build();
// #endregion dispatcher-bundle
