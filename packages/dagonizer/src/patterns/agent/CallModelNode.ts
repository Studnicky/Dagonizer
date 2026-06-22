/**
 * CallModelNode: abstract base for sending a chat request to the LLM and
 * storing the response.
 *
 * Default adapter resolver reads `context.services.llm`. Subclasses may
 * override `resolveAdapter` to swap providers per-state.
 *
 * Template methods:
 *   - `getRequest`: read the prepared `ChatRequestType` from state.
 *   - `storeResponse`: write the `ChatResponseType` back to state.
 *
 * Outputs: `'text' | 'tools' | 'mixed'` based on `response.message.variant`,
 * `'error'` on failure.
 */

import type { AgentServicesType } from '../../contracts/AgentServicesType.js';
import type { LlmAdapterInterface } from '../../contracts/LlmAdapterInterface.js';
import type { SchemaObjectType } from '../../contracts/NodeInterface.js';
import { ScalarNode } from '../../core/ScalarNode.js';
import type { ChatRequestType } from '../../entities/adapter/ChatRequest.js';
import type { ChatResponseType } from '../../entities/adapter/ChatResponse.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import { DAGError } from '../../errors/DAGError.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

export abstract class CallModelNode<
  TState extends NodeStateInterface,
> extends ScalarNode<TState, 'text' | 'tools' | 'mixed' | 'error', AgentServicesType> {
  readonly outputs = ['text', 'tools', 'mixed', 'error'] as const;

  override get outputSchema(): Record<'text' | 'tools' | 'mixed' | 'error', SchemaObjectType> {
    return {
      'text':  { 'type': 'object' },
      'tools': { 'type': 'object' },
      'mixed': { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  /**
   * Resolve the LLM adapter to use. Default: `context.services.llm`.
   * Override to swap providers (e.g. per-state model selection).
   */
  protected resolveAdapter(
    _state: TState,
    context: NodeContextType<AgentServicesType>,
  ): LlmAdapterInterface {
    const services = context.services;
    if (services === undefined) {
      throw new DAGError('CallModelNode requires a services record carrying an `llm` adapter; the dispatcher was constructed without `services`.');
    }
    return services.llm;
  }

  /** Read the prepared chat request from state. */
  protected abstract getRequest(
    state: TState,
    context: NodeContextType<AgentServicesType>,
  ): ChatRequestType;

  /** Write the model's response back to state. */
  protected abstract storeResponse(
    state: TState,
    response: ChatResponseType,
    context: NodeContextType<AgentServicesType>,
  ): void;

  protected override async executeOne(
    state: TState,
    context: NodeContextType<AgentServicesType>,
  ): Promise<NodeOutputType<'text' | 'tools' | 'mixed' | 'error'>> {
    try {
      const adapter = this.resolveAdapter(state, context);
      const request = this.getRequest(state, context);
      const response = await adapter.chat(request);
      this.storeResponse(state, response, context);
      return NodeOutputBuilder.of(response.message.variant);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      return NodeOutputBuilder.of('error', {
        'errors': [
          NodeErrorBuilder.from(
            'modelCallFailed',
            error.message,
            'CallModelNode.executeOne',
            true,
            new Date().toISOString(),
          ),
        ],
      });
    }
  }
}
