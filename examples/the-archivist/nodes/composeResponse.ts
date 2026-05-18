/**
 * composeResponse + validateResponse — the LLM compose/validate loop.
 *
 * `composeResponse` produces a prose answer from the shortlist.
 * `validateResponse` runs a soft quality check (length, citations,
 * tone). On failure the dispatcher routes back through compose up to
 * `MAX_COMPOSE_ATTEMPTS` — a deliberate retry loop modeled in the DAG
 * itself rather than inside a single node.
 *
 * RetryPolicy on composeResponse: the underlying LLM call may fail with
 * a transient network or rate-limit error before returning a draft at all.
 * The policy retries up to 2 extra attempts (maxAttempts=2, so 2 total
 * tries) with exponential backoff so one flaky call does not surface as a
 * DAG-level failure. This is distinct from the DAG-level compose→validate
 * →retry loop, which handles schema-violation or low-quality drafts after
 * a successful LLM completion.
 *
 * Demonstrates: the parameterised `services` context, state-mutation
 * gating (`state.approved`), and a routing decision that re-enters an
 * earlier node (loop) bounded by a counter on state.
 */


import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

import type { NodeInterface } from '@noocodex/dagonizer';
import { BackoffStrategy, RetryPolicy } from '@noocodex/dagonizer/runtime';

/**
 * RetryPolicy for transient LLM call failures inside composeResponse.
 * Retries the compose call up to 2 times before propagating the error.
 */
const composeRetry = new RetryPolicy({
  "maxAttempts": 2,
  "strategy":    BackoffStrategy.EXPONENTIAL,
  "baseDelay":   500,
});

const MAX_COMPOSE_ATTEMPTS = 3;

/** Default wall-clock budget for the compose phase (ms). Overridden at runtime by the runner. */
export const COMPOSE_TIMEOUT_MS = 60_000;

export const composeResponse: NodeInterface<ArchivistState, 'drafted', ArchivistServices> = {
  "name": 'compose-response',
  "outputs": ['drafted'],
  "timeoutMs": COMPOSE_TIMEOUT_MS,
  async execute(state, context) {
    state.attempts['compose'] = (state.attempts['compose'] ?? 0) + 1;
    const llm = context.services.llm;
    const prior = state.priorContext.length > 0 ? state.priorContext : undefined;
    const recalledSummary = state.recalledContext.summary.length > 0
      ? state.recalledContext.summary
      : undefined;
    // Each per-intent branch keeps the same `compose-response` node
    // (the retry loop and validate-response wiring stays one
    // implementation), and dispatches to the intent-flavoured prompt
    // builder so the LLM gets the right directives + framing.
    const composeCall = (): Promise<string> => {
      switch (state.intent) {
        case 'lookup-author':     return llm.composeAuthor(state.query, state.shortlist, prior, recalledSummary);
        case 'find-reviews':      return llm.composeReviews(state.query, state.shortlist, prior, recalledSummary);
        case 'describe-book':     return llm.describeBook(state.query, state.shortlist, prior, recalledSummary);
        case 'recommend-similar': return llm.composeSimilar(state.query, state.shortlist, prior, recalledSummary);
        default:                  return llm.compose(state.query, state.shortlist, prior, recalledSummary);
      }
    };
    state.draft = await composeRetry.run(composeCall, context.signal);
    if (state.priorContext.length > 0) {
      context.services.logger.info(`compose: ${String(state.priorContext.length)} prior facts in context`);
    }
    return { "output": 'drafted' };
  },
};

export const validateResponse: NodeInterface<
  ArchivistState,
  'approved' | 'retry' | 'exhausted',
  ArchivistServices
> = {
  "name": 'validate-response',
  "outputs": ['approved', 'retry', 'exhausted'],
  async execute(state, context) {
    const ok = await context.services.llm.validate(state.draft, state.shortlist);
    state.approved = ok;
    if (ok) return { "output": 'approved' };
    if ((state.attempts['compose'] ?? 0) >= MAX_COMPOSE_ATTEMPTS) {
      context.services.logger.warn('compose attempts exhausted');
      return { "output": 'exhausted' };
    }
    return { "output": 'retry' };
  },
};
