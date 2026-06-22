/**
 * MemoryDigestNode: assemble a structured digest of recent activity
 * from the triple store and write it to state.
 *
 * Consumers override `composeDigest` (compute the digest from the store)
 * and `applyDigest` (write it back to state).
 */

import { NodeOutputBuilder } from '@studnicky/dagonizer';
import type { TripleStoreInterface } from '@studnicky/dagonizer/patterns';
import type { NodeContextType, NodeOutputType, NodeStateInterface } from '@studnicky/dagonizer/types';

import { GraphNode } from './GraphNode.js';

export abstract class MemoryDigestNode<
  TState extends NodeStateInterface,
  TDigest,
> extends GraphNode<TState, 'success'> {
  protected abstract composeDigest(store: TripleStoreInterface, state: TState): TDigest;
  protected abstract applyDigest(state: TState, digest: TDigest): void;


  protected override async executeOne(
    state: TState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'success'>> {
    const digest = this.composeDigest(this.memory, state);
    this.applyDigest(state, digest);
    return NodeOutputBuilder.of('success');
  }
}
