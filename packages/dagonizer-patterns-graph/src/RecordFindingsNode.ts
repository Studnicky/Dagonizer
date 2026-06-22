/**
 * RecordFindingsNode: write the consumer's entities back into the
 * triple store as quads.
 *
 * Consumers override `selectEntities` (which entities from state to
 * record) and `toQuads` (turn one entity into a list of quads).
 */

import { DAGError, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { QuadType } from '@studnicky/dagonizer/patterns';
import type { NodeContextType, NodeOutputType, NodeStateInterface } from '@studnicky/dagonizer/types';

import { GraphNode, type GraphServicesType } from './GraphNode.js';

export abstract class RecordFindingsNode<
  TState extends NodeStateInterface,
  TEntity,
> extends GraphNode<TState, 'success'> {
  protected abstract selectEntities(state: TState): readonly TEntity[];
  protected abstract toQuads(entity: TEntity): readonly QuadType[];


  protected override async executeOne(
    state: TState,
    context: NodeContextType<GraphServicesType>,
  ): Promise<NodeOutputType<'success'>> {
    const entities = this.selectEntities(state);
    const services = context.services;
    if (services === undefined) {
      throw new DAGError('RecordFindingsNode requires a services record carrying a `memory` store; the dispatcher was constructed without `services`.');
    }
    for (const entity of entities) {
      for (const q of this.toQuads(entity)) {
        services.memory.assert(q.subject, q.predicate, q.object, q.graph);
      }
    }
    return NodeOutputBuilder.of('success');
  }
}
