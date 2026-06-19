/**
 * DecisionNode: "agent consults the model and returns a structured
 * choice" pattern. Extends LlmDispatchNode for the shared request
 * envelope; adds choice parsing, port routing, state write-back.
 *
 * The four canonical leaves narrow TChoice:
 *   - ClassifyIntentNode: TChoice = TIntent ∈ token union
 *   - DecideToolsNode:    TChoice = readonly ToolCall[]
 *   - ValidateResponseNode: TChoice = 'yes' | 'no'
 *   - RankCandidatesNode: TChoice = readonly ScoreType[]
 */

import { NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, NodeStateInterface } from '@studnicky/dagonizer/types';

import { LlmDispatchNode } from './LlmDispatchNode.js';
import type { RagServicesType } from './LlmDispatchNode.js';

export abstract class DecisionNode<
  TState extends NodeStateInterface,
  TChoice,
  TOutput extends string = string,
> extends LlmDispatchNode<TState, TOutput> {
  /** Parse the model's text response into a structured choice. */
  protected abstract decodeChoice(content: string): TChoice;

  /** Route the choice to one of the declared output ports. */
  protected abstract routeFor(choice: TChoice): TOutput;

  /** Write the choice back to state. */
  protected abstract applyChoice(state: TState, choice: TChoice): void;

  protected override async executeOne(
    state: TState,
    context: NodeContextType<RagServicesType>,
  ): Promise<NodeOutputType<TOutput>> {
    const response = await this.dispatch(state, context);
    const content = this.extractContent(response);
    const choice = this.decodeChoice(content);
    this.applyChoice(state, choice);
    return NodeOutputBuilder.of(this.routeFor(choice));
  }
}
