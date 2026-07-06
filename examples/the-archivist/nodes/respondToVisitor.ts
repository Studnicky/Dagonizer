/**
 * respondToVisitor / declineOffTopic / composeEmptyResponse
 * Terminal and near-terminal nodes.
 *
 * respondToVisitor:    shared happy-path terminal (routes to null after compose).
 * declineOffTopic:     hard off-topic gate; sets a redirect draft and exits.
 * composeEmptyResponse: LLM-driven empty-result response. Uses `state.failureCause`
 *                       to produce an in-character acknowledgement of what was tried
 *                       and one concrete next-step suggestion. Always responds;
 *                       never throws, never silent-fails. Routes to respond-to-visitor
 *                       so the conversation always gets an answer.
 *
 * Demonstrates: terminal nodes (output routes to `null`) and the
 * `state.collectWarning` accumulator for soft signals.
 */


import { Batch, MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
import { Signal } from '@studnicky/signal';

import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

/** Per-node compose deadline + total attempts before salvage. */
const EMPTY_TIMEOUT_MS = 60_000;
const EMPTY_RETRY_BUDGET = 2;

export class RespondToVisitorNode extends MonadicNode<ArchivistState, 'success'> {
  readonly name = 'respond-to-visitor';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return {
      'success': { 'type': 'object' },
    };
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    return RoutedBatch.create('success', batch);
  }
}

export class DeclineOffTopicNode extends MonadicNode<ArchivistState, 'success'> {
  readonly name = 'decline-off-topic';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return {
      'success': { 'type': 'object' },
    };
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    for (const { state } of batch) {
      state.draft = "I only help with finding and identifying books. What title or topic interests you?";
    }
    return RoutedBatch.create('success', batch);
  }
}

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
 * salvage edge; not in this node's catch. No in-node `RetryPolicy`, no engine
 * `timeoutMs` crutch.
 */
export class ComposeEmptyResponseNode extends MonadicNode<ArchivistState, 'drafted' | 'retry' | 'salvage'> {
  private readonly services: ArchivistServices;
  readonly name = 'compose-empty';
  readonly outputs = ['drafted', 'retry', 'salvage'] as const;
  override get outputSchema(): Record<'drafted' | 'retry' | 'salvage', SchemaObjectType> {
    return {
      'drafted': { 'type': 'object' },
      'retry':   { 'type': 'object' },
      'salvage': { 'type': 'object' },
    };
  }

  constructor(services: ArchivistServices) {
    super();
    this.services = services;
  }

  override async execute(batch: Batch<ArchivistState>, context: NodeContextType) {
    const draftedItems: ItemType<ArchivistState>[] = [];
    const retryItems: ItemType<ArchivistState>[] = [];
    const salvageItems: ItemType<ArchivistState>[] = [];

    for (const item of batch) {
      const { state } = item;
      state.collectWarning({
        "code":      'EMPTY_SHORTLIST',
        "message":   'no candidates after merge; composing empty response',
        "operation": 'compose-empty',
        "timestamp": new Date().toISOString(),
      });
      const conversation = state.conversation.length > 0 ? state.conversation : undefined;
      const signal = Signal.compose({
        'deadlineMs': this.services.nodeTimeouts[context.nodeName] ?? EMPTY_TIMEOUT_MS,
        'signal':     context.signal,
      });
      try {
        state.draft = await this.services.llm.composeEmptyResponse(state.query, state.failureCause, conversation, signal);
        state.clearAttempts(context.nodeName);
        draftedItems.push(item);
      } catch (err) {
        if (context.signal.aborted) throw err;
        if (state.withinRetryBudget(context.nodeName, EMPTY_RETRY_BUDGET)) {
          retryItems.push(item);
        } else {
          state.clearAttempts(context.nodeName);
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

/**
 * HITL gate node: parks the flow when the visitor's query is empty, waiting
 * for human input to continue. On resume, `state.query` is set by the caller
 * before `dispatcher.resume()` so this node routes `'resumed'` and proceeds
 * to `recall-context`.
 *
 * Routes:
 *   'parked'  — engine parks here (cursor = 'park-for-input'); caller supplies
 *               the human answer then resumes via `dispatcher.resume()`.
 *   'resumed' — query is non-empty; continues to `recall-context`.
 */
export class ParkForInputNode extends MonadicNode<ArchivistState, 'parked' | 'resumed'> {
  readonly name = 'park-for-input';
  readonly outputs = ['parked', 'resumed'] as const;
  override get outputSchema(): Record<'parked' | 'resumed', SchemaObjectType> {
    return {
      'parked':  { 'type': 'object' },
      'resumed': { 'type': 'object' },
    };
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    const parkedItems: ItemType<ArchivistState>[] = [];
    const resumedItems: ItemType<ArchivistState>[] = [];
    for (const item of batch) {
      if (item.state.query.length === 0) {
        item.state.park('archivist-hitl');
        parkedItems.push(item);
      } else {
        resumedItems.push(item);
      }
    }
    const routes: Array<readonly ['parked' | 'resumed', Batch<ArchivistState>]> = [];
    if (parkedItems.length > 0) routes.push(['parked', Batch.from(parkedItems)]);
    if (resumedItems.length > 0) routes.push(['resumed', Batch.from(resumedItems)]);
    return RoutedBatch.create(routes);
  }
}

/** Singleton node instances referenced by the DAG wiring. */
export const respondToVisitor = new RespondToVisitorNode();
export const declineOffTopic = new DeclineOffTopicNode();
