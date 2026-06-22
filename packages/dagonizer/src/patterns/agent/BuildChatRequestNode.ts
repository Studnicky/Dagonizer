/**
 * BuildChatRequestNode: abstract base for constructing an LLM chat request
 * from current state and storing it back for the next node.
 *
 * Template method: `buildRequest` — subclass builds the full `ChatRequestType`
 * (and writes it to state) from state and context.
 *
 * Outputs: `'ready'` on success, `'error'` on failure.
 */

import type { SchemaObjectType } from '../../contracts/NodeInterface.js';
import { ScalarNode } from '../../core/ScalarNode.js';
import type { ChatRequestType } from '../../entities/adapter/ChatRequest.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

export abstract class BuildChatRequestNode<
  TState extends NodeStateInterface,
> extends ScalarNode<TState, 'ready' | 'error'> {
  readonly outputs = ['ready', 'error'] as const;

  override get outputSchema(): Record<'ready' | 'error', SchemaObjectType> {
    return {
      'ready': { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  /**
   * Build the chat request from the current state.
   * The implementation is also responsible for writing the request back
   * to state so downstream nodes (e.g. `CallModelNode`) can read it.
   */
  protected abstract buildRequest(
    state: TState,
    context: NodeContextType,
  ): ChatRequestType;

  protected override async executeOne(
    state: TState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'ready' | 'error'>> {
    try {
      this.buildRequest(state, context);
      return NodeOutputBuilder.of('ready');
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      return NodeOutputBuilder.of('error', {
        'errors': [
          NodeErrorBuilder.from(
            'buildRequestFailed',
            error.message,
            'BuildChatRequestNode.executeOne',
            true,
            new Date().toISOString(),
          ),
        ],
      });
    }
  }
}
