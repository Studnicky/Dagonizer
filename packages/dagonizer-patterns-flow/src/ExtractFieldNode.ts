/**
 * ExtractFieldNode: copy a value from one state location to another.
 * Trivial-looking but useful when the canonical state shape buries a
 * field downstream nodes need at the top level.
 */

import { RoutedBatchBuilder } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType } from '@studnicky/dagonizer';
import type { NodeStateInterface } from '@studnicky/dagonizer/types';

import { FlowNode } from './FlowNode.js';

export abstract class ExtractFieldNode<
  TState extends NodeStateInterface,
  TValue,
> extends FlowNode<TState, 'success'> {
  readonly outputs = ['success'] as const;

  protected abstract extract(state: TState): TValue;
  protected abstract apply(state: TState, value: TValue): void;

  override async execute(
    batch: Batch<TState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'success', TState>> {
    for (const item of batch) {
      const value = this.extract(item.state);
      this.apply(item.state, value);
    }
    return RoutedBatchBuilder.of('success', batch);
  }
}
