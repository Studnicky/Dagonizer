/**
 * AiComposeNode: LLM-powered reply composition for routine support queries.
 *
 * Calls the LLM to compose a concise, friendly response to the customer's
 * message using recent conversation history as context.
 *
 * Error handling:
 *   If the LLM call fails, a polite fallback message is set on state so
 *   the flow can continue to send-response without surfacing a raw error.
 *
 * Routes 'drafted' on every path.
 */

import { BatchItemExecutor, MonadicNode, RoutedBatchBuilder } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

import type { DispatcherState } from '../DispatcherState.ts';
import type { DispatcherServices } from '../services.ts';

export class AiComposeNode extends MonadicNode<DispatcherState, 'drafted'> {
  readonly name = 'ai-compose';
  readonly outputs = ['drafted'] as const;

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
    return RoutedBatchBuilder.of('drafted', batch);
  }
}
