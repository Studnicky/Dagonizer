/**
 * RecallContextNode: SPARQL select against the memory store, map
 * bindings into the consumer's binding shape, write to state.
 *
 * Consumers override `buildQuery` (the SlotPattern) and `mapBindings`
 * (turn the raw bindings into their domain shape) plus `applyRecall`
 * (write the recalled context back to state).
 */

import type { Binding, SlotPattern } from '@noocodex/dagonizer/patterns';
import type { NodeContextInterface, NodeOutputInterface, NodeStateInterface } from '@noocodex/dagonizer';
import { NodeOutputBuilder } from '@noocodex/dagonizer';

import { GraphNode, type GraphServices } from './GraphNode.js';

export abstract class RecallContextNode<
  TState extends NodeStateInterface,
  TBinding,
> extends GraphNode<TState, 'success' | 'empty'> {
  protected abstract buildQuery(state: TState): SlotPattern;
  protected abstract mapBindings(rows: readonly Binding[]): readonly TBinding[];
  protected abstract applyRecall(state: TState, bindings: readonly TBinding[]): void;


  async execute(
    state: TState,
    context: NodeContextInterface<GraphServices>,
  ): Promise<NodeOutputInterface<'success' | 'empty'>> {
    const pattern = this.buildQuery(state);
    const rows = context.services.memory.select(pattern);
    const bindings = this.mapBindings(rows);
    this.applyRecall(state, bindings);
    return NodeOutputBuilder.of(bindings.length === 0 ? 'empty' : 'success');
  }
}
