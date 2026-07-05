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

import { LlmDispatchNode } from './LlmDispatchNode.js';

import { Batch, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { ItemType, RoutedBatchType } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, NodeStateInterface } from '@studnicky/dagonizer/types';


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

  override async execute(
    batch: Batch<TState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<TOutput, TState>> {
    const acc = new Map<TOutput, ItemType<TState>[]>();

    for (const item of batch) {
      const state = item.state;
      const response = await this.dispatch(state, context);
      const content = this.extractContent(response);
      const choice = this.decodeChoice(content);
      this.applyChoice(state, choice);
      const output: NodeOutputType<TOutput> = NodeOutputBuilder.of(this.routeFor(choice));
      for (const error of output.errors) {
        state.collectError(error);
      }
      const bucket = acc.get(output.output);
      if (bucket !== undefined) {
        bucket.push(item);
      } else {
        acc.set(output.output, [item]);
      }
    }

    const routed = new Map<TOutput, Batch<TState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }
}
