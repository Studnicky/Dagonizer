/**
 * composeMemoryResponse: LLM compose node for the recall-memories branch.
 *
 * Calls `this.services.llm.composeMemoryRecall(...)` with the
 * visitor's query, the structured `MemoryDigest` from `recallMemories`,
 * and the optional recalled-context summary. Stores the result in
 * `state.draft` so the shared `respondToVisitor` terminal can emit it.
 *
 * Kind: 'non-deterministic'; LLM output varies per call.
 * Failure is a flow decision: the node arms its own deadline and, on its own
 * timeout or an LLM error, routes `retry` (loops back, bounded) or `salvage`
 * (a deterministic recovery node); no engine `timeoutMs` crutch.
 */

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';
import { COMPOSE_TIMEOUT_MS } from './composeResponse.ts';

/** Total attempts (initial + retries) before routing to salvage. */
const RETRY_BUDGET = 3;

export class ComposeMemoryResponseNode extends ScalarNode<ArchivistState, 'drafted' | 'retry' | 'salvage'> {
  readonly name = 'compose-memory-response';
  readonly outputs = ['drafted', 'retry', 'salvage'] as const;

  private readonly services: ArchivistServices;
  constructor(services: ArchivistServices) {
    super();
    this.services = services;
  }
  override get outputSchema(): Record<'drafted' | 'retry' | 'salvage', SchemaObjectType> {
    return {
      'drafted': { 'type': 'object' },
      'retry':   { 'type': 'object' },
      'salvage': { 'type': 'object' },
    };
  }

  protected override async executeOne(state: ArchivistState, context: NodeContextType) {
    const recalledSummary = state.recalledContext.summary.length > 0
      ? state.recalledContext.summary
      : undefined;
    const conversation = state.conversation.length > 0 ? state.conversation : undefined;

    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(new Error('node-timeout')), this.services.nodeTimeouts[context.nodeName] ?? COMPOSE_TIMEOUT_MS);
    const signal = AbortSignal.any([context.signal, controller.signal]);
    try {
      state.draft = await this.services.llm.composeMemoryRecall(
        state.query,
        state.memoryDigest,
        recalledSummary,
        conversation,
        signal,
      );
      state.clearAttempts(context.nodeName);
      return NodeOutputBuilder.of('drafted');
    } catch (err) {
      if (context.signal.aborted) throw err;
      if (state.withinRetryBudget(context.nodeName, RETRY_BUDGET)) {
        return NodeOutputBuilder.of('retry');
      }
      state.clearAttempts(context.nodeName);
      return NodeOutputBuilder.of('salvage');
    } finally {
      clearTimeout(handle);
    }
  }
}

