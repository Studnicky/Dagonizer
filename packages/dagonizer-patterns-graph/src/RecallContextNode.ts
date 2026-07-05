/**
 * RecallContextNode: SPARQL select against the memory store, map
 * bindings into the consumer's binding shape, write to state.
 *
 * Consumers override `composeQuery` (the SlotPattern) and `mapBindings`
 * (turn the raw bindings into their domain shape) plus `applyRecall`
 * (write the recalled context back to state).
 */

import { RoutedBatchBuilder } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType } from '@studnicky/dagonizer';
import type { BindingType, SlotPatternType } from '@studnicky/dagonizer/patterns';
import type { NodeStateInterface } from '@studnicky/dagonizer/types';

import { GraphNode } from './GraphNode.js';

export abstract class RecallContextNode<
  TState extends NodeStateInterface,
  TBinding,
> extends GraphNode<TState, 'success' | 'empty'> {
  protected abstract composeQuery(state: TState): SlotPatternType;
  protected abstract mapBindings(rows: readonly BindingType[]): readonly TBinding[];
  protected abstract applyRecall(state: TState, bindings: readonly TBinding[]): void;


  override async execute(
    batch: Batch<TState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'success' | 'empty', TState>> {
    const routed = batch.partition<'success' | 'empty'>((state) => {
      const pattern = this.composeQuery(state);
      const rows = this.memory.select(pattern);
      const bindings = this.mapBindings(rows);
      this.applyRecall(state, bindings);
      return bindings.length === 0 ? 'empty' : 'success';
    });
    return RoutedBatchBuilder.from([...routed]);
  }
}
