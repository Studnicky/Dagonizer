/**
 * MemoryDigestNode: assemble a structured digest of recent activity
 * from the triple store and write it to state.
 *
 * Consumers override `composeDigest` (compute the digest from the store)
 * and `applyDigest` (write it back to state).
 */

import { DAGError, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { TripleStoreInterface } from '@studnicky/dagonizer/patterns';
import type { NodeContextType, NodeOutputType, NodeStateInterface } from '@studnicky/dagonizer/types';

import { GraphNode, type GraphServicesType } from './GraphNode.js';

export abstract class MemoryDigestNode<
  TState extends NodeStateInterface,
  TDigest,
> extends GraphNode<TState, 'success'> {
  protected abstract composeDigest(store: TripleStoreInterface, state: TState): TDigest;
  protected abstract applyDigest(state: TState, digest: TDigest): void;


  protected override async executeOne(
    state: TState,
    context: NodeContextType<GraphServicesType>,
  ): Promise<NodeOutputType<'success'>> {
    const services = context.services;
    if (services === undefined) {
      throw new DAGError('MemoryDigestNode requires a services record carrying a `memory` store; the dispatcher was constructed without `services`.');
    }
    const digest = this.composeDigest(services.memory, state);
    this.applyDigest(state, digest);
    return NodeOutputBuilder.of('success');
  }
}
