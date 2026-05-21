/**
 * DecisionNode — canonical "agent consults the model and returns a
 * structured choice" pattern.
 *
 * The dispatch loop is the same regardless of decision shape: build a
 * prompt from state, call the LLM, parse the model's text into a
 * `TChoice`, route to an output port, write the choice back to state.
 * Subclasses inject the four domain-specific points via the abstract
 * methods.
 *
 * The four canonical leaves narrow TChoice:
 *   - ClassifyIntentNode: TChoice = TIntent ∈ token union
 *   - DecideToolsNode:    TChoice = readonly ToolCall[]
 *   - ValidateResponseNode: TChoice = 'yes' | 'no'
 *   - RankCandidatesNode: TChoice = readonly Score[]
 *
 * Consumers extend a named leaf for the common cases or extend
 * DecisionNode directly for novel decision shapes.
 */

import { MonadicNode } from '@noocodex/dagonizer/patterns';
import type { LlmClient } from '@noocodex/dagonizer/patterns';
import type {
  ChatRequest,
  PartialChatRequest,
} from '@noocodex/dagonizer/adapter';
import { ChatRequestBuilder } from '@noocodex/dagonizer/adapter';
import type { NodeContextInterface } from '@noocodex/dagonizer';
import type { NodeOutputInterface } from '@noocodex/dagonizer';
import type { NodeStateInterface } from '@noocodex/dagonizer';

export interface RagServices {
  readonly llm: LlmClient;
}

export abstract class DecisionNode<
  TState extends NodeStateInterface,
  TChoice,
  TOutput extends string = string,
> extends MonadicNode<TState, TOutput, RagServices> {
  /** Build the prompt the model decides against. Inject domain here. */
  protected abstract buildPrompt(state: TState): string;

  /** Parse the model's text response into a structured choice. */
  protected abstract parseChoice(content: string): TChoice;

  /** Route the choice to one of the declared output ports. */
  protected abstract routeFor(choice: TChoice): TOutput;

  /** Write the choice back to state. */
  protected abstract applyChoice(state: TState, choice: TChoice): void;

  /**
   * Optional overrides for chat request defaults (model selection,
   * temperature, etc.). Default returns just the prompt as a user
   * message.
   */
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

    const content = response.message.kind === 'tools' ? '' : response.message.content;
    const choice = this.parseChoice(content);
    this.applyChoice(state, choice);
    return { 'output': this.routeFor(choice) };
  }
}
