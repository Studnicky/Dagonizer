/**
 * PredicateGateNode: boolean gate. Routes to 'pass' / 'fail' based
 * on the consumer-supplied predicate.
 */

import type { Batch, NodeContextType, RoutedBatchType } from '@studnicky/dagonizer';
import type { NodeStateInterface } from '@studnicky/dagonizer/types';

import { FlowNode } from './FlowNode.js';

export abstract class PredicateGateNode<
  TState extends NodeStateInterface,
> extends FlowNode<TState, 'pass' | 'fail'> {
  readonly outputs = ['pass', 'fail'] as const;

  protected abstract predicate(state: TState): boolean;

  override async execute(
    batch: Batch<TState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'pass' | 'fail', TState>> {
    return batch.partition((state) => this.predicate(state) ? 'pass' : 'fail');
  }
}
