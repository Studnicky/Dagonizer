/**
 * The Archivist — canonical DAG, built with DAGBuilder.
 *
 *   classify-intent
 *     │
 *     ├─ off-topic ─────────────────────────────────► decline-off-topic ► END
 *     │
 *     ├─ on-topic (search | describe | recommend) ► extract-query
 *     │      │
 *     │      ▼ ... decide-tools
 *     │          → web-search-fan-out [web-ol | web-gb | web-wiki]
 *     │          → rank → merge → record
 *     │          → has-citations-gate → recall-past-visits → compose-response
 *     │          → validate-response → respond-to-visitor / loop
 *     │
 *     ├─ lookup-author ► author-extract → author-decide-tools
 *     │      → author-fan-out [author-ol | author-gb | author-wiki]
 *     │      → author-rank → author-merge
 *     │      → author-record → author-gate → group-by-year
 *     │      → author-recall → compose-response → validate ...
 *     │
 *     ├─ find-reviews ► reviews-extract → reviews-decide-tools
 *     │      → reviews-fan-out [reviews-ol | reviews-gb | reviews-wiki]
 *     │      → reviews-rank → reviews-merge
 *     │      → reviews-record → reviews-gate → reviews-recall
 *     │      → compose-response → validate ...
 *     │
 *     ├─ describe-book ► describe-extract → describe-decide-tools
 *     │      → describe-fan-out [describe-ol | describe-gb | describe-wiki]
 *     │      → describe-pick → describe-merge → describe-record
 *     │      → describe-gate → describe-recall → compose-response
 *     │      → validate ...
 *     │
 *     └─ recommend-similar ► recommend-similar
 *            │
 *            ├─ empty  ─────────────────────────────► decline-empty ► END
 *            └─ seeded ► similar-decide-tools
 *                   → similar-fan-out [similar-ol | similar-gb | similar-wiki]
 *                   → similar-rank
 *                   → similar-merge → similar-record → similar-gate
 *                   → similar-recall → compose-response → validate ...
 *
 * Multi-source fan-out: every per-intent branch fans out to three scouts
 * (OpenLibrary, Google Books, Wikipedia) in parallel under a `combine:
 * 'collect'` placement. All three scouts write to `state.candidates`;
 * `mergeCandidates` dedupes via `CanonicalId.dedupe` before the top-K cut.
 * The cytoscape renderer draws each parallel placement as a compound cluster
 * containing its three child scout nodes.
 *
 * Every branch funnels back through one shared `compose-response` /
 * `validate-response` / `respond-to-visitor` terminal so the retry
 * loop, validation gate, and conversation append stay one
 * implementation. The per-branch placements reuse the registered node
 * implementations under different placement names so cytoscape can
 * draw the branches as distinct lanes.
 *
 * Builder vs literal equivalence:
 *   DAGBuilder.node(placementName, nodeImpl, routes) emits the same
 *   { type: 'single', name, node: nodeImpl.name, outputs: routes }
 *   object that the hand-written literal used. build() returns a plain
 *   DAG — identical wire shape, same Dagonizer.load() call.
 */


import { classifyIntent }    from './nodes/classifyIntent.ts';
import { composeResponse, validateResponse } from './nodes/composeResponse.ts';
import { decideTools }       from './nodes/decideTools.ts';
import { extractQuery }      from './nodes/extractQuery.ts';
import { groupByYear }       from './nodes/groupByYear.ts';
import { hasCitationsGate }  from './nodes/hasCitationsGate.ts';
import { mergeCandidates }   from './nodes/mergeCandidates.ts';
import { pickBestMatch }     from './nodes/pickBestMatch.ts';
import { rankByRating }      from './nodes/rankByRating.ts';
import { rankCandidates }    from './nodes/rankCandidates.ts';
import { recallContext }     from './nodes/recallContext.ts';
import { recallPastVisits }  from './nodes/recallPastVisits.ts';
import { recommendSimilar }  from './nodes/recommendSimilar.ts';
import { recordFindings }    from './nodes/recordFindings.ts';
import { respondToVisitor, declineOffTopic, declineEmpty } from './nodes/respondToVisitor.ts';
import { openLibraryScout, googleBooksScout, subjectScout, wikipediaScout } from './nodes/scouts.ts';

