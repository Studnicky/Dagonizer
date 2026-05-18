/**
 * respondToVisitor / declineOffTopic / declineEmpty / composeEmptyResponse
 * — terminal and near-terminal nodes.
 *
 * respondToVisitor    — shared happy-path terminal (routes to null after compose).
 * declineOffTopic     — hard off-topic gate; sets a redirect draft and exits.
 * declineEmpty        — legacy canned empty-result exit (kept for backward compat
 *                       with checkpoint resume on older saved states).
 * composeEmptyResponse — LLM-driven empty-result response. Uses `state.failureCause`
 *                       to produce an in-character acknowledgement of what was tried
 *                       and one concrete next-step suggestion. Always responds —
 *                       never throws, never silent-fails. Routes to respond-to-visitor
 *                       so the conversation always gets an answer.
 *
 * Demonstrates: terminal nodes (output routes to `null`) and the
 * `state.collectWarning` accumulator for soft signals.
 */


import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

import type { NodeInterface } from '@noocodex/dagonizer';
import { BackoffStrategy, RetryPolicy } from '@noocodex/dagonizer/runtime';

const emptyRetry = new RetryPolicy({
  "maxAttempts": 2,
  "strategy":    BackoffStrategy.EXPONENTIAL,
  "baseDelay":   500,
});

export const respondToVisitor: NodeInterface<ArchivistState, 'success', ArchivistServices> = {
  "name": 'respond-to-visitor',
  "outputs": ['success'],
  async execute(state, context) {
    context.services.logger.info(`responded with ${String(state.shortlist.length)} candidates`);
    return { "output": 'success' };
  },
};

export const declineOffTopic: NodeInterface<ArchivistState, 'success', ArchivistServices> = {
  "name": 'decline-off-topic',
  "outputs": ['success'],
  async execute(state) {
    state.draft = "I only help with finding and identifying books — what title or topic interests you?";
    return { "output": 'success' };
  },
};

/**
 * Legacy canned-response node. Kept for backward compatibility with
 * checkpoint resume on states that were saved before `composeEmptyResponse`
 * was introduced. New DAG routes use `compose-empty` instead.
 */
export const declineEmpty: NodeInterface<ArchivistState, 'success', ArchivistServices> = {
  "name": 'decline-empty',
  "outputs": ['success'],
  async execute(state) {
    state.draft = "I couldn't find anything matching that. Could you describe the cover, the era, or what the book is about?";
    state.collectWarning({
      "code": 'EMPTY_SHORTLIST',
      "message": 'no candidates after merge',
      "operation": 'decline-empty',
      "timestamp": new Date().toISOString(),
    });
    return { "output": 'success' };
  },
};

/**
 * LLM-driven empty-result response node.
 *
 * Invoked when all scouts returned empty and merge produced no shortlist.
 * Uses `state.failureCause` (accumulated by scouts and gate nodes) to build
 * a prompt that asks the LLM for a warm in-character message acknowledging
 * what was searched, why it came up empty, and one concrete next step.
 *
 * Always succeeds — on LLM error it falls back to a simple canned message
 * so the visitor always gets a response. Routes to `respond-to-visitor` so
 * the conversation always receives an answer.
 */
export const composeEmptyResponse: NodeInterface<ArchivistState, 'drafted', ArchivistServices> = {
  "name":      'compose-empty',
  "kind":      'non-deterministic',
  "outputs":   ['drafted'],
  "timeoutMs": 60_000,
  async execute(state, context) {
    state.collectWarning({
      "code":      'EMPTY_SHORTLIST',
      "message":   'no candidates after merge — composing empty response',
      "operation": 'compose-empty',
      "timestamp": new Date().toISOString(),
    });
    try {
      state.draft = await emptyRetry.run(
        () => context.services.llm.composeEmptyResponse(state.query, state.failureCause),
        context.signal,
      );
      context.services.logger.info('compose-empty: LLM response composed');
    } catch (err) {
      // Never silent-fail — fall back to a canned message.
      state.draft = "I searched OpenLibrary, Google Books, the subject index, and Wikipedia but nothing came back for that description. Try a single keyword — the author name alone, or one strong image from the book — and I will cast a wider net.";
      context.services.logger.warn(`compose-empty LLM failed, using fallback: ${String(err)}`);
    }
    return { "output": 'drafted' };
  },
};
