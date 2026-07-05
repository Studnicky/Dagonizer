/**
 * ComposeNode: "LLM produces prose" pattern. Extends LlmDispatchNode
 * for the shared request envelope; adds draft write-back.
 *
 * Leaves narrow intent but share the dispatch loop:
 *   - ComposeResponseNode: general reply
 *   - ComposeEmptyResponseNode: no-data fallback
 *   - ComposeMemoryResponseNode: memory-recall variant
 *   - DeclineNode: polite refusal slant
 */

import { LlmDispatchNode } from './LlmDispatchNode.js';

import { Batch, BatchItemExecutor, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { ItemType, RoutedBatchType } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, NodeStateInterface } from '@studnicky/dagonizer/types';


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
      const output: NodeOutputType<'success'> = NodeOutputBuilder.of('success');

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
