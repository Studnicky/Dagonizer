/**
 * rankCandidates — non-deterministic ranking node.
 *
 * Hands every candidate the scout returned to the LLM with the
 * visitor's question and asks for a 0..1 relevance score per
 * candidate. The LLM is the only ranker in this DAG — there is no
 * hand-crafted score floor, no "local catalog wins" bias. Output:
 * `state.candidates` re-emitted with LLM-assigned scores, sorted
 * descending. mergeCandidates then takes the top-K as `state.shortlist`.
 *
 * Output route is always 'ranked' — even an empty rank set routes
 * forward so merge can soft-gate on its own.
 *
 * RetryPolicy: schema-violation responses from the LLM (malformed JSON,
 * missing score fields) cause rankCandidates to throw. The policy retries
 * up to 2 times with exponential backoff before falling through to the
 * existing catch block that marks the error as recoverable and routes on.
 */

import type { Candidate } from '../entities/Book.ts';

import type { ArchivistNode } from './ArchivistNode.ts';

import { BackoffStrategy, RetryPolicy } from '@noocodex/dagonizer/runtime';

/**
 * RetryPolicy for transient LLM ranking failures.
 * Schema-violation or network errors are retried up to 2 times before
 * the catch block logs and routes forward with unscored candidates.
 */
const rankRetry = new RetryPolicy({
  "maxAttempts": 2,
  "strategy":    BackoffStrategy.EXPONENTIAL,
  "baseDelay":   400,
});

/** Default wall-clock budget for the rank phase (ms). Overridden at runtime by the runner. */
export const RANK_TIMEOUT_MS = 15_000;

export const rankCandidates: ArchivistNode<'ranked'> = {
  'name':    'rank-candidates',
  'kind':    'non-deterministic',
  'outputs': ['ranked'],
  'timeoutMs': RANK_TIMEOUT_MS,
  async execute(state, context) {
    if (state.candidates.length === 0) {
      context.services.logger.info('rank-candidates: no candidates to rank');
      return { 'output': 'ranked' };
    }
    try {
      const scored = await rankRetry.run(
        () => context.services.llm.rankCandidates(state.query, state.candidates),
        context.signal,
      );
      // Sort descending by score; re-emit as Candidate[] preserving
      // the LLM's reason + additionalProperties notes on each candidate.
      const ranked: Candidate[] = [...scored]
        .sort((a, b) => b.score - a.score)
        .map((entry) => ({
          ...entry.candidate,
          'score': entry.score,
          ...(entry.reason !== undefined ? { 'reason': entry.reason } : {}),
          ...(entry.notes  !== undefined ? { 'notes':  entry.notes  } : {}),
        }));
      state.candidates = ranked;
      const top = ranked[0];
      context.services.logger.info(
        `rank-candidates: ${String(ranked.length)} ranked${top !== undefined
          ? ` (top ${String(top.score)}: "${top.book.title}"${top.reason !== undefined ? ` — ${top.reason}` : ''})`
          : ''}`,
      );
    } catch (err) {
      // Ranking is best-effort. If the LLM cannot rank, leave the
      // candidates unscored (score:0) and let merge soft-gate.
      state.collectError({
        'code':        'RANK_FAILED',
        'message':     err instanceof Error ? err.message : String(err),
        'operation':   'rank-candidates',
        'recoverable': true,
        'timestamp':   new Date().toISOString(),
      });
      context.services.logger.warn(`rank-candidates failed: ${String(err)}`);
    }
    return { 'output': 'ranked' };
  },
};
