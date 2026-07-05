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
import { MonadicNode } from '../../core/MonadicNode.js';
import type { ChatResponseType } from '../../entities/adapter/ChatResponse.js';
import { Batch } from '../../entities/batch/Batch.js';
import type { ItemType } from '../../entities/batch/Item.js';
import type { RoutedBatchType } from '../../entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import { DAGError } from '../../errors/DAGError.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

export abstract class AppendAssistantNode<
  TState extends NodeStateInterface,
> extends MonadicNode<TState, 'done' | 'error'> {
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

  override async execute(
    batch: Batch<TState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<'done' | 'error', TState>> {
    const acc = new Map<'done' | 'error', ItemType<TState>[]>();

    for (const item of batch) {
      const state = item.state;
      let output: NodeOutputType<'done' | 'error'>;

      try {
        const response = this.getResponse(state, context);
        if (response === null) {
          output = NodeOutputBuilder.of('error', {
            'errors': [
              NodeErrorBuilder.from(
                'appendAssistantNoResponse',
                'No response available to append',
                'AppendAssistantNode.execute',
                false,
                new Date().toISOString(),
              ),
            ],
          });
        } else {
          this.append(state, response, context);
          output = NodeOutputBuilder.of('done');
        }
      } catch (cause) {
        const error = DAGError.coerce(cause);
        output = NodeOutputBuilder.of('error', {
          'errors': [
            NodeErrorBuilder.from(
              'appendAssistantFailed',
              error.message,
              'AppendAssistantNode.execute',
              true,
              new Date().toISOString(),
            ),
          ],
        });
      }

      for (const error of output.errors) {
        state.collectError(error);
      }
      const bucket = acc.get(output.output);
      if (bucket !== undefined) {
        bucket.push(item);
      } else {
        acc.set(output.output, [item]);
      }
    }

    const routed = new Map<'done' | 'error', Batch<TState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }
}
