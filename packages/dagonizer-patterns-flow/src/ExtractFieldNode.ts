/**
 * ExtractFieldNode: copy a value from one state location to another.
 * Trivial-looking but useful when the canonical state shape buries a
 * field downstream nodes need at the top level.
 */

import type { NodeContextInterface, NodeOutputInterface, NodeStateInterface } from '@noocodex/dagonizer';

import { FlowNode } from './FlowNode.js';

export abstract class ExtractFieldNode<
  TState extends NodeStateInterface,
  TValue,
> extends FlowNode<TState, 'success'> {
  readonly outputs = ['success'] as const;

  protected abstract extract(state: TState): TValue;
  protected abstract apply(state: TState, value: TValue): void;

  async execute(
    state: TState,
    _context: NodeContextInterface<undefined>,
  ): Promise<NodeOutputInterface<'success'>> {
    const value = this.extract(state);
    this.apply(state, value);
    return { 'output': 'success' };
  }
}
