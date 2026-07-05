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
import { MonadicNode } from '../../core/MonadicNode.js';
import type { ChatRequestType } from '../../entities/adapter/ChatRequest.js';
import { Batch } from '../../entities/batch/Batch.js';
import type { ItemType } from '../../entities/batch/Item.js';
import type { RoutedBatchType } from '../../entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import { DAGError } from '../../errors/DAGError.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

export abstract class BuildChatRequestNode<
  TState extends NodeStateInterface,
> extends MonadicNode<TState, 'ready' | 'error'> {
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

  override async execute(
    batch: Batch<TState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<'ready' | 'error', TState>> {
    const acc = new Map<'ready' | 'error', ItemType<TState>[]>();

    for (const item of batch) {
      const state = item.state;
      let output: NodeOutputType<'ready' | 'error'>;

      try {
        this.buildRequest(state, context);
        output = NodeOutputBuilder.of('ready');
      } catch (cause) {
        const error = DAGError.coerce(cause);
        output = NodeOutputBuilder.of('error', {
          'errors': [
            NodeErrorBuilder.from(
              'buildRequestFailed',
              error.message,
              'BuildChatRequestNode.execute',
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

    const routed = new Map<'ready' | 'error', Batch<TState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }
}
