/**
 * The Archivist — canonical DAG, built with DAGBuilder. Version 5.0.
 *
 * Molecular composition: the parent DAG is composed of two reusable
 * sub-DAGs that ship as independent components and are imported as
 * `.subDAG(...)` placements. The sub-DAGs are registered separately
 * and referenced by name — the parent DAG never knows their internals.
 *
 *   recall-context
 *     └─ recalled ──► classify-intent
 *
 *   classify-intent
 *     ├─ off-topic         ──► decline-off-topic ──► END
 *     │
 *     ├─ on-topic          ──► [book-search-fanout] (extract+decide+4scouts+rank+merge+record+gate+recall)
 *     │                             ├─ success ──► [compose-retry-loop] (compose+validate+retry+respond)
 *     │                             └─ error   ──► decline-empty ──► END
 *     │
 *     ├─ lookup-author     ──► [book-search-fanout]
 *     │                             ├─ success ──► group-by-year ──► [compose-retry-loop]
 *     │                             └─ error   ──► decline-empty ──► END
 *     │
 *     ├─ find-reviews      ──► reviews-extract ──► (inline: decide+4scouts+rankByRating+merge+record+gate+recall)
 *     │                             └─ [compose-retry-loop]
 *     │
 *     ├─ describe-book     ──► describe-extract ──► (inline: decide+4scouts+pickBestMatch+merge+record+gate+recall)
 *     │                             └─ [compose-retry-loop]
 *     │
 *     └─ recommend-similar ──► recommend-similar-gate
 *                               ├─ seeded ──► [book-search-fanout]
 *                               │                ├─ success ──► [compose-retry-loop]
 *                               │                └─ error   ──► decline-empty ──► END
 *                               └─ empty  ──► decline-empty ──► END
 *
 * Sub-DAGs (molecular components):
 *   book-search-fanout  — extract-query + decide-tools + 4-source parallel scouts
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
 *   book-search-fanout except for the post-scout ranking step — keeping them inline
 *   makes the intentional distinction explicit rather than hiding it behind a
 *   sub-DAG parameter.
 *
 * Builder vs literal equivalence:
 *   DAGBuilder.node(placementName, nodeImpl, routes) emits the same
 *   { type: 'single', name, node: nodeImpl.name, outputs: routes }
 *   object that the hand-written literal used. build() returns a plain
 *   DAG — identical wire shape, same Dagonizer.load() call.
 */


import { classifyIntent }   from './nodes/classifyIntent.ts';
import { decideTools }      from './nodes/decideTools.ts';
import { extractQuery }     from './nodes/extractQuery.ts';
import { groupByYear }      from './nodes/groupByYear.ts';
import { hasCitationsGate } from './nodes/hasCitationsGate.ts';
import { mergeCandidates }  from './nodes/mergeCandidates.ts';
import { pickBestMatch }    from './nodes/pickBestMatch.ts';
import { rankByRating }     from './nodes/rankByRating.ts';
import { recallContext }    from './nodes/recallContext.ts';
import { recallPastVisits } from './nodes/recallPastVisits.ts';
import { recommendSimilar } from './nodes/recommendSimilar.ts';
import { recordFindings }   from './nodes/recordFindings.ts';
import { declineOffTopic, declineEmpty } from './nodes/respondToVisitor.ts';
import { openLibraryScout, googleBooksScout, subjectScout, wikipediaScout } from './nodes/scouts.ts';

import { DAGBuilder } from '@noocodex/dagonizer/builder';

