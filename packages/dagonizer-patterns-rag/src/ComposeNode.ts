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

import type { NodeContextInterface, NodeOutputInterface, NodeStateInterface } from '@studnicky/dagonizer';
import { NodeOutputBuilder } from '@studnicky/dagonizer';

import { LlmDispatchNode, type RagServices } from './LlmDispatchNode.js';

export abstract class ComposeNode<
  TState extends NodeStateInterface,
> extends LlmDispatchNode<TState, 'success'> {
  /** Write the generated draft back to state. */
  protected abstract applyDraft(state: TState, draft: string): void;

  protected override async executeOne(
    state: TState,
    context: NodeContextInterface<RagServices>,
  ): Promise<NodeOutputInterface<'success'>> {
    const response = await this.dispatch(state, context);
    const draft = response.message.kind === 'tools' ? '' : response.message.content;
    this.applyDraft(state, draft);
    return NodeOutputBuilder.of('success');
  }
}
