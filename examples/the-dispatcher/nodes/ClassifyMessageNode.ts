/**
 * ClassifyMessageNode: deterministic triage — no LLM required.
 *
 * Routes each inbound customer message to one of three outputs:
 *   'routine'  — AI can handle; routes to ai-compose.
 *   'escalate' — human operator needed; routes to park-for-operator.
 *   'off-topic' — blank or unrelated; routes to decline.
 *
 * Escalation triggers:
 *   Trolley switch (state.humanMode === true) overrides content checks and
 *   forces escalation on every message.
 *   Keywords: refund, billing, account, password, charge, complaint, angry,
 *             urgent, manager, supervisor (case-insensitive).
 */

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

import type { DispatcherState } from '../DispatcherState.ts';

const ESCALATION_KEYWORDS = /\b(refund|billing|account|password|charge|complaint|angry|urgent|manager|supervisor)\b/i;

export class ClassifyMessageNode extends ScalarNode<DispatcherState, 'routine' | 'escalate' | 'off-topic'> {
  readonly name = 'classify-message';
  readonly outputs = ['routine', 'escalate', 'off-topic'] as const;

  override get outputSchema(): Record<'routine' | 'escalate' | 'off-topic', SchemaObjectType> {
    return {
      'routine':    { 'type': 'object' },
      'escalate':   { 'type': 'object' },
      'off-topic':  { 'type': 'object' },
    };
  }

  protected override async executeOne(state: DispatcherState) {
    const msg = state.message.trim();

    if (state.humanMode) {
      state.escalationReason = 'Human mode active — routed to operator';
      return NodeOutputBuilder.of('escalate');
    }

    if (msg.length === 0) {
      return NodeOutputBuilder.of('off-topic');
    }

    const match = ESCALATION_KEYWORDS.exec(msg);
    if (match !== null) {
      state.escalationReason = `Message flagged for human review: ${match[0]}`;
      return NodeOutputBuilder.of('escalate');
    }

    return NodeOutputBuilder.of('routine');
  }
}
