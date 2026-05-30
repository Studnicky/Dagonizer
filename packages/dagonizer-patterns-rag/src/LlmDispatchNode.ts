/**
 * LlmDispatchNode: shared parent for any pattern that consults the
 * LLM and produces some result.
 *
 * Owns the request construction + LLM-call protocol so leaves don't
 * duplicate it. `DecisionNode` and `ComposeNode` both extend this:
 * they differ in how they consume the response (structured choice vs
 * prose) but the request side is identical.
 *
 *   MonadicNode
 *   └── LlmDispatchNode<TState, TOutput, RagServices>   (this)
 *       ├── DecisionNode (parses TChoice, applies, routes)
 *       └── ComposeNode (writes draft, routes 'success')
 *
 * Subclasses override `dispatch(state, context)` to turn the chat
 * response into a node output.
 */

import { MonadicNode } from '@noocodex/dagonizer/patterns';
import type { LlmClient } from '@noocodex/dagonizer/patterns';
import { ChatRequestBuilder } from '@noocodex/dagonizer/adapter';
import type { ChatRequest, ChatResponse, PartialChatRequest } from '@noocodex/dagonizer/adapter';
import type { NodeContextInterface, NodeOutputInterface, NodeStateInterface } from '@noocodex/dagonizer';

export interface RagServices {
  readonly llm: LlmClient;
}

export abstract class LlmDispatchNode<
  TState extends NodeStateInterface,
  TOutput extends string,
> extends MonadicNode<TState, TOutput, RagServices> {
  /** Build the user prompt from state. */
  protected abstract buildPrompt(state: TState): string;

  /**
   * Optional hook to override the request envelope (model selection,
   * temperature, etc.). Default packs the prompt as a single user
   * message; signal flows from the dispatcher context.
   */
  protected buildRequest(prompt: string, signal: AbortSignal): PartialChatRequest {
    return {
      'messages': [{ 'role': 'user', 'content': prompt, 'toolCallId': '', 'toolName': '' }],
      signal,
    };
  }

  /** Send the request through the configured LLM. */
  protected async dispatch(state: TState, context: NodeContextInterface<RagServices>): Promise<ChatResponse> {
    const prompt = this.buildPrompt(state);
    const request: ChatRequest = ChatRequestBuilder.from(this.buildRequest(prompt, context.signal));
    return context.services.llm.chat(request);
  }

  /** Leaves provide their own execute(); the dispatch loop is shared. */
  abstract override execute(
    state: TState,
    context: NodeContextInterface<RagServices>,
  ): Promise<NodeOutputInterface<TOutput>>;
}
