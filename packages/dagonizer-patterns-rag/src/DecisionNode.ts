/**
 * DecisionNode — "agent consults the model and returns a structured
 * choice" pattern. Extends LlmDispatchNode for the shared request
 * envelope; adds choice parsing, port routing, state write-back.
 *
 * The four canonical leaves narrow TChoice:
 *   - ClassifyIntentNode: TChoice = TIntent ∈ token union
 *   - DecideToolsNode:    TChoice = readonly ToolCall[]
 *   - ValidateResponseNode: TChoice = 'yes' | 'no'
 *   - RankCandidatesNode: TChoice = readonly Score[]
 */

import type { NodeContextInterface, NodeOutputInterface, NodeStateInterface } from '@noocodex/dagonizer';

import { LlmDispatchNode, type RagServices } from './LlmDispatchNode.js';

export { type RagServices };

export abstract class DecisionNode<
  TState extends NodeStateInterface,
  TChoice,
  TOutput extends string = string,
> extends LlmDispatchNode<TState, TOutput> {
  /** Parse the model's text response into a structured choice. */
  protected abstract parseChoice(content: string): TChoice;

  /** Route the choice to one of the declared output ports. */
  protected abstract routeFor(choice: TChoice): TOutput;

  /** Write the choice back to state. */
  protected abstract applyChoice(state: TState, choice: TChoice): void;

  override async execute(
    state: TState,
    context: NodeContextInterface<RagServices>,
  ): Promise<NodeOutputInterface<TOutput>> {
    const response = await this.dispatch(state, context);
    const content = response.message.kind === 'tools' ? '' : response.message.content;
    const choice = this.parseChoice(content);
    this.applyChoice(state, choice);
    return { 'output': this.routeFor(choice) };
  }
}
