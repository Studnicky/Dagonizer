/**
 * ComposeNode: "LLM produces prose" pattern. Extends LlmDispatchNode
 * for the shared request envelope; adds draft write-back.
 *
 * Leaves narrow intent but share the dispatch loop:
 *   - ComposeResponseNode: general reply
 *   - ComposeEmptyResponseNode: no-data response path
 *   - ComposeMemoryResponseNode: memory-recall variant
 *   - DeclineNode: polite refusal slant
 */

import { Batch } from '../entities/batch/Batch.js';
import type { ItemType } from '../entities/batch/Item.js';
import type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { NodeOutputType } from '../entities/node/NodeOutput.js';
import { NodeOutput } from '../entities/node/NodeOutput.js';
import { BatchItemExecutor } from '../execution/BatchItemExecutor.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import { LlmDispatchNode } from './LlmDispatchNode.js';

export abstract class ComposeNode<
  TState extends NodeStateInterface,
> extends LlmDispatchNode<TState, 'success'> {
  /** Write the generated draft back to state. */
  protected abstract applyDraft(state: TState, draft: string): void;

  override async execute(
    batch: Batch<TState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<'success', TState>> {
    const acc = new Map<'success', ItemType<TState>[]>();
    const results = await BatchItemExecutor.map(batch.items(), async (item) => {
      const state = item.state;
      const response = await this.dispatch(state, context);
      const draft = this.extractContent(response);
      this.applyDraft(state, draft);
      const output: NodeOutputType<'success'> = NodeOutput.create('success');

      for (const error of output.errors) {
        state.collectError(error);
      }
      return { item, output };
    }, this.execution, context.signal);

    for (const result of results) {
      const bucket = acc.get(result.output.output);
      if (bucket !== undefined) {
        bucket.push(result.item);
      } else {
        acc.set(result.output.output, [result.item]);
      }
    }

    const routed = new Map<'success', Batch<TState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }
}
