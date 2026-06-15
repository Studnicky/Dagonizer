/**
 * composeMemoryResponse: LLM compose node for the recall-memories branch.
 *
 * Calls `context.services.llm.composeMemoryRecall(...)` with the
 * visitor's query, the structured `MemoryDigest` from `recallMemories`,
 * and the optional recalled-context summary. Stores the result in
 * `state.draft` so the shared `respondToVisitor` terminal can emit it.
 *
 * Kind: 'non-deterministic'; LLM output varies per call.
 * Failure is a flow decision: the node arms its own deadline and, on its own
 * timeout or an LLM error, routes `retry` (loops back, bounded) or `salvage`
 * (a deterministic recovery node); no engine `timeoutMs` crutch.
 */

import { NodeOutputBuilder, ScalarNode } from '@noocodex/dagonizer';
import type { NodeContextInterface } from '@noocodex/dagonizer';

import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';
import { COMPOSE_TIMEOUT_MS } from './composeResponse.ts';

/** Total attempts (initial + retries) before routing to salvage. */
const RETRY_BUDGET = 3;

export class ComposeMemoryResponseNode extends ScalarNode<ArchivistState, 'drafted' | 'retry' | 'salvage', ArchivistServices> {
  readonly name = 'compose-memory-response';
  readonly outputs = ['drafted', 'retry', 'salvage'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    const recalledSummary = state.recalledContext.summary.length > 0
      ? state.recalledContext.summary
      : undefined;
    const conversation = state.conversation.length > 0 ? state.conversation : undefined;

    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(new Error('node-timeout')), context.services.nodeTimeouts[context.nodeName] ?? COMPOSE_TIMEOUT_MS);
    const signal = AbortSignal.any([context.signal, controller.signal]);
    try {
      state.draft = await context.services.llm.composeMemoryRecall(
        state.query,
        state.memoryDigest,
        recalledSummary,
        conversation,
        signal,
      );
      state.clearAttempts(context.nodeName);
      context.services.logger.info(
        `compose-memory-response: draft length=${String(state.draft.length)}`,
      );
      return NodeOutputBuilder.of('drafted');
    } catch (err) {
      if (context.signal.aborted) throw err;
      if (state.withinRetryBudget(context.nodeName, RETRY_BUDGET)) {
        context.services.logger.warn(`compose-memory-response: failed (attempt ${String(state.retriesFor(context.nodeName))}/${String(RETRY_BUDGET)}), retry: ${err instanceof Error ? err.message : String(err)}`);
        return NodeOutputBuilder.of('retry');
      }
      state.clearAttempts(context.nodeName);
      context.services.logger.warn(`compose-memory-response: retries exhausted, salvage: ${err instanceof Error ? err.message : String(err)}`);
      return NodeOutputBuilder.of('salvage');
    } finally {
      clearTimeout(handle);
    }
  }
}

/** Backward-compatible const export for existing bundle/DAG references. */
export const composeMemoryResponse = new ComposeMemoryResponseNode();
