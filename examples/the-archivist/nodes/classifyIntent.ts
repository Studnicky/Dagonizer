/**
 * classifyIntent: entry node. Asks the LLM to classify the visitor's
 * question, then routes one of seven on-topic branches plus the
 * off-topic exit:
 *
 *   lookup-author      → `lookup-author-web-search` (chronological author survey)
 *   find-reviews       → `find-reviews`             (ratings tool branch)
 *   describe-book      → `describe-web-search`      (one-hit description branch)
 *   recommend-similar  → `recommend-similar`        (prior-shortlist seeding branch)
 *   search | describe | recommend → `extract-query` (legacy on-topic pipeline)
 *   off-topic          → `decline-off-topic`
 *
 * Demonstrates: a wide narrowly-typed output union and dispatch into
 * embedded-DAG branches based on classifier output.
 */


// #region node-class
import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

import type { NodeInterface } from '@noocodex/dagonizer';

type IntentOutput =
  | 'lookup-author'
  | 'find-reviews'
  | 'describe-book'
  | 'recommend-similar'
  | 'recall-memories'
  | 'on-topic'
  | 'off-topic'
  | 'retry'
  | 'salvage';

/** Per-node timeout: generous for Gemini Nano's constrained-output path (20-60 s typical). */
const NODE_TIMEOUT_MS = 30_000;

/** Total attempts (initial + retries) before routing to salvage. */
const RETRY_BUDGET = 2;

export const classifyIntent: NodeInterface<ArchivistState, IntentOutput, ArchivistServices> = {
  "name": 'classify-intent',
  "outputs": ['lookup-author', 'find-reviews', 'describe-book', 'recommend-similar', 'recall-memories', 'on-topic', 'off-topic', 'retry', 'salvage'],
  async execute(state, context) {
    const summary = state.recalledContext.summary.length > 0
      ? state.recalledContext.summary
      : undefined;
    const conversation = state.conversation.length > 0 ? state.conversation : undefined;

    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(new Error('node-timeout')), context.services.nodeTimeouts[context.nodeName] ?? NODE_TIMEOUT_MS);
    const signal = AbortSignal.any([context.signal, controller.signal]);

    try {
      const intent = await context.services.llm.classifyIntent(state.query, summary, conversation, signal);
      state.intent = intent;
      state.clearAttempts(context.nodeName);
      context.services.logger.info(`intent=${intent}`);
      switch (intent) {
        case 'off-topic':         return { "output": 'off-topic' };
        case 'lookup-author':     return { "output": 'lookup-author' };
        case 'find-reviews':      return { "output": 'find-reviews' };
        case 'describe-book':     return { "output": 'describe-book' };
        case 'recommend-similar': return { "output": 'recommend-similar' };
        case 'recall-memories':   return { "output": 'recall-memories' };
        default:                  return { "output": 'on-topic' };
      }
    } catch (err) {
      // External cancellation / run deadline propagates unchanged.
      if (context.signal.aborted) throw err;
      // Node-local timeout or LLM failure → retry budget decides the flow. The
      // classifier never fabricates an intent it didn't receive.
      if (state.withinRetryBudget(context.nodeName, RETRY_BUDGET)) {
        context.services.logger.warn(`classify-intent: failed (attempt ${String(state.retriesFor(context.nodeName))}/${String(RETRY_BUDGET)}), retry: ${err instanceof Error ? err.message : String(err)}`);
        return { "output": 'retry' };
      }
      state.clearAttempts(context.nodeName);
      context.services.logger.warn(`classify-intent: retries exhausted, salvage: ${err instanceof Error ? err.message : String(err)}`);
      return { "output": 'salvage' };
    } finally {
      clearTimeout(handle);
    }
  },
};
// #endregion node-class
