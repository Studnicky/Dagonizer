/**
 * The Archivist — canonical DAG, built with DAGBuilder. Version 6.0.
 *
 * Molecular composition: the parent DAG is composed of two reusable
 * sub-DAGs that ship as independent components and are imported as
 * `.embeddedDAG(name, dagName, routes)` placements. The sub-DAGs are
 * registered separately and referenced by name — the parent DAG never knows
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
 *   book-search-scatter — extract-query + decide-tools + 4-source parallel scouts
 *                         (OpenLibrary, Google Books, Subject, Wikipedia) + rankCandidates
 *                         + mergeCandidates + recordFindings + hasCitationsGate +
 *                         recallPastVisits. Three placements in this DAG:
 *                         on-topic-search, author-search, similar-search.
 *
 *   compose-retry-loop  — composeResponse + validateResponse (with bounded retry loop)
 *                         + respondToVisitor. Four placements in this DAG:
 *                         compose-loop (shared by all four convergent branches).
 *
 * Inlined branches (reviews, describe):
 *   Reviews uses `rankByRating` (deterministic, rating-weighted) instead of
 *   `rankCandidates` (LLM-driven). Describe uses `pickBestMatch` to narrow to the
 *   top-3 title-similar candidates before merge. Both are structurally identical to
 *   book-search-scatter except for the post-scout ranking step — keeping them inline
 *   makes the intentional distinction explicit rather than hiding it behind a
 *   embedded-DAG parameter.
 *
 * Empty-result handling (v5.2):
 *   Empty results route through `compose-empty` → `respond-to-visitor`.
 *   `compose-empty` calls the LLM with `state.failureCause` (accumulated by
 *   scouts) to produce an in-character message that acknowledges what was
 *   searched and offers a concrete next step.
 *
 * Builder vs literal equivalence:
 *   DAGBuilder.node(placementName, nodeImpl, routes) emits the same
 *   { type: 'single', name, node: nodeImpl.name, outputs: routes }
 *   object that the hand-written literal used. build() returns a plain
 *   DAG — identical wire shape, same Dagonizer.load() call.
 */


import { classifyIntent }      from './nodes/classifyIntent.ts';
import { composeMemoryResponse } from './nodes/composeMemoryResponse.ts';
import { decideTools }          from './nodes/decideTools.ts';
import { extractQuery }         from './nodes/extractQuery.ts';
import { groupByYear }          from './nodes/groupByYear.ts';
import { hasCitationsGate }     from './nodes/hasCitationsGate.ts';
import { mergeCandidates }      from './nodes/mergeCandidates.ts';
import { pickBestMatch }        from './nodes/pickBestMatch.ts';
import { rankByRating }         from './nodes/rankByRating.ts';
import { recallContext }        from './nodes/recallContext.ts';
import { recallMemories }       from './nodes/recallMemories.ts';
import { recallPastVisits }     from './nodes/recallPastVisits.ts';
import { recommendSimilar }     from './nodes/recommendSimilar.ts';
import { recordFindings }       from './nodes/recordFindings.ts';
import { classifyIntentSalvage, composeEmptyResponseSalvage, composeMemoryResponseSalvage, decideToolsSalvage, extractQuerySalvage } from './nodes/salvage.ts';
import { declineOffTopic, respondToVisitor, composeEmptyResponse } from './nodes/respondToVisitor.ts';
import { openLibraryScout, googleBooksScout, subjectScout, wikipediaScout } from './nodes/scouts.ts';

import { DAGBuilder } from '@noocodex/dagonizer/builder';
import type { DispatcherBundle } from '@noocodex/dagonizer';
import type { ArchivistServices } from './services.ts';
import type { ArchivistState } from './ArchivistState.ts';

