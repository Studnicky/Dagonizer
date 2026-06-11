/**
 * extractQuery: parse the raw question into structured search terms.
 *
 * The LLM returns a small array (`['cosmic horror', 'novella']`,
 * `['ursula le guin', 'fantasy']`) that the scouts use as input.
 *
 * Timeout / failure is a flow decision, not an execution one: the node arms
 * its own deadline, and on its own timeout or an LLM error it makes a flow
 * decision via the conceptual-root retry budget: route `retry` (the DAG loops
 * the edge back, bounded by `state.withinRetryBudget`) or, once the budget is
 * spent, `salvage` (the DAG routes to a deterministic recovery node). It never
 * fabricates terms and claims success. External cancellation (`context.signal`)
 * is re-thrown so the engine records it as cancelled, not as a retry.
 *
 * Demonstrates: retry-as-flow-shape (`success` / `retry` / `salvage`) with no
 * in-node `RetryPolicy`.
 */


import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

import { NodeOutputBuilder } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer';

/** Per-node timeout: generous for Gemini Nano's constrained-output path (20-60 s typical). */
const NODE_TIMEOUT_MS = 30_000;

/** Total attempts (initial + retries) before routing to salvage. */
const RETRY_BUDGET = 2;

// #region retry-salvage-node
export const extractQuery: NodeInterface<ArchivistState, 'success' | 'retry' | 'salvage', ArchivistServices> = {
  "name": 'extract-query',
  "outputs": ['success', 'retry', 'salvage'],
  async execute(state, context) {
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(new Error('node-timeout')), context.services.nodeTimeouts[context.nodeName] ?? NODE_TIMEOUT_MS);
    const signal = AbortSignal.any([context.signal, controller.signal]);
    try {
      state.terms = await context.services.llm.extractTerms(state.query, signal);
      state.clearAttempts(context.nodeName);
      return NodeOutputBuilder.of('success');
    } catch (err) {
      // External cancellation / run deadline propagates unchanged.
      if (context.signal.aborted) throw err;
      // Node-local timeout or LLM failure → retry budget decides the flow.
      if (state.withinRetryBudget(context.nodeName, RETRY_BUDGET)) {
        context.services.logger.warn(`extract-query: failed (attempt ${String(state.retriesFor(context.nodeName))}/${String(RETRY_BUDGET)}), retry: ${err instanceof Error ? err.message : String(err)}`);
        return NodeOutputBuilder.of('retry');
      }
      state.clearAttempts(context.nodeName);
      context.services.logger.warn(`extract-query: retries exhausted, salvage: ${err instanceof Error ? err.message : String(err)}`);
      return NodeOutputBuilder.of('salvage');
    } finally {
      clearTimeout(handle);
    }
  },
};
// #endregion retry-salvage-node
