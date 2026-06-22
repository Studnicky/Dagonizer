/**
 * PredicateGateNode: boolean gate. Routes to 'pass' / 'fail' based
 * on the consumer-supplied predicate.
 */

import { NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeOutputType, NodeStateInterface } from '@studnicky/dagonizer/types';

import { FlowNode } from './FlowNode.js';

export abstract class PredicateGateNode<
  TState extends NodeStateInterface,
> extends FlowNode<TState, 'pass' | 'fail'> {
  readonly outputs = ['pass', 'fail'] as const;

  protected abstract predicate(state: TState): boolean;

  protected override async executeOne(
    state: TState,
  ): Promise<NodeOutputType<'pass' | 'fail'>> {
    return NodeOutputBuilder.of(this.predicate(state) ? 'pass' : 'fail');
  }
}