export const archivistDAG = new DAGBuilder('the-archivist', '6.0')

  // ── 0. recall-context ────────────────────────────────────────────────────
  // First added → auto-entrypoint. Runs before classifyIntent so the
  // classifier can benefit from prior-session continuity hints.
  .node('recall-context', recallContext, {
    'recalled': 'classify-intent',
  })

  // #region intent-routes
  // ── 1. classify-intent ───────────────────────────────────────────────────
  // Wide output union routes to six branches. EmbeddedDAG placements and inline
  // branches share the same shared terminal: compose-loop and compose-empty.
  // recall-memories routes directly to memory-recall → compose-memory-recall
  // → memory-respond (no search needed; the memory store is the source).
  .node('classify-intent', classifyIntent, {
    'lookup-author':     'author-search',
    'find-reviews':      'reviews-extract',
    'describe-book':     'describe-extract',
    'recommend-similar': 'recommend-similar',
    'recall-memories':   'memory-recall',
    'on-topic':          'on-topic-search',
    'off-topic':         'decline-off-topic',
    // Own timeout / classifier failure → retry budget decides. 'retry' loops
    // back; 'salvage' defaults to the broadest on-topic search via a node.
    'retry':             'classify-intent',
    'salvage':           'classify-intent-salvage',
  })
  .node('classify-intent-salvage', classifyIntentSalvage, {
    'done': 'on-topic-search',
  })
  // #endregion intent-routes

  // #region embedded-dag-placements
  // ── on-topic branch ──────────────────────────────────────────────────────
  // EmbeddedDAGNode: book-search-scatter handles extract-query, decide-tools,
  // all four scouts, rank-candidates, merge, record, gate, and recall.
  // One packaged cluster — first of three placements of the same sub-DAG.
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
  // compose loop — author surveys read better in publication-timeline order.
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
  .node('group-by-year', groupByYear, {
    'ordered': 'compose-loop',
  })

  // ── find-reviews branch ───────────────────────────────────────────────────
  // Inlined — uses rankByRating (deterministic, rating-weighted) in place of
  // rankCandidates (LLM-driven). The Google Books scout carries notes.rating /
  // notes.ratingsCount; rankByRating weights those for reviews-style output.
  .node('reviews-extract', extractQuery, {
    'success': 'reviews-decide-tools',
    'retry':   'reviews-extract',
    'salvage': 'reviews-extract-salvage',
  })
  .node('reviews-extract-salvage', extractQuerySalvage, {
    'done': 'reviews-decide-tools',
  })
  .node('reviews-decide-tools', decideTools, {
    'tools':    'reviews-scatter',
    'no-tools': 'reviews-scatter',
    'retry':    'reviews-decide-tools',
    'salvage':  'reviews-decide-tools-salvage',
  })
  .node('reviews-decide-tools-salvage', decideToolsSalvage, {
    'done': 'reviews-scatter',
  })
  .parallel('reviews-scatter', ['reviews-ol', 'reviews-gb', 'reviews-subject', 'reviews-wiki'], 'collect', {
    'success': 'reviews-rank',
    'error':   'reviews-rank',
  })
  .node('reviews-ol',      openLibraryScout, { 'success': null, 'empty': null })
  .node('reviews-gb',      googleBooksScout, { 'success': null, 'empty': null })
  .node('reviews-subject', subjectScout,     { 'success': null, 'empty': null })
  .node('reviews-wiki',    wikipediaScout,   { 'success': null, 'empty': null })
  .node('reviews-rank',    rankByRating,     { 'ranked': 'reviews-merge' })
  .node('reviews-merge',   mergeCandidates,  { 'ranked': 'reviews-record', 'empty': 'compose-empty' })
  .node('reviews-record',  recordFindings,   { 'recorded': 'reviews-gate' })
  .node('reviews-gate',    hasCitationsGate, { 'pass': 'reviews-recall', 'fail': 'compose-empty' })
  .node('reviews-recall',  recallPastVisits, { 'recalled': 'compose-loop' })

  // ── describe-book branch ─────────────────────────────────────────────────
  // Inlined — uses pickBestMatch to narrow multi-hit results to the top-3
  // title-similar candidates before merge. Ensures the composer receives the
  // specific book the visitor named, not arbitrary top-5 hits.
  .node('describe-extract',      extractQuery,     { 'success': 'describe-decide-tools', 'retry': 'describe-extract', 'salvage': 'describe-extract-salvage' })
  .node('describe-extract-salvage', extractQuerySalvage, { 'done': 'describe-decide-tools' })
  .node('describe-decide-tools', decideTools,      { 'tools': 'describe-scatter', 'no-tools': 'describe-scatter', 'retry': 'describe-decide-tools', 'salvage': 'describe-decide-tools-salvage' })
  .node('describe-decide-tools-salvage', decideToolsSalvage, { 'done': 'describe-scatter' })
  .parallel('describe-scatter', ['describe-ol', 'describe-gb', 'describe-subject', 'describe-wiki'], 'collect', {
    'success': 'describe-pick',
    'error':   'compose-empty',
  })
  .node('describe-ol',      openLibraryScout, { 'success': null, 'empty': null })
  .node('describe-gb',      googleBooksScout, { 'success': null, 'empty': null })
  .node('describe-subject', subjectScout,     { 'success': null, 'empty': null })
  .node('describe-wiki',    wikipediaScout,   { 'success': null, 'empty': null })
  .node('describe-pick',   pickBestMatch,    { 'picked': 'describe-merge' })
  .node('describe-merge',  mergeCandidates,  { 'ranked': 'describe-record', 'empty': 'compose-empty' })
  .node('describe-record', recordFindings,   { 'recorded': 'describe-gate' })
  .node('describe-gate',   hasCitationsGate, { 'pass': 'describe-recall', 'fail': 'compose-empty' })
  .node('describe-recall', recallPastVisits, { 'recalled': 'compose-loop' })

  // ── recommend-similar branch ─────────────────────────────────────────────
  // recommendSimilar seeds state.terms from prior-run shortlist memory.
  // 'seeded' routes to the book-search-scatter sub-DAG — third placement of
  // the same packaged cluster. 'empty' routes to the compose-empty terminal.
  .node('recommend-similar', recommendSimilar, {
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

  // ── compose-loop — shared compose/validate sub-DAG ──────────────────────────
  // All branches that successfully find candidates converge here.
  // composeResponse → validateResponse (retry loop, bounded by the retry budget on state (retriesFor('compose'))).
  // One sub-DAG definition serves all four convergent branches.
  // stateMapping.outputs copies the compose loop's writes back to the parent.
  //
  // Convergence policy: 'success' routes to the shared respond-to-visitor terminal
  // at the parent level — the sub-DAG produces state.draft and exits cleanly;
  // exactly ONE respond-to-visitor fires per run regardless of branch count.
  // 'error' (retry budget exhausted) falls through to compose-empty so the
  // visitor always receives an in-character response rather than a silent drop.
  .embeddedDAG('compose-loop', 'compose-retry-loop', {
    'success': 'respond-to-visitor',
    'error':   'compose-empty',
  }, {
    'outputs': {
      'draft':    'draft',
      'approved': 'approved',
      'attempts': 'attempts',
    },
  })
  // #endregion embedded-dag-placements

  // ── respond-to-visitor — single shared happy-path terminal ───────────────
  // Every branch that successfully composes a response converges here.
  // compose-loop (success) and both memory + empty-result paths all route
  // through this one placement — convergence policy: exactly ONE respond-to-visitor
  // fires per run with the full converged state.draft in context.
  .node('respond-to-visitor', respondToVisitor, { 'success': null })

  // ── recall-memories branch ───────────────────────────────────────────────
  // No search needed — the memory store is queried directly.
  // recallMemories → composeMemoryResponse → respond-to-visitor (shared terminal).
  .node('memory-recall',          recallMemories,       { 'recalled': 'compose-memory-recall' })
  .node('compose-memory-recall',  composeMemoryResponse, {
    'drafted': 'respond-to-visitor',
    'retry':   'compose-memory-recall',
    'salvage': 'compose-memory-salvage',
  })
  .node('compose-memory-salvage', composeMemoryResponseSalvage, { 'done': 'respond-to-visitor' })

  // #region terminal-placements
  // ── Terminal nodes ───────────────────────────────────────────────────────
  .node('decline-off-topic', declineOffTopic, { 'success': null })
  .node('compose-empty',     composeEmptyResponse,  {
    'drafted': 'respond-to-visitor',
    'retry':   'compose-empty',
    'salvage': 'compose-empty-salvage',
  })
  .node('compose-empty-salvage', composeEmptyResponseSalvage, { 'done': 'respond-to-visitor' })
  // #endregion terminal-placements

  .build();

/**
 * Bundle of the parent-level nodes plus the `the-archivist` DAG itself.
 * Register AFTER the embedded-DAG bundles so the validator can resolve the
 * embedded-DAG references the parent placements make by name.
 */
export const archivistBundle: DispatcherBundle<ArchivistState, ArchivistServices> = {
  'nodes': [
    recallContext, classifyIntent, extractQuery, decideTools,
    openLibraryScout, googleBooksScout, subjectScout, wikipediaScout,
    rankByRating, pickBestMatch, mergeCandidates, recordFindings,
    hasCitationsGate, groupByYear, recallPastVisits, recommendSimilar,
    recallMemories, composeMemoryResponse, respondToVisitor,
    declineOffTopic, composeEmptyResponse,
    classifyIntentSalvage, extractQuerySalvage, decideToolsSalvage,
    composeMemoryResponseSalvage, composeEmptyResponseSalvage,
  ],
  'dags': [archivistDAG],
};
