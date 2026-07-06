/**
 * RespondNode: terminal node that writes the draft response to a
 * consumer-controlled location and marks the lifecycle completed.
 *
 * Subclasses declare exactly which state field holds the draft by
 * implementing `extractDraft`. This keeps the type contract explicit
 * and removes convention-coupled casts from the base.
 */

import { RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType } from '@studnicky/dagonizer';
import type { NodeStateInterface } from '@studnicky/dagonizer/types';

import { FlowNode } from './FlowNode.js';

export abstract class RespondNode<
  TState extends NodeStateInterface,
> extends FlowNode<TState, 'success'> {
  readonly outputs = ['success'] as const;

  /**
   * Extract the draft string from state. Each subclass declares the
   * exact field it reads; no convention-based casts in the base.
   */
  protected abstract extractDraft(state: TState): string;

  protected abstract emit(state: TState, draft: string): void;

  override async execute(
    batch: Batch<TState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'success', TState>> {
    for (const item of batch) {
      this.emit(item.state, this.extractDraft(item.state));
    }
    return RoutedBatch.create('success', batch);
  }
}
