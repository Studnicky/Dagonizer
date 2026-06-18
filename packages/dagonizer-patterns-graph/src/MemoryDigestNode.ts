/**
 * MemoryDigestNode: assemble a structured digest of recent activity
 * from the triple store and write it to state.
 *
 * Consumers override `composeDigest` (compute the digest from the store)
 * and `applyDigest` (write it back to state).
 */

import { NodeOutputBuilder } from '@studnicky/dagonizer';
import type { TripleStore } from '@studnicky/dagonizer/patterns';
import type { NodeContextInterface, NodeOutputInterface, NodeStateInterface } from '@studnicky/dagonizer/types';

import { GraphNode, type GraphServices } from './GraphNode.js';

export abstract class MemoryDigestNode<
  TState extends NodeStateInterface,
  TDigest,
> extends GraphNode<TState, 'success'> {
  protected abstract composeDigest(store: TripleStore, state: TState): TDigest;
  protected abstract applyDigest(state: TState, digest: TDigest): void;


  protected override async executeOne(
    state: TState,
    context: NodeContextInterface<GraphServices>,
  ): Promise<NodeOutputInterface<'success'>> {
    const digest = this.composeDigest(context.services.memory, state);
    this.applyDigest(state, digest);
    return NodeOutputBuilder.of('success');
  }
}
