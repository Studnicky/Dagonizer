/**
 * MemoryDigestNode: assemble a structured digest of recent activity
 * from the triple store and write it to state.
 *
 * Consumers override `buildDigest` (compute the digest from the store)
 * and `applyDigest` (write it back to state).
 */

import type { NodeContextInterface, NodeOutputInterface, NodeStateInterface } from '@noocodex/dagonizer';
import { NodeOutputBuilder } from '@noocodex/dagonizer';
import type { TripleStore } from '@noocodex/dagonizer/patterns';

import { GraphNode, type GraphServices } from './GraphNode.js';

export abstract class MemoryDigestNode<
  TState extends NodeStateInterface,
  TDigest,
> extends GraphNode<TState, 'success'> {
  protected abstract buildDigest(store: TripleStore, state: TState): TDigest;
  protected abstract applyDigest(state: TState, digest: TDigest): void;


  async execute(
    state: TState,
    context: NodeContextInterface<GraphServices>,
  ): Promise<NodeOutputInterface<'success'>> {
    const digest = this.buildDigest(context.services.memory, state);
    this.applyDigest(state, digest);
    return NodeOutputBuilder.of(this.successPort());
  }
}