import { DAGBuilder } from '@noocodex/dagonizer/builder';

export const archivistDAG = new DAGBuilder('the-archivist', '4.1')

  // ── 0. recall-context ────────────────────────────────────────────────────
  // First added → auto-entrypoint. Runs before classifyIntent so the
  // classifier can benefit from prior-session continuity hints.
  .node('recall-context', recallContext, {
    'recalled': 'classify-intent',
  })

  // ── 1. classify-intent ───────────────────────────────────────────────────
  // Wide output union routes to five branches.
  // Literal: { type:'single', name:'classify-intent', node:'classify-intent', outputs:{...} }
  .node('classify-intent', classifyIntent, {
    'lookup-author':     'author-extract',
    'find-reviews':      'reviews-extract',
    'describe-book':     'describe-extract',
    'recommend-similar': 'recommend-similar',
    'on-topic':          'extract-query',
    'off-topic':         'decline-off-topic',
  })

  // ── Legacy on-topic pipeline (search | describe | recommend) ─────────────

  // ── 2. extract-query ─────────────────────────────────────────────────────
  // Placement name = node name. LLM parses raw question into search terms.
  .node('extract-query', extractQuery, {
    'success': 'decide-tools',
  })

  // ── 3. decide-tools ──────────────────────────────────────────────────────
  // Both outputs route to the fan-out — each scout gates internally on
  // state.toolPlan; wikipedia runs on terms regardless of toolPlan.
  .node('decide-tools', decideTools, {
    'tools':    'web-search-fan-out',
    'no-tools': 'web-search-fan-out',
  })

  // ── 4. web-search-fan-out ────────────────────────────────────────────────
  // Parallel placement: all four scouts run concurrently. combine:'collect'
  // waits for all four and merges their state mutations. Each child node
  // writes to state.candidates; mergeCandidates dedupes via CanonicalId.
  // Cytoscape renders this as a compound cluster containing web-ol/gb/subject/wiki.
  .parallel('web-search-fan-out', ['web-ol', 'web-gb', 'web-subject', 'web-wiki'], 'collect', {
    'success': 'rank-candidates',
    'error':   'rank-candidates',
  })
  .node('web-ol',      openLibraryScout, { 'success': null, 'empty': null })
  .node('web-gb',      googleBooksScout, { 'success': null, 'empty': null })
  .node('web-subject', subjectScout,     { 'success': null, 'empty': null })
  .node('web-wiki',    wikipediaScout,   { 'success': null, 'empty': null })

  // ── 5. rank-candidates ───────────────────────────────────────────────────
  // Always routes 'ranked' — even an empty set — so merge can soft-gate.
  .node('rank-candidates', rankCandidates, {
    'ranked': 'merge-candidates',
  })

  // ── 6. merge-candidates ──────────────────────────────────────────────────
  // Cross-source dedupe via CanonicalId, top-5. Routes 'empty' when shortlist
  // is zero-length.
  .node('merge-candidates', mergeCandidates, {
    'ranked': 'record-findings',
    'empty':  'decline-empty',
  })

  // ── 7. record-findings ───────────────────────────────────────────────────
  // Deterministic RDF write — same input always produces the same triples.
  .node('record-findings', recordFindings, {
    'recorded': 'has-citations-gate',
  })

  // ── 8. has-citations-gate ────────────────────────────────────────────────
  // SPARQL ASK over the per-run state graph. Symbolic fence for the LLM.
  .node('has-citations-gate', hasCitationsGate, {
    'pass': 'recall-past-visits',
    'fail': 'decline-empty',
  })

  // ── 9. recall-past-visits ────────────────────────────────────────────────
  // Injects prior-session context (prior queries + shortlisted titles).
  .node('recall-past-visits', recallPastVisits, {
    'recalled': 'compose-response',
  })

  // ── lookup-author branch ─────────────────────────────────────────────────
  // Reuses existing node implementations under branch-prefixed placement names.
  // Demonstrates: DAGBuilder.node(differentPlacementName, sameNodeImpl, routes).

  .node('author-extract', extractQuery, {
    'success': 'author-decide-tools',
  })
  .node('author-decide-tools', decideTools, {
    'tools':    'author-fan-out',
    'no-tools': 'author-fan-out',
  })
  .parallel('author-fan-out', ['author-ol', 'author-gb', 'author-subject', 'author-wiki'], 'collect', {
    'success': 'author-rank',
    'error':   'author-rank',
  })
  .node('author-ol',      openLibraryScout, { 'success': null, 'empty': null })
  .node('author-gb',      googleBooksScout, { 'success': null, 'empty': null })
  .node('author-subject', subjectScout,     { 'success': null, 'empty': null })
  .node('author-wiki',    wikipediaScout,   { 'success': null, 'empty': null })
  .node('author-rank', rankCandidates, {
    'ranked': 'author-merge',
  })
  .node('author-merge', mergeCandidates, {
    'ranked': 'author-record',
    'empty':  'decline-empty',
  })
  .node('author-record', recordFindings, {
    'recorded': 'author-gate',
  })
  .node('author-gate', hasCitationsGate, {
    'pass': 'group-by-year',
    'fail': 'decline-empty',
  })
  // groupByYear is branch-specific: sorts chronologically for author surveys.
  .node('group-by-year', groupByYear, {
    'ordered': 'author-recall',
  })
  .node('author-recall', recallPastVisits, {
    'recalled': 'compose-response',
  })

  // ── find-reviews branch ──────────────────────────────────────────────────

  .node('reviews-extract', extractQuery, {
    'success': 'reviews-decide-tools',
  })
  .node('reviews-decide-tools', decideTools, {
    'tools':    'reviews-fan-out',
    'no-tools': 'reviews-fan-out',
  })
  // reviews-fan-out: parallel fetch from all four sources.
  // reviews-rank uses deterministic rating-weighted ranking; google-books scout
  // carries notes.rating / notes.ratingsCount from the source.
  .parallel('reviews-fan-out', ['reviews-ol', 'reviews-gb', 'reviews-subject', 'reviews-wiki'], 'collect', {
    'success': 'reviews-rank',
    'error':   'reviews-rank',
  })
  .node('reviews-ol',      openLibraryScout, { 'success': null, 'empty': null })
  .node('reviews-gb',      googleBooksScout, { 'success': null, 'empty': null })
  .node('reviews-subject', subjectScout,     { 'success': null, 'empty': null })
  .node('reviews-wiki',    wikipediaScout,   { 'success': null, 'empty': null })
  // reviews-rank uses deterministic rating-weighted ranking instead of LLM ranking.
  .node('reviews-rank', rankByRating, {
    'ranked': 'reviews-merge',
  })
  .node('reviews-merge', mergeCandidates, {
    'ranked': 'reviews-record',
    'empty':  'decline-empty',
  })
  .node('reviews-record', recordFindings, {
    'recorded': 'reviews-gate',
  })
  .node('reviews-gate', hasCitationsGate, {
    'pass': 'reviews-recall',
    'fail': 'decline-empty',
  })
  .node('reviews-recall', recallPastVisits, {
    'recalled': 'compose-response',
  })

  // ── describe-book branch (one-hit, skip ranking) ─────────────────────────

  .node('describe-extract', extractQuery, {
    'success': 'describe-decide-tools',
  })
  .node('describe-decide-tools', decideTools, {
    'tools':    'describe-fan-out',
    'no-tools': 'describe-fan-out',
  })
  .parallel('describe-fan-out', ['describe-ol', 'describe-gb', 'describe-subject', 'describe-wiki'], 'collect', {
    'success': 'describe-pick',
    'error':   'decline-empty',
  })
  .node('describe-ol',      openLibraryScout, { 'success': null, 'empty': null })
  .node('describe-gb',      googleBooksScout, { 'success': null, 'empty': null })
  .node('describe-subject', subjectScout,     { 'success': null, 'empty': null })
  .node('describe-wiki',    wikipediaScout,   { 'success': null, 'empty': null })
  // describe-pick narrows multi-hit results to the top-3 title-similar candidates
  // before merge so the composer receives the right book, not the first 5 arbitrary hits.
  .node('describe-pick', pickBestMatch, {
    'picked': 'describe-merge',
  })
  .node('describe-merge', mergeCandidates, {
    'ranked': 'describe-record',
    'empty':  'decline-empty',
  })
  .node('describe-record', recordFindings, {
    'recorded': 'describe-gate',
  })
  .node('describe-gate', hasCitationsGate, {
    'pass': 'describe-recall',
    'fail': 'decline-empty',
  })
  .node('describe-recall', recallPastVisits, {
    'recalled': 'compose-response',
  })

  // ── recommend-similar branch ─────────────────────────────────────────────
  // recommendSimilar seeds state.terms from prior-run shortlist memory.

  .node('recommend-similar', recommendSimilar, {
    'seeded': 'similar-decide-tools',
    'empty':  'decline-empty',
  })
  .node('similar-decide-tools', decideTools, {
    'tools':    'similar-fan-out',
    'no-tools': 'similar-fan-out',
  })
  .parallel('similar-fan-out', ['similar-ol', 'similar-gb', 'similar-subject', 'similar-wiki'], 'collect', {
    'success': 'similar-rank',
    'error':   'similar-rank',
  })
  .node('similar-ol',      openLibraryScout, { 'success': null, 'empty': null })
  .node('similar-gb',      googleBooksScout, { 'success': null, 'empty': null })
  .node('similar-subject', subjectScout,     { 'success': null, 'empty': null })
  .node('similar-wiki',    wikipediaScout,   { 'success': null, 'empty': null })
  .node('similar-rank', rankCandidates, {
    'ranked': 'similar-merge',
  })
  .node('similar-merge', mergeCandidates, {
    'ranked': 'similar-record',
    'empty':  'decline-empty',
  })
  .node('similar-record', recordFindings, {
    'recorded': 'similar-gate',
  })
  .node('similar-gate', hasCitationsGate, {
    'pass': 'similar-recall',
    'fail': 'decline-empty',
  })
  .node('similar-recall', recallPastVisits, {
    'recalled': 'compose-response',
  })

  // ── Shared compose / validate / terminal nodes ────────────────────────────
  // All five branches converge here. The retry loop (validate→compose→validate)
  // is modeled in the DAG so the dispatcher's abort and checkpoint machinery
  // applies to every iteration — not just the first LLM call.

  // ── compose-response ────────────────────────────────────────────────────
  // Wrapped with RetryPolicy inside the node for transient LLM failures.
  .node('compose-response', composeResponse, {
    'drafted': 'validate-response',
  })

  // ── validate-response ────────────────────────────────────────────────────
  // On 'retry', routes back to compose-response (bounded by MAX_COMPOSE_ATTEMPTS
  // tracked on state). 'exhausted' is the best-effort exit after the limit.
  .node('validate-response', validateResponse, {
    'approved':  'respond-to-visitor',
    'retry':     'compose-response',
    'exhausted': 'respond-to-visitor',
  })

  // ── Terminal nodes ───────────────────────────────────────────────────────
  .node('respond-to-visitor',  respondToVisitor,  { 'success': null })
  .node('decline-off-topic',   declineOffTopic,   { 'success': null })
  .node('decline-empty',       declineEmpty,       { 'success': null })

  .build();
