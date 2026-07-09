/**
 * AiComposeNode: LLM-powered reply composition for routine support queries.
 *
 * Calls the LLM to compose a concise, friendly response to the customer's
 * message using recent conversation history as context.
 *
 * Error handling:
 *   If the LLM call fails, a polite recovery message is set on state so
 *   the flow can continue to send-response without surfacing a raw error.
 *
 * Routes 'drafted' on every path.
 */

import { BatchItemExecutor, MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';
import { Timeout } from '@studnicky/dagonizer/runtime';

import type { DispatcherState } from '../DispatcherState.ts';
import type { DispatcherServices } from '../services.ts';

export class AiComposeNode extends MonadicNode<DispatcherState, 'drafted'> {
  readonly name = 'ai-compose';
  readonly '@id' = 'urn:noocodec:node:ai-compose';
  readonly outputs = ['drafted'] as const;
  override readonly timeout = Timeout.ofMs(60_000);

  readonly #services: DispatcherServices;

  constructor(services: DispatcherServices) {
    super();
    this.#services = services;
  }

  override get outputSchema(): Record<'drafted', SchemaObjectType> {
    return { 'drafted': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<DispatcherState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<'drafted', DispatcherState>> {
    await BatchItemExecutor.map(batch.items(), async (item) => {
      try {
        item.state.response = await this.#services.llm.compose(item.state.message, item.state.conversation, context.signal);
      } catch {
        item.state.response = 'I apologize — I had trouble composing a reply. Please try again or ask for a human agent.';
      }
    }, this.#services.execution, context.signal);
    return RoutedBatch.create('drafted', batch);
  }
}
