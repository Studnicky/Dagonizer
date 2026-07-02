/**
 * AppendAssistantNode: abstract base for appending the model's response as an
 * assistant message to the conversation history.
 *
 * Template methods:
 *   - `getResponse`: read the `ChatResponseType` from state (or `null`).
 *   - `append`: append the response to the conversation history in state.
 *
 * Outputs: `'done'` on success, `'error'` on failure or missing response.
 */

import type { SchemaObjectType } from '../../contracts/NodeInterface.js';
import { ScalarNode } from '../../core/ScalarNode.js';
import type { ChatResponseType } from '../../entities/adapter/ChatResponse.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import { DAGError } from '../../errors/DAGError.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

export abstract class AppendAssistantNode<
  TState extends NodeStateInterface,
> extends ScalarNode<TState, 'done' | 'error'> {
  readonly outputs = ['done', 'error'] as const;

  override get outputSchema(): Record<'done' | 'error', SchemaObjectType> {
    return {
      'done':  { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  /** Read the stored model response from state. Return `null` when absent. */
  protected abstract getResponse(
    state: TState,
    context: NodeContextType,
  ): ChatResponseType | null;

  /**
   * Append the response as an assistant message to the conversation in state.
   * Called only when `getResponse` returns a non-null value.
   */
  protected abstract append(
    state: TState,
    response: ChatResponseType,
    context: NodeContextType,
  ): void;

  protected override async executeOne(
    state: TState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'done' | 'error'>> {
    try {
      const response = this.getResponse(state, context);
      if (response === null) {
        return NodeOutputBuilder.of('error', {
          'errors': [
            NodeErrorBuilder.from(
              'appendAssistantNoResponse',
              'No response available to append',
              'AppendAssistantNode.executeOne',
              false,
              new Date().toISOString(),
            ),
          ],
        });
      }
      this.append(state, response, context);
      return NodeOutputBuilder.of('done');
    } catch (cause) {
      const error = DAGError.coerce(cause);
      return NodeOutputBuilder.of('error', {
        'errors': [
          NodeErrorBuilder.from(
            'appendAssistantFailed',
            error.message,
            'AppendAssistantNode.executeOne',
            true,
            new Date().toISOString(),
          ),
        ],
      });
    }
  }
}
