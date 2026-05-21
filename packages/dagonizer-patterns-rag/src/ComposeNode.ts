/**
 * ComposeNode — "LLM produces prose" pattern. Extends LlmDispatchNode
 * for the shared request envelope; adds draft write-back.
 *
 * Leaves narrow intent but share the dispatch loop:
 *   - ComposeResponseNode: general reply
 *   - ComposeEmptyResponseNode: no-data fallback
 *   - ComposeMemoryResponseNode: memory-recall variant
 *   - DeclineNode: polite refusal slant
 */

import type { NodeContextInterface, NodeOutputInterface, NodeStateInterface } from '@noocodex/dagonizer';

import { LlmDispatchNode, type RagServices } from './LlmDispatchNode.js';

export abstract class ComposeNode<
  TState extends NodeStateInterface,
  TOutput extends string = 'success',
> extends LlmDispatchNode<TState, TOutput> {
  /** Write the generated draft back to state. */
  protected abstract applyDraft(state: TState, draft: string): void;

  /** Output port to route to once the draft is written. Default 'success'. */
  protected successPort(): TOutput {
    return 'success' as TOutput;
  }

  override async execute(
    state: TState,
    context: NodeContextInterface<RagServices>,
  ): Promise<NodeOutputInterface<TOutput>> {
    const response = await this.dispatch(state, context);
    const draft = response.message.kind === 'tools' ? '' : response.message.content;
    this.applyDraft(state, draft);
    return { 'output': this.successPort() };
  }
}
