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

import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

import type { DispatcherState } from '../DispatcherState.ts';

export class SendResponseNode extends MonadicNode<DispatcherState, 'sent'> {
  readonly name = 'send-response';
  readonly outputs = ['sent'] as const;

  override get outputSchema(): Record<'sent', SchemaObjectType> {
    return { 'sent': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<DispatcherState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'sent', DispatcherState>> {
    for (const item of batch) {
      const state = item.state;
      const now = Date.now();

      if (state.message.length > 0) {
        state.conversation.push({ 'role': 'customer', 'text': state.message, 'ts': now });
      }

      const responseRole = state.escalationReason.length > 0 ? 'operator' : 'agent';
      state.conversation.push({ 'role': responseRole, 'text': state.response, 'ts': now });
    }

    return RoutedBatch.create('sent', batch);
  }
}
