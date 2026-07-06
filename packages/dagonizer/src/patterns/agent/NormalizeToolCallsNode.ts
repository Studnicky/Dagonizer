/**
 * NormalizeToolCallsNode: abstract base for validating and normalizing decoded
 * tool calls before dispatch.
 *
 * Filters out any call missing a required field (`id`, `name`, `arguments`).
 * When all calls are invalid, routes `'error'`. When none present, routes
 * `'empty'`. When at least one valid call exists, writes the valid subset and
 * routes `'valid'`.
 *
 * Template methods:
 *   - `getToolCalls`: read the raw tool calls from state.
 *   - `writeNormalized`: write the valid subset back to state.
 *
 * Outputs: `'valid'`, `'empty'`, `'error'`.
 */

import type { SchemaObjectType } from '../../contracts/NodeInterface.js';
import { MonadicNode } from '../../core/MonadicNode.js';
import type { ToolCallType } from '../../entities/adapter/ToolCall.js';
import { Batch } from '../../entities/batch/Batch.js';
import type { ItemType } from '../../entities/batch/Item.js';
import type { RoutedBatchType } from '../../entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeError } from '../../entities/node/NodeError.js';
import { NodeOutput } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import { DAGError } from '../../errors/DAGError.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

export abstract class NormalizeToolCallsNode<
  TState extends NodeStateInterface,
> extends MonadicNode<TState, 'valid' | 'empty' | 'error'> {
  readonly outputs = ['valid', 'empty', 'error'] as const;

  override get outputSchema(): Record<'valid' | 'empty' | 'error', SchemaObjectType> {
    return {
      'valid': { 'type': 'object' },
      'empty': { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  /** Read the decoded tool calls from state. */
  protected abstract getToolCalls(
    state: TState,
    context: NodeContextType,
  ): readonly ToolCallType[];

  /** Write the validated subset of tool calls back to state. */
  protected abstract writeNormalized(
    state: TState,
    calls: readonly ToolCallType[],
    context: NodeContextType,
  ): void;

  override async execute(
    batch: Batch<TState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<'valid' | 'empty' | 'error', TState>> {
    const acc = new Map<'valid' | 'empty' | 'error', ItemType<TState>[]>();

    for (const item of batch) {
      const state = item.state;
      let output: NodeOutputType<'valid' | 'empty' | 'error'>;

      try {
        const calls = this.getToolCalls(state, context);
        if (calls.length === 0) {
          output = NodeOutput.create('empty');
        } else {
          const valid = calls.filter(
            (c) =>
              typeof c.id === 'string' && c.id.length > 0 &&
              typeof c.name === 'string' && c.name.length > 0 &&
              typeof c.arguments === 'object' && c.arguments !== null,
          );

          if (valid.length === 0) {
            output = NodeOutput.create('error', {
              'errors': [
                NodeError.create(
                  'normalizeToolCallsAllInvalid',
                  `All ${String(calls.length)} tool call(s) were missing required fields`,
                  'NormalizeToolCallsNode.execute',
                  false,
                  new Date().toISOString(),
                ),
              ],
            });
          } else {
            this.writeNormalized(state, valid, context);
            output = NodeOutput.create('valid');
          }
        }
      } catch (cause) {
        const error = DAGError.coerce(cause);
        output = NodeOutput.create('error', {
          'errors': [
            NodeError.create(
              'normalizeToolCallsFailed',
              error.message,
              'NormalizeToolCallsNode.execute',
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

    const routed = new Map<'valid' | 'empty' | 'error', Batch<TState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }
}
