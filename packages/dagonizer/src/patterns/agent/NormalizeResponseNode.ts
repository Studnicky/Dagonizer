/**
 * NormalizeResponseNode: abstract base for inspecting a stored model response
 * and routing on its message variant.
 *
 * Template method:
 *   - `getResponse`: read the `ChatResponseType` from state (or `null`).
 *
 * Outputs:
 *   - `'text' | 'tools' | 'mixed'` — from `response.message.variant`
 *   - `'empty'` — when `getResponse` returns `null`
 *   - `'error'` — on unexpected failure
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

export abstract class NormalizeResponseNode<
  TState extends NodeStateInterface,
> extends MonadicNode<TState, 'text' | 'tools' | 'mixed' | 'empty' | 'error'> {
  readonly outputs = ['text', 'tools', 'mixed', 'empty', 'error'] as const;

  override get outputSchema(): Record<'text' | 'tools' | 'mixed' | 'empty' | 'error', SchemaObjectType> {
    return {
      'text':  { 'type': 'object' },
      'tools': { 'type': 'object' },
      'mixed': { 'type': 'object' },
      'empty': { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  /** Read the stored chat response from state. Return `null` when absent. */
  protected abstract getResponse(
    state: TState,
    context: NodeContextType,
  ): ChatResponseType | null;

  override async execute(
    batch: Batch<TState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<'text' | 'tools' | 'mixed' | 'empty' | 'error', TState>> {
    const acc = new Map<'text' | 'tools' | 'mixed' | 'empty' | 'error', ItemType<TState>[]>();

    for (const item of batch) {
      const state = item.state;
      let output: NodeOutputType<'text' | 'tools' | 'mixed' | 'empty' | 'error'>;

      try {
        const response = this.getResponse(state, context);
        output = response === null
          ? NodeOutputBuilder.of('empty')
          : NodeOutputBuilder.of(response.message.variant);
      } catch (cause) {
        const error = DAGError.coerce(cause);
        output = NodeOutputBuilder.of('error', {
          'errors': [
            NodeErrorBuilder.from(
              'normalizeResponseFailed',
              error.message,
              'NormalizeResponseNode.execute',
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

    const routed = new Map<'text' | 'tools' | 'mixed' | 'empty' | 'error', Batch<TState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }
}
