/**
 * DeclineNode: politely redirects off-topic messages.
 *
 * Sets state.response to the standard Noocodex off-topic reply,
 * appends the exchange to the conversation log, and routes 'declined'.
 */

import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

import type { DispatcherState } from '../DispatcherState.ts';

const DECLINE_REPLY = "I'm sorry, I can only help with questions about Noocodex orders and products. Is there something book-related I can assist you with?";

export class DeclineNode extends MonadicNode<DispatcherState, 'declined'> {
  readonly name = 'decline';
  readonly outputs = ['declined'] as const;

  override get outputSchema(): Record<'declined', SchemaObjectType> {
    return { 'declined': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<DispatcherState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'declined', DispatcherState>> {
    for (const item of batch) {
      const state = item.state;
      state.response = DECLINE_REPLY;

      const now = Date.now();
      if (state.message.length > 0) {
        state.conversation.push({ 'role': 'customer', 'text': state.message, 'ts': now });
      }
      state.conversation.push({ 'role': 'agent', 'text': state.response, 'ts': now });
    }

    return RoutedBatch.create('declined', batch);
  }
}
