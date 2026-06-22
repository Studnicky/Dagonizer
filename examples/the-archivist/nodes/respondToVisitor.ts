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


import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

/** Per-node compose deadline + total attempts before salvage. */
const EMPTY_TIMEOUT_MS = 60_000;
const EMPTY_RETRY_BUDGET = 2;

export class RespondToVisitorNode extends ScalarNode<ArchivistState, 'success'> {
  readonly name = 'respond-to-visitor';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return {
      'success': { 'type': 'object' },
    };
  }

  protected override async executeOne() {
    return NodeOutputBuilder.of('success');
  }
}

export class DeclineOffTopicNode extends ScalarNode<ArchivistState, 'success'> {
  readonly name = 'decline-off-topic';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return {
      'success': { 'type': 'object' },
    };
  }

  protected override async executeOne(state: ArchivistState) {
    state.draft = "I only help with finding and identifying books. What title or topic interests you?";
    return NodeOutputBuilder.of('success');
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
export class ComposeEmptyResponseNode extends ScalarNode<ArchivistState, 'drafted' | 'retry' | 'salvage'> {
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

  protected override async executeOne(state: ArchivistState, context: NodeContextType) {
    state.collectWarning({
      "code":      'EMPTY_SHORTLIST',
      "message":   'no candidates after merge; composing empty response',
      "operation": 'compose-empty',
      "timestamp": new Date().toISOString(),
    });
    const conversation = state.conversation.length > 0 ? state.conversation : undefined;
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(new Error('node-timeout')), this.services.nodeTimeouts[context.nodeName] ?? EMPTY_TIMEOUT_MS);
    const signal = AbortSignal.any([context.signal, controller.signal]);
    try {
      state.draft = await this.services.llm.composeEmptyResponse(state.query, state.failureCause, conversation, signal);
      state.clearAttempts(context.nodeName);
      return NodeOutputBuilder.of('drafted');
    } catch (err) {
      if (context.signal.aborted) throw err;
      if (state.withinRetryBudget(context.nodeName, EMPTY_RETRY_BUDGET)) {
        return NodeOutputBuilder.of('retry');
      }
      state.clearAttempts(context.nodeName);
      return NodeOutputBuilder.of('salvage');
    } finally {
      clearTimeout(handle);
    }
  }
}

/** Singleton node instances referenced by the DAG wiring. */
export const respondToVisitor = new RespondToVisitorNode();
export const declineOffTopic = new DeclineOffTopicNode();
