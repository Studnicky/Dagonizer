/**
 * RecallContextNode: SPARQL select against the memory store, map
 * bindings into the consumer's binding shape, write to state.
 *
 * Consumers override `composeQuery` (the SlotPattern) and `mapBindings`
 * (turn the raw bindings into their domain shape) plus `applyRecall`
 * (write the recalled context back to state).
 */

import { NodeOutputBuilder } from '@studnicky/dagonizer';
import type { BindingType, SlotPatternType } from '@studnicky/dagonizer/patterns';
import type { NodeContextType, NodeOutputType, NodeStateInterface } from '@studnicky/dagonizer/types';

import { GraphNode, type GraphServicesType } from './GraphNode.js';

export abstract class RecallContextNode<
  TState extends NodeStateInterface,
  TBinding,
> extends GraphNode<TState, 'success' | 'empty'> {
  protected abstract composeQuery(state: TState): SlotPatternType;
  protected abstract mapBindings(rows: readonly BindingType[]): readonly TBinding[];
  protected abstract applyRecall(state: TState, bindings: readonly TBinding[]): void;


  protected override async executeOne(
    state: TState,
    context: NodeContextType<GraphServicesType>,
  ): Promise<NodeOutputType<'success' | 'empty'>> {
    const pattern = this.composeQuery(state);
    const rows = context.services.memory.select(pattern);
    const bindings = this.mapBindings(rows);
    this.applyRecall(state, bindings);
    return NodeOutputBuilder.of(bindings.length === 0 ? 'empty' : 'success');
  }
}
