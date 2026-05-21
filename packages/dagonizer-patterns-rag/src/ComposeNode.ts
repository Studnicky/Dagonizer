/**
 * ComposeNode — canonical "LLM produces prose" pattern.
 *
 * Build a prompt from state, call the LLM, take the response content,
 * write it to the consumer-named draft field, route to 'success' (or
 * a consumer-overridden port).
 *
 * Leaves narrow intent but share the dispatch loop:
 *   - ComposeResponseNode: general reply
 *   - ComposeEmptyResponseNode: no-data fallback
 *   - ComposeMemoryResponseNode: memory-recall variant
 *   - DeclineNode: polite refusal slant
 */

import { MonadicNode } from '@noocodex/dagonizer/patterns';
import type { ChatRequest, PartialChatRequest } from '@noocodex/dagonizer/adapter';
import { ChatRequestBuilder } from '@noocodex/dagonizer/adapter';
import type { NodeContextInterface, NodeOutputInterface } from '@noocodex/dagonizer';
import type { NodeStateInterface } from '@noocodex/dagonizer';

import type { RagServices } from './DecisionNode.js';

export abstract class ComposeNode<
  TState extends NodeStateInterface,
  TOutput extends string = 'success',
> extends MonadicNode<TState, TOutput, RagServices> {
  /** Build the prose-generation prompt from state. */
  protected abstract buildPrompt(state: TState): string;

  /** Write the generated draft back to state. */
  protected abstract applyDraft(state: TState, draft: string): void;

  /** Output port to route to once the draft is written. Default 'success'. */
  protected successPort(): TOutput {
    return 'success' as TOutput;
  }

  protected buildRequest(prompt: string, signal: AbortSignal): PartialChatRequest {
    return {
      'messages': [{ 'role': 'user', 'content': prompt, 'toolCallId': '', 'toolName': '' }],
      signal,
    };
  }

  async execute(
    state: TState,
    context: NodeContextInterface<RagServices>,
  ): Promise<NodeOutputInterface<TOutput>> {
    const prompt = this.buildPrompt(state);
    const request: ChatRequest = ChatRequestBuilder.from(this.buildRequest(prompt, context.signal));
    const response = await context.services.llm.chat(request);
    const draft = response.message.kind === 'tools' ? '' : response.message.content;
    this.applyDraft(state, draft);
    return { 'output': this.successPort() };
  }
}
