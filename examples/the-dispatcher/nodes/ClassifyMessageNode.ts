/**
 * ClassifyMessageNode: LLM-powered triage with deterministic overrides.
 *
 * Routes each inbound customer message to one of three outputs:
 *   'routine'   — AI can handle; routes to ai-compose.
 *   'escalate'  — human operator needed; routes to park-for-operator.
 *   'off-topic' — blank or unrelated; routes to decline.
 *
 * Fast paths (no LLM):
 *   Trolley switch (state.humanMode === true) forces escalation on every
 *   message before any LLM call is made.
 *   Empty message → off-topic immediately.
 *
 * LLM error handling:
 *   If the LLM call throws, the node escalates with a safety reason rather
 *   than surfacing an unhandled error — a conservative fallback that keeps
 *   customers in the flow.
 */

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

import type { DispatcherState } from '../DispatcherState.ts';
import type { DispatcherServices } from '../services.ts';

export class ClassifyMessageNode extends ScalarNode<DispatcherState, 'routine' | 'escalate' | 'off-topic'> {
  readonly name = 'classify-message';
  readonly outputs = ['routine', 'escalate', 'off-topic'] as const;

  readonly #services: DispatcherServices;

  constructor(services: DispatcherServices) {
    super();
    this.#services = services;
  }

  override get outputSchema(): Record<'routine' | 'escalate' | 'off-topic', SchemaObjectType> {
    return {
      'routine':   { 'type': 'object' },
      'escalate':  { 'type': 'object' },
      'off-topic': { 'type': 'object' },
    };
  }

  protected override async executeOne(state: DispatcherState, context: NodeContextType) {
    // Trolley switch: force human routing regardless of content.
    if (state.humanMode) {
      state.escalationReason = 'Human mode active — all messages routed to operator';
      return NodeOutputBuilder.of('escalate');
    }

    // Empty message → off-topic without LLM.
    if (state.message.trim().length === 0) {
      return NodeOutputBuilder.of('off-topic');
    }

    // LLM classification with conservative escalation on error.
    let intent: 'routine' | 'escalate' | 'off-topic';
    try {
      intent = await this.#services.llm.classify(state.message, state.conversation, context.signal);
    } catch {
      state.escalationReason = 'LLM unavailable; escalated for safety';
      return NodeOutputBuilder.of('escalate');
    }

    if (intent === 'escalate') {
      state.escalationReason = 'Agent determined this message requires human review.';
      return NodeOutputBuilder.of('escalate');
    }
    if (intent === 'off-topic') return NodeOutputBuilder.of('off-topic');
    return NodeOutputBuilder.of('routine');
  }
}
