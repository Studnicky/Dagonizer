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

import { Batch, MonadicNode, NodeOutput, RoutedBatch } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
import { Signal } from '@studnicky/signal';

/** Per-node timeout: generous for Gemini Nano's constrained-output path (20-60 s typical). */
const NODE_TIMEOUT_MS = 30_000;

/** Total attempts (initial + retries) before routing to salvage. */
const RETRY_BUDGET = 2;

// #region retry-salvage-node
export class ExtractQueryNode extends MonadicNode<ArchivistState, 'success' | 'retry' | 'salvage'> {
  private readonly services: ArchivistServices;
  readonly name = 'extract-query';
  readonly '@id' = 'urn:noocodec:node:extract-query';
  constructor(services: ArchivistServices) {
    super();
    this.services = services;
  }
  readonly outputs = ['success', 'retry', 'salvage'] as const;
  override get outputSchema(): Record<'success' | 'retry' | 'salvage', SchemaObjectType> {
    return {
      'success': { 'type': 'object' },
      'retry':   { 'type': 'object' },
      'salvage': { 'type': 'object' },
    };
  }

  override async execute(batch: Batch<ArchivistState>, context: NodeContextType) {
    const successItems: ItemType<ArchivistState>[] = [];
    const retryItems: ItemType<ArchivistState>[] = [];
    const salvageItems: ItemType<ArchivistState>[] = [];

    for (const item of batch) {
      const { state } = item;
      const signal = Signal.compose({
        'deadlineMs': this.services.nodeTimeouts[context.nodeName] ?? NODE_TIMEOUT_MS,
        'signal':     context.signal,
      });
      try {
        const terms = await this.services.llm.extractTerms(state.query, signal);
        if (terms.length === 0) {
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
          continue;
        }
        state.terms = terms;
        state.clearAttempts(context.nodeName);
        const result = NodeOutput.create('success');
        for (const error of result.errors) state.collectError(error);
        successItems.push(item);
      } catch (err) {
        // External cancellation / run deadline propagates unchanged.
        if (context.signal.aborted) throw err;
        // Node-local timeout or LLM failure -> retry budget decides the flow.
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

    const routes: Array<readonly ['success' | 'retry' | 'salvage', Batch<ArchivistState>]> = [];
    if (successItems.length > 0) routes.push(['success', Batch.from(successItems)]);
    if (retryItems.length > 0) routes.push(['retry', Batch.from(retryItems)]);
    if (salvageItems.length > 0) routes.push(['salvage', Batch.from(salvageItems)]);
    return RoutedBatch.create(routes);
  }
}
// #endregion retry-salvage-node
