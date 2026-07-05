/**
 * MemoryDigestNode: assemble a structured digest of recent activity
 * from the triple store and write it to state.
 *
 * Consumers override `composeDigest` (compute the digest from the store)
 * and `applyDigest` (write it back to state).
 */

import { RoutedBatchBuilder } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType } from '@studnicky/dagonizer';
import type { TripleStoreInterface } from '@studnicky/dagonizer/patterns';
import type { NodeStateInterface } from '@studnicky/dagonizer/types';

import { GraphNode } from './GraphNode.js';

export abstract class MemoryDigestNode<
  TState extends NodeStateInterface,
  TDigest,
> extends GraphNode<TState, 'success'> {
  protected abstract composeDigest(store: TripleStoreInterface, state: TState): TDigest;
  protected abstract applyDigest(state: TState, digest: TDigest): void;


  override async execute(
    batch: Batch<TState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'success', TState>> {
    for (const item of batch) {
      const digest = this.composeDigest(this.memory, item.state);
      this.applyDigest(item.state, digest);
    }
    return RoutedBatchBuilder.of('success', batch);
  }
}
