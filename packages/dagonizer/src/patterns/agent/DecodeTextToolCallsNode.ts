/**
 * DecodeTextToolCallsNode: abstract base for parsing tool-call JSON embedded
 * in a model's text response (text-channel tool calls).
 *
 * Template methods:
 *   - `getText`: read the raw model text from state.
 *   - `storeToolCalls`: write the decoded `ToolCallType[]` back to state.
 *
 * Overridable default:
 *   - `idPrefix` getter: prefix for synthesized call ids (default `'agent'`).
 *
 * Outputs: `'decoded'` when calls found, `'empty'` when none, `'error'` on failure.
 */

import { ToolCallCodec } from '../../adapter/ToolCallCodec.js';
import type { SchemaObjectType } from '../../contracts/NodeInterface.js';
import { MonadicNode } from '../../core/MonadicNode.js';
import type { ToolCallType } from '../../entities/adapter/ToolCall.js';
import { Batch } from '../../entities/batch/Batch.js';
import type { ItemType } from '../../entities/batch/Item.js';
import type { RoutedBatchType } from '../../entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import { DAGError } from '../../errors/DAGError.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

export abstract class DecodeTextToolCallsNode<
  TState extends NodeStateInterface,
> extends MonadicNode<TState, 'decoded' | 'empty' | 'error'> {
  readonly outputs = ['decoded', 'empty', 'error'] as const;

  override get outputSchema(): Record<'decoded' | 'empty' | 'error', SchemaObjectType> {
    return {
      'decoded': { 'type': 'object' },
      'empty':   { 'type': 'object' },
      'error':   { 'type': 'object' },
    };
  }

  /**
   * Prefix for synthesized tool call ids. Default: `'agent'`.
   * Override as a getter when a subclass needs a different namespace.
   */
  protected get idPrefix(): string {
    return 'agent';
  }

  /** Read the model's raw text response from state. */
  protected abstract getText(
    state: TState,
    context: NodeContextType,
  ): string;

  /** Write the decoded tool calls back to state. */
  protected abstract storeToolCalls(
    state: TState,
    calls: readonly ToolCallType[],
    context: NodeContextType,
  ): void;

  override async execute(
    batch: Batch<TState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<'decoded' | 'empty' | 'error', TState>> {
    const acc = new Map<'decoded' | 'empty' | 'error', ItemType<TState>[]>();

    for (const item of batch) {
      const state = item.state;
      let output: NodeOutputType<'decoded' | 'empty' | 'error'>;

      try {
        const text = this.getText(state, context);
        if (text.trim().length === 0) {
          output = NodeOutputBuilder.of('empty');
        } else {
          const calls = ToolCallCodec.decode(text, this.idPrefix);
          this.storeToolCalls(state, calls, context);
          output = NodeOutputBuilder.of(calls.length > 0 ? 'decoded' : 'empty');
        }
      } catch (cause) {
        const error = DAGError.coerce(cause);
        output = NodeOutputBuilder.of('error', {
          'errors': [
            NodeErrorBuilder.from(
              'decodeTextToolCallsFailed',
              error.message,
              'DecodeTextToolCallsNode.execute',
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

    const routed = new Map<'decoded' | 'empty' | 'error', Batch<TState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }
}
