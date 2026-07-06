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

import { Batch } from '../entities/batch/Batch.js';
import type { ItemType } from '../entities/batch/Item.js';
import type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { NodeOutputType } from '../entities/node/NodeOutput.js';
import { NodeOutput } from '../entities/node/NodeOutput.js';
import { BatchItemExecutor } from '../execution/BatchItemExecutor.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import { LlmDispatchNode } from './LlmDispatchNode.js';

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
    const results = await BatchItemExecutor.map(batch.items(), async (item) => {
      const state = item.state;
      const response = await this.dispatch(state, context);
      const content = this.extractContent(response);
      const choice = this.decodeChoice(content);
      this.applyChoice(state, choice);
      const output: NodeOutputType<TOutput> = NodeOutput.create(this.routeFor(choice));

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

    const routed = new Map<TOutput, Batch<TState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }
}
