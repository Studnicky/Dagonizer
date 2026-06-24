/**
 * SendResponseNode: appends both sides of the exchange to the conversation log.
 *
 * Appends in order:
 *   1. The customer message (role: 'customer') — skipped if state.message is empty.
 *   2. The composed response with role:
 *        'operator' when escalationReason is set (human replied).
 *        'agent'    for AI-composed responses.
 *
 * Routes 'sent' always.
 */

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

import type { DispatcherState } from '../DispatcherState.ts';

export class SendResponseNode extends ScalarNode<DispatcherState, 'sent'> {
  readonly name = 'send-response';
  readonly outputs = ['sent'] as const;

  override get outputSchema(): Record<'sent', SchemaObjectType> {
    return { 'sent': { 'type': 'object' } };
  }

  protected override async executeOne(state: DispatcherState) {
    const now = Date.now();

    if (state.message.length > 0) {
      state.conversation.push({ 'role': 'customer', 'text': state.message, 'ts': now });
    }

    const responseRole = state.escalationReason.length > 0 ? 'operator' : 'agent';
    state.conversation.push({ 'role': responseRole, 'text': state.response, 'ts': now });

    return NodeOutputBuilder.of('sent');
  }
}