export const archivistDAG = new DAGBuilder('the-archivist', '5.0')

  // ── 0. recall-context ────────────────────────────────────────────────────
  // First added → auto-entrypoint. Runs before classifyIntent so the
  // classifier can benefit from prior-session continuity hints.
  .node('recall-context', recallContext, {
    'recalled': 'classify-intent',
  })

  // ── 1. classify-intent ───────────────────────────────────────────────────
  // Wide output union routes to five branches. Sub-DAG placements and inline
  // branches share the same shared terminal: compose-loop and decline-empty.
  .node('classify-intent', classifyIntent, {
    'lookup-author':     'author-search',
    'find-reviews':      'reviews-extract',
    'describe-book':     'describe-extract',
    'recommend-similar': 'recommend-similar',
    'on-topic':          'on-topic-search',
    'off-topic':         'decline-off-topic',
  })

  // ── on-topic branch ──────────────────────────────────────────────────────
  // Sub-DAG placement: book-search-fanout handles extract-query, decide-tools,
  // all four scouts, rank-candidates, merge, record, gate, and recall.
  // One packaged cluster — first of three placements of the same sub-DAG.
  // stateMapping.output copies the fields the sub-DAG writes back to the
  // parent state so compose-loop and group-by-year can read them.
  .subDAG('on-topic-search', 'book-search-fanout', {
    'success': 'compose-loop',
    'error':   'decline-empty',
  }, {
    'stateMapping': {
      'output': {
        'terms':       'terms',
        'toolPlan':    'toolPlan',
        'candidates':  'candidates',
        'shortlist':   'shortlist',
        'priorContext':'priorContext',
      },
    },
  })

  // ── lookup-author branch ─────────────────────────────────────────────────
  // Sub-DAG placement: same book-search-fanout cluster, second placement.
  // After success, group-by-year sorts results chronologically before the
  // compose loop — author surveys read better in publication-timeline order.
  .subDAG('author-search', 'book-search-fanout', {
    'success': 'group-by-year',
    'error':   'decline-empty',
  }, {
    'stateMapping': {
      'output': {
        'terms':       'terms',
        'toolPlan':    'toolPlan',
        'candidates':  'candidates',
        'shortlist':   'shortlist',
        'priorContext':'priorContext',
      },
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
  })
  .node('reviews-decide-tools', decideTools, {
    'tools':    'reviews-fan-out',
    'no-tools': 'reviews-fan-out',
  })
  .parallel('reviews-fan-out', ['reviews-ol', 'reviews-gb', 'reviews-subject', 'reviews-wiki'], 'collect', {
    'success': 'reviews-rank',
    'error':   'reviews-rank',
  })
  .node('reviews-ol',      openLibraryScout, { 'success': null, 'empty': null })
  .node('reviews-gb',      googleBooksScout, { 'success': null, 'empty': null })
  .node('reviews-subject', subjectScout,     { 'success': null, 'empty': null })
  .node('reviews-wiki',    wikipediaScout,   { 'success': null, 'empty': null })
  .node('reviews-rank',    rankByRating,     { 'ranked': 'reviews-merge' })
  .node('reviews-merge',   mergeCandidates,  { 'ranked': 'reviews-record', 'empty': 'decline-empty' })
  .node('reviews-record',  recordFindings,   { 'recorded': 'reviews-gate' })
  .node('reviews-gate',    hasCitationsGate, { 'pass': 'reviews-recall', 'fail': 'decline-empty' })
  .node('reviews-recall',  recallPastVisits, { 'recalled': 'compose-loop' })

  // ── describe-book branch ─────────────────────────────────────────────────
  // Inlined — uses pickBestMatch to narrow multi-hit results to the top-3
  // title-similar candidates before merge. Ensures the composer receives the
  // specific book the visitor named, not arbitrary top-5 hits.
  .node('describe-extract',      extractQuery,     { 'success': 'describe-decide-tools' })
  .node('describe-decide-tools', decideTools,      { 'tools': 'describe-fan-out', 'no-tools': 'describe-fan-out' })
  .parallel('describe-fan-out', ['describe-ol', 'describe-gb', 'describe-subject', 'describe-wiki'], 'collect', {
    'success': 'describe-pick',
    'error':   'decline-empty',
  })
  .node('describe-ol',      openLibraryScout, { 'success': null, 'empty': null })
  .node('describe-gb',      googleBooksScout, { 'success': null, 'empty': null })
  .node('describe-subject', subjectScout,     { 'success': null, 'empty': null })
  .node('describe-wiki',    wikipediaScout,   { 'success': null, 'empty': null })
  .node('describe-pick',   pickBestMatch,    { 'picked': 'describe-merge' })
  .node('describe-merge',  mergeCandidates,  { 'ranked': 'describe-record', 'empty': 'decline-empty' })
  .node('describe-record', recordFindings,   { 'recorded': 'describe-gate' })
  .node('describe-gate',   hasCitationsGate, { 'pass': 'describe-recall', 'fail': 'decline-empty' })
  .node('describe-recall', recallPastVisits, { 'recalled': 'compose-loop' })

  // ── recommend-similar branch ─────────────────────────────────────────────
  // recommendSimilar seeds state.terms from prior-run shortlist memory.
  // 'seeded' routes to the book-search-fanout sub-DAG — third placement of
  // the same packaged cluster. 'empty' routes to the decline terminal.
  .node('recommend-similar', recommendSimilar, {
    'seeded': 'similar-search',
    'empty':  'decline-empty',
  })

  // Sub-DAG placement: same book-search-fanout, third and final placement.
  .subDAG('similar-search', 'book-search-fanout', {
    'success': 'compose-loop',
    'error':   'decline-empty',
  }, {
    'stateMapping': {
      'output': {
        'terms':       'terms',
        'toolPlan':    'toolPlan',
        'candidates':  'candidates',
        'shortlist':   'shortlist',
        'priorContext':'priorContext',
      },
    },
  })

  // ── compose-loop — shared compose/validate/respond sub-DAG ───────────────
  // All branches that successfully find candidates converge here.
  // composeResponse → validateResponse (retry loop, bounded by state.attempts.compose)
  // → respondToVisitor. One sub-DAG definition serves all four convergent branches.
  // stateMapping.output copies the compose loop's writes back to the parent.
  .subDAG('compose-loop', 'compose-retry-loop', {
    'success': null,
    'error':   null,
  }, {
    'stateMapping': {
      'output': {
        'draft':    'draft',
        'approved': 'approved',
        'attempts': 'attempts',
      },
    },
  })

  // ── Terminal nodes ───────────────────────────────────────────────────────
  .node('decline-off-topic', declineOffTopic, { 'success': null })
  .node('decline-empty',     declineEmpty,     { 'success': null })

  .build();
