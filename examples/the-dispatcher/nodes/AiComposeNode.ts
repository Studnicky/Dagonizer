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

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

import type { DispatcherState } from '../DispatcherState.ts';
import type { DispatcherServices } from '../services.ts';

export class AiComposeNode extends ScalarNode<DispatcherState, 'drafted'> {
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

  protected override async executeOne(state: DispatcherState, context: NodeContextType) {
    try {
      state.response = await this.#services.llm.compose(state.message, state.conversation, context.signal);
    } catch {
      state.response = 'I apologize — I had trouble composing a reply. Please try again or ask for a human agent.';
    }
    return NodeOutputBuilder.of('drafted');
  }
}
