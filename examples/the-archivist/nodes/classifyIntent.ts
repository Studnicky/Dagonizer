/**
 * classifyIntent — entry node. Asks the LLM to classify the visitor's
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
  | 'off-topic';

/** Per-node timeout — generous for Gemini Nano's constrained-output path (20–60 s typical). */
const NODE_TIMEOUT_MS = 30_000;

export const classifyIntent: NodeInterface<ArchivistState, IntentOutput, ArchivistServices> = {
  "name": 'classify-intent',
  "outputs": ['lookup-author', 'find-reviews', 'describe-book', 'recommend-similar', 'recall-memories', 'on-topic', 'off-topic'],
  async execute(state, context) {
    const summary = state.recalledContext.summary.length > 0
      ? state.recalledContext.summary
      : undefined;
    const conversation = state.conversation.length > 0 ? state.conversation : undefined;

    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(new Error('node-timeout')), NODE_TIMEOUT_MS);
    const signal = AbortSignal.any([context.signal, controller.signal]);

    try {
      const intent = await context.services.llm.classifyIntent(state.query, summary, conversation, signal);
      state.intent = intent;
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
      // Salvage path: timeout or any error — assume search (broadest safe default).
      // `'on-topic'` is a routing output, not a state intent value — the state
      // uses `'search'` for the legacy on-topic pipeline.
      context.services.logger.warn(`classifyIntent: timeout/error — falling through with defaults: ${err instanceof Error ? err.message : String(err)}`);
      state.intent = 'search';
      return { "output": 'on-topic' };
    } finally {
      clearTimeout(handle);
    }
  },
};
// #endregion node-class
