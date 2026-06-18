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

import { ScalarNode } from '@studnicky/dagonizer';
import { ChatRequestBuilder } from '@studnicky/dagonizer/adapter';
import type { ChatRequest, ChatResponse, PartialChatRequest } from '@studnicky/dagonizer/adapter';
import type { LlmClient } from '@studnicky/dagonizer/patterns';
import type { NodeContextInterface, NodeOutputInterface, NodeStateInterface } from '@studnicky/dagonizer/types';

export interface RagServices {
  readonly llm: LlmClient;
}

export abstract class LlmDispatchNode<
  TState extends NodeStateInterface,
  TOutput extends string,
> extends ScalarNode<TState, TOutput, RagServices> {
  /** Build the user prompt from state. */
  protected abstract composePrompt(state: TState): string;

  /**
   * Optional hook to override the request envelope (model selection,
   * temperature, etc.). Default packs the prompt as a single user
   * message; signal flows from the dispatcher context.
   *
   * Non-tool messages (system/user/assistant) must not carry
   * `toolCallId`/`toolName` — the `ChatMessageSchema` `oneOf` enforces
   * `additionalProperties: false` on the non-tool branch.
   */
  protected composeRequest(prompt: string, signal: AbortSignal): PartialChatRequest {
    return {
      'messages': [{ 'role': 'user', 'content': prompt }],
      signal,
    };
  }

  /** Send the request through the configured LLM. */
  protected async dispatch(state: TState, context: NodeContextInterface<RagServices>): Promise<ChatResponse> {
    const prompt = this.composePrompt(state);
    const request: ChatRequest = ChatRequestBuilder.from(this.composeRequest(prompt, context.signal));
    return context.services.llm.chat(request);
  }

  /**
   * Extract prose from a chat response. The response message is a
   * discriminated union: a `tools`-only message carries no prose, so it
   * yields the empty string; `text` and `mixed` messages carry `content`.
   */
  protected extractContent(response: ChatResponse): string {
    return response.message.kind === 'tools' ? '' : response.message.content;
  }

  /** Leaves provide their own executeOne(); the dispatch loop is shared. */
  protected abstract override executeOne(
    state: TState,
    context: NodeContextInterface<RagServices>,
  ): Promise<NodeOutputInterface<TOutput>>;
}
