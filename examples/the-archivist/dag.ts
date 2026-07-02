/**
 * The Archivist: canonical DAG, built with DAGBuilder. Version 6.0.
 *
 * Molecular composition: the parent DAG is composed of two reusable
 * sub-DAGs that ship as independent components and are imported as
 * `.embeddedDAG(name, dagName, routes)` placements. The sub-DAGs are
 * registered separately and referenced by name; the parent DAG never knows
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
import type { ArchivistNodes } from './nodes/ArchivistNodes.ts';
import './nodes/scouts.ts'; // registers 'tool-candidate-merge' gather strategy

import { DAGBuilder } from '@studnicky/dagonizer';
import type { DispatcherBundleType } from '@studnicky/dagonizer';

// #region dispatcher-bundle
//
// IRI identity: DAGBuilder embeds the canonical DAG_CONTEXT in every built
// DAG's `@context` field. The archivist uses bare node names (e.g.
// 'recall-context', 'classify-intent') which expand to the default namespace:
//   https://noocodex.dev/dag/default#recall-context
//   https://noocodex.dev/dag/default#classify-intent
//
// @id values on each node placement follow the urn:noocodex:dag:<dagName>/node/<placementName>
// convention produced by DAGIdentity.placementId(), e.g.:
//   urn:noocodex:dag:the-archivist/node/recall-context
//
// A plugin shipping nodes under its own namespace would declare a prefix in
// the bundle's `context` field — e.g. { context: { archivist: 'https://archivist.example.com/' } }
// — and use prefixed names like 'archivist:recallContext' to prevent collisions
// with other plugins that might register a node named 'recallContext'.
// See docs/guide/iri-identity.md for the full expansion rule set.
export class ArchivistBundleFactory {
  static create(nodes: ArchivistNodes): DispatcherBundleType<ArchivistState> {
    const dag = new DAGBuilder('the-archivist', '6.0')

      // ── pre-phase: setup ─────────────────────────────────────────────────────
      // Stamps state.runId and clears any stale draft before the main loop starts.
      // PhaseNode placement: runs before the entrypoint node; errors abort the run.
      // No routing: phase placements are out-of-band and never set the entrypoint.
      .phase('setup', 'pre', nodes.preRunSetup)

      // ── 0. park-for-input (HITL gate) ────────────────────────────────────────
      // First added → auto-entrypoint. Parks the flow when state.query is empty,
      // waiting for the human to supply input via the browser HITL banner. On
      // resume, `state.query` is set by the caller before `dispatcher.resume()`;
      // the node then routes `'resumed'` and proceeds to `recall-context`.
      // The `'parked'` output routes to the engine park machinery (null wiring).
      .node('park-for-input', nodes.parkForInput, {
        'parked':  'park-for-input',
        'resumed': 'recall-context',
      })

      // ── 1. recall-context ────────────────────────────────────────────────────
      // Runs before classifyIntent so the classifier can benefit from
      // prior-session continuity hints.
      .node('recall-context', nodes.recallContext, {
        'recalled': 'classify-intent',
      })

      // #region intent-routes
      // ── 1. classify-intent ───────────────────────────────────────────────────
      // Wide output union routes to seven branches. EmbeddedDAG placements and inline
      // branches share the same shared terminal: compose-loop and compose-empty.
      // recall-memories routes directly to memory-recall → compose-memory-recall
      // → memory-respond (no search needed; the memory store is the source).
      .node('classify-intent', nodes.classifyIntent, {
        'lookup-author':        'author-search',
        'find-reviews':         'reviews-extract',
        'describe-book':        'describe-extract',
        'recommend-similar':    'recommend-similar',
        'recall-memories':      'memory-recall',
        'on-topic':             'on-topic-search',
        'recommend-top-rated':  'recommend-extract',
        'off-topic':            'decline-off-topic',
        // Own timeout / classifier failure → retry budget decides. 'retry' loops
        // back; 'salvage' defaults to the broadest on-topic search via a node.
        'retry':                'classify-intent',
        'salvage':              'classify-intent-salvage',
      })
      .node('classify-intent-salvage', nodes.classifyIntentSalvage, {
        'done': 'on-topic-search',
      })
      // #endregion intent-routes

      // #region embedded-dag-placements
      // ── on-topic branch ──────────────────────────────────────────────────────
      // EmbeddedDAGNode: book-search-scatter handles extract-query, decide-tools,
      // all four scouts, rank-candidates, merge, record, gate, and recall.
      // One packaged cluster; first of three placements of the same sub-DAG.
      // gather.map copies the fields the sub-DAG writes back to the parent state
      // so compose-loop and group-by-year can read them.
      .embeddedDAG('on-topic-search', 'book-search-scatter', {
        'success': 'compose-loop',
        'error':   'compose-empty',
      }, {
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
      .embeddedDAG('author-search', 'book-search-scatter', {
        'success': 'group-by-year',
        'error':   'compose-empty',
      }, {
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
      .node('group-by-year', nodes.groupByYear, {
        'ordered': 'compose-loop',
      })

      // ── find-reviews branch ───────────────────────────────────────────────────
      // Inlined. Uses rankByRating (deterministic, rating-weighted) in place of
      // rankCandidates (LLM-driven). The Google Books scout carries notes.rating /
      // notes.ratingsCount; rankByRating weights those for reviews-style output.
      .node('reviews-extract', nodes.extractQuery, {
        'success': 'reviews-decide-tools',
        'retry':   'reviews-extract',
        'salvage': 'reviews-extract-salvage',
      })
      .node('reviews-extract-salvage', nodes.extractQuerySalvage, {
        'done': 'reviews-decide-tools',
      })
      .node('reviews-decide-tools', nodes.decideTools, {
        'tools':    'reviews-build-worksets',
        'no-tools': 'reviews-build-worksets',
        'retry':    'reviews-decide-tools',
        'salvage':  'reviews-decide-tools-salvage',
      })
      .node('reviews-decide-tools-salvage', nodes.decideToolsSalvage, {
        'done': 'reviews-build-worksets',
      })
      // Build scatter worksets: converts toolPlan into bookWorksets items so the
      // scatter can dispatch to each tool:<name> embedded DAG via dagFrom.
      .node('reviews-build-worksets', nodes.buildBookWorksets, {
        'ready': 'reviews-scatter',
      })
      // Tool-registry scatter: each bookWorksets item names its own tool:<name>
      // embedded DAG. tool-candidate-merge gather reads each clone's output via
      // accessor (no cast) and folds CandidateType[] into parent candidates.
      .scatter('reviews-scatter', 'bookWorksets', { 'dagFrom': 'dagName' }, {
        'success': 'reviews-rank',
        'error':   'reviews-rank',
        'empty':   'reviews-rank',
      }, {
        'execution': { 'mode': 'item', 'concurrency': 4 },
        'gather': { 'strategy': 'tool-candidate-merge' },
        'reducer': 'any-success',
      })
      .node('reviews-rank',    nodes.rankByRating,     { 'ranked': 'reviews-merge' })
      .node('reviews-merge',   nodes.mergeCandidates,  { 'ranked': 'reviews-record', 'empty': 'compose-empty' })
      .node('reviews-record',  nodes.recordFindings,   { 'recorded': 'reviews-gate' })
      .node('reviews-gate',    nodes.hasCitationsGate, { 'pass': 'reviews-recall', 'fail': 'compose-empty' })
      .node('reviews-recall',  nodes.recallPastVisits, { 'recalled': 'compose-loop' })

      // ── recommend-top-rated branch ───────────────────────────────────────────
      // Inlined, structural sibling of find-reviews. Reuses rankByRating
      // (deterministic, rating-weighted) instead of rankCandidates (LLM-driven)
      // because a vague "good book / good story" request carries no topic for
      // relevance ranking — rating is the only signal that makes sense.
      .node('recommend-extract', nodes.extractQuery, {
        'success': 'recommend-decide-tools',
        'retry':   'recommend-extract',
        'salvage': 'recommend-extract-salvage',
      })
      .node('recommend-extract-salvage', nodes.extractQuerySalvage, {
        'done': 'recommend-decide-tools',
      })
      .node('recommend-decide-tools', nodes.decideTools, {
        'tools':    'recommend-build-worksets',
        'no-tools': 'recommend-build-worksets',
        'retry':    'recommend-decide-tools',
        'salvage':  'recommend-decide-tools-salvage',
      })
      .node('recommend-decide-tools-salvage', nodes.decideToolsSalvage, {
        'done': 'recommend-build-worksets',
      })
      // Build scatter worksets: converts toolPlan into bookWorksets items so the
      // scatter can dispatch to each tool:<name> embedded DAG via dagFrom.
      .node('recommend-build-worksets', nodes.buildBookWorksets, {
        'ready': 'recommend-scatter',
      })
      // Tool-registry scatter: each bookWorksets item names its own tool:<name>
      // embedded DAG. tool-candidate-merge gather reads each clone's output via
      // accessor (no cast) and folds CandidateType[] into parent candidates.
      .scatter('recommend-scatter', 'bookWorksets', { 'dagFrom': 'dagName' }, {
        'success': 'recommend-rank',
        'error':   'recommend-rank',
        'empty':   'recommend-rank',
      }, {
        'execution': { 'mode': 'item', 'concurrency': 4 },
        'gather': { 'strategy': 'tool-candidate-merge' },
        'reducer': 'any-success',
      })
      .node('recommend-rank',   nodes.rankByRating,     { 'ranked': 'recommend-merge' })
      .node('recommend-merge',  nodes.mergeCandidates,  { 'ranked': 'recommend-record', 'empty': 'compose-empty' })
      .node('recommend-record', nodes.recordFindings,   { 'recorded': 'recommend-gate' })
      .node('recommend-gate',   nodes.hasCitationsGate, { 'pass': 'recommend-recall', 'fail': 'compose-empty' })
      .node('recommend-recall', nodes.recallPastVisits, { 'recalled': 'compose-loop' })

      // ── describe-book branch ─────────────────────────────────────────────────
      // Inlined. Uses pickBestMatch to narrow multi-hit results to the top-3
      // title-similar candidates before merge. Ensures the composer receives the
      // specific book the visitor named, not arbitrary top-5 hits.
      .node('describe-extract',      nodes.extractQuery,     { 'success': 'describe-decide-tools', 'retry': 'describe-extract', 'salvage': 'describe-extract-salvage' })
      .node('describe-extract-salvage', nodes.extractQuerySalvage, { 'done': 'describe-decide-tools' })
      .node('describe-decide-tools', nodes.decideTools,      { 'tools': 'describe-build-worksets', 'no-tools': 'describe-build-worksets', 'retry': 'describe-decide-tools', 'salvage': 'describe-decide-tools-salvage' })
      .node('describe-decide-tools-salvage', nodes.decideToolsSalvage, { 'done': 'describe-build-worksets' })
      // Build scatter worksets before dispatch.
      .node('describe-build-worksets', nodes.buildBookWorksets, {
        'ready': 'describe-scatter',
      })
      // Tool-registry scatter: dagFrom resolves body DAG from each item's dagName.
      // any-success reducer: 'success' → describe-pick, 'error' → compose-empty.
      // 'error' fires when all tool scouts return empty.
      .scatter('describe-scatter', 'bookWorksets', { 'dagFrom': 'dagName' }, {
        'success': 'describe-pick',
        'error':   'compose-empty',
        'empty':   'compose-empty',
      }, {
        'execution': { 'mode': 'item', 'concurrency': 4 },
        'gather': { 'strategy': 'tool-candidate-merge' },
        'reducer': 'any-success',
      })
      .node('describe-pick',   nodes.pickBestMatch,    { 'picked': 'describe-merge' })
      .node('describe-merge',  nodes.mergeCandidates,  { 'ranked': 'describe-record', 'empty': 'compose-empty' })
      .node('describe-record', nodes.recordFindings,   { 'recorded': 'describe-gate' })
      .node('describe-gate',   nodes.hasCitationsGate, { 'pass': 'describe-recall', 'fail': 'compose-empty' })
      .node('describe-recall', nodes.recallPastVisits, { 'recalled': 'compose-loop' })

      // ── recommend-similar branch ─────────────────────────────────────────────
      // recommendSimilar seeds state.terms from prior-run shortlist memory.
      // 'seeded' routes to the book-search-scatter sub-DAG; third placement of
      // the same packaged cluster. 'empty' routes to the compose-empty terminal.
      .node('recommend-similar', nodes.recommendSimilar, {
        'seeded': 'similar-search',
        'empty':  'compose-empty',
      })

      // EmbeddedDAGNode: same book-search-scatter, third and final placement.
      .embeddedDAG('similar-search', 'book-search-scatter', {
        'success': 'compose-loop',
        'error':   'compose-empty',
      }, {
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
      .embeddedDAG('compose-loop', 'compose-retry-loop', {
        'success': 'respond-to-visitor',
        'error':   'compose-empty',
      }, {
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
      .node('respond-to-visitor', nodes.respondToVisitor, { 'success': 'end' })

      // ── recall-memories branch ───────────────────────────────────────────────
      // No search needed; the memory store is queried directly.
      // recallMemories → composeMemoryResponse → respond-to-visitor (shared terminal).
      .node('memory-recall',          nodes.recallMemories,       { 'recalled': 'compose-memory-recall' })
      .node('compose-memory-recall',  nodes.composeMemoryResponse, {
        'drafted': 'respond-to-visitor',
        'retry':   'compose-memory-recall',
        'salvage': 'compose-memory-salvage',
      })
      .node('compose-memory-salvage', nodes.composeMemoryResponseSalvage, { 'done': 'respond-to-visitor' })

      // #region terminal-placements
      // ── Terminal nodes ───────────────────────────────────────────────────────
      .node('decline-off-topic', nodes.declineOffTopic, { 'success': 'end' })
      .node('compose-empty',     nodes.composeEmptyResponse,  {
        'drafted': 'respond-to-visitor',
        'retry':   'compose-empty',
        'salvage': 'compose-empty-salvage',
      })
      .node('compose-empty-salvage', nodes.composeEmptyResponseSalvage, { 'done': 'respond-to-visitor' })

      // Canonical end-of-flow: every completed path (a composed answer or an
      // off-topic decline) routes to this one `TerminalNode(completed)` instead of
      // a bare `null` route. The flow ends explicitly, not by absence of a route.
      .terminal('end', { outcome: 'completed' })
      // #endregion terminal-placements

      .build();

    return {
      'nodes': [
        nodes.preRunSetup,
        nodes.parkForInput,
        nodes.recallContext, nodes.classifyIntent, nodes.extractQuery, nodes.decideTools,
        nodes.buildBookWorksets,
        nodes.rankByRating, nodes.pickBestMatch, nodes.mergeCandidates, nodes.recordFindings,
        nodes.hasCitationsGate, nodes.groupByYear, nodes.recallPastVisits, nodes.recommendSimilar,
        nodes.recallMemories, nodes.composeMemoryResponse, nodes.respondToVisitor,
        nodes.declineOffTopic, nodes.composeEmptyResponse,
        nodes.classifyIntentSalvage, nodes.extractQuerySalvage, nodes.decideToolsSalvage,
        nodes.composeMemoryResponseSalvage, nodes.composeEmptyResponseSalvage,
      ],
      'dags': [dag],
    };
  }
}
// #endregion dispatcher-bundle
