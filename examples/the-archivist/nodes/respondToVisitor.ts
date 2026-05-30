/**
 * respondToVisitor / declineOffTopic / composeEmptyResponse
 * — terminal and near-terminal nodes.
 *
 * respondToVisitor    — shared happy-path terminal (routes to null after compose).
 * declineOffTopic     — hard off-topic gate; sets a redirect draft and exits.
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

/** Per-node compose deadline + total attempts before salvage. */
const EMPTY_TIMEOUT_MS = 60_000;
const EMPTY_RETRY_BUDGET = 2;

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
 * LLM-driven empty-result response node.
 *
 * Invoked when all scouts returned empty and merge produced no shortlist.
 * Uses `state.failureCause` (accumulated by scouts and gate nodes) to build
 * a prompt that asks the LLM for a warm in-character message acknowledging
 * what was searched, why it came up empty, and one concrete next step.
 *
 * Failure is a flow decision: the node arms its own deadline and, on its own
 * timeout or an LLM error, routes `retry` (loops back, bounded) or `salvage`.
 * The canned fallback message lives in `compose-empty-salvage`, reached by the
 * salvage edge — not in this node's catch. No in-node `RetryPolicy`, no engine
 * `timeoutMs` crutch.
 */
export const composeEmptyResponse: NodeInterface<ArchivistState, 'drafted' | 'retry' | 'salvage', ArchivistServices> = {
  "name":      'compose-empty',
  "outputs":   ['drafted', 'retry', 'salvage'],
  async execute(state, context) {
    state.collectWarning({
      "code":      'EMPTY_SHORTLIST',
      "message":   'no candidates after merge — composing empty response',
      "operation": 'compose-empty',
      "timestamp": new Date().toISOString(),
    });
    const conversation = state.conversation.length > 0 ? state.conversation : undefined;
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(new Error('node-timeout')), context.services.nodeTimeouts[context.nodeName] ?? EMPTY_TIMEOUT_MS);
    const signal = AbortSignal.any([context.signal, controller.signal]);
    try {
      state.draft = await context.services.llm.composeEmptyResponse(state.query, state.failureCause, conversation, signal);
      state.clearAttempts(context.nodeName);
      context.services.logger.info('compose-empty: LLM response composed');
      return { "output": 'drafted' };
    } catch (err) {
      if (context.signal.aborted) throw err;
      if (state.withinRetryBudget(context.nodeName, EMPTY_RETRY_BUDGET)) {
        context.services.logger.warn(`compose-empty: failed (attempt ${String(state.retriesFor(context.nodeName))}/${String(EMPTY_RETRY_BUDGET)}) — retry: ${err instanceof Error ? err.message : String(err)}`);
        return { "output": 'retry' };
      }
      state.clearAttempts(context.nodeName);
      context.services.logger.warn(`compose-empty: retries exhausted — salvage: ${err instanceof Error ? err.message : String(err)}`);
      return { "output": 'salvage' };
    } finally {
      clearTimeout(handle);
    }
  },
};
