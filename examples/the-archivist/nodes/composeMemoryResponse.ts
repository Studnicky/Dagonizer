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

import { Batch, MonadicNode, NodeOutput, RoutedBatch } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
import { Signal } from '@studnicky/signal';

import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';
import { COMPOSE_TIMEOUT_MS } from './composeResponse.ts';

/** Total attempts (initial + retries) before routing to salvage. */
const RETRY_BUDGET = 3;

export class ComposeMemoryResponseNode extends MonadicNode<ArchivistState, 'drafted' | 'retry' | 'salvage'> {
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

  override async execute(batch: Batch<ArchivistState>, context: NodeContextType) {
    const draftedItems: ItemType<ArchivistState>[] = [];
    const retryItems: ItemType<ArchivistState>[] = [];
    const salvageItems: ItemType<ArchivistState>[] = [];

    for (const item of batch) {
      const { state } = item;
      const recalledSummary = state.recalledContext.summary.length > 0
        ? state.recalledContext.summary
        : undefined;
      const conversation = state.conversation.length > 0 ? state.conversation : undefined;

      const signal = Signal.compose({
        'deadlineMs': this.services.nodeTimeouts[context.nodeName] ?? COMPOSE_TIMEOUT_MS,
        'signal':     context.signal,
      });
      try {
        state.draft = await this.services.llm.composeMemoryRecall(
          state.query,
          state.memoryDigest,
          recalledSummary,
          conversation,
          signal,
        );
        state.clearAttempts(context.nodeName);
        const result = NodeOutput.create('drafted');
        for (const error of result.errors) state.collectError(error);
        draftedItems.push(item);
      } catch (err) {
        if (context.signal.aborted) throw err;
        if (state.withinRetryBudget(context.nodeName, RETRY_BUDGET)) {
          const result = NodeOutput.create('retry');
          for (const error of result.errors) state.collectError(error);
          retryItems.push(item);
        } else {
          state.clearAttempts(context.nodeName);
          const result = NodeOutput.create('salvage');
          for (const error of result.errors) state.collectError(error);
          salvageItems.push(item);
        }
      }
    }

    const routes: Array<readonly ['drafted' | 'retry' | 'salvage', Batch<ArchivistState>]> = [];
    if (draftedItems.length > 0) routes.push(['drafted', Batch.from(draftedItems)]);
    if (retryItems.length > 0) routes.push(['retry', Batch.from(retryItems)]);
    if (salvageItems.length > 0) routes.push(['salvage', Batch.from(salvageItems)]);
    return RoutedBatch.create(routes);
  }
}
