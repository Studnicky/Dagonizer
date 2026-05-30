/**
 * RecordFindingsNode: write the consumer's entities back into the
 * triple store as quads.
 *
 * Consumers override `selectEntities` (which entities from state to
 * record) and `toQuads` (turn one entity into a list of quads).
 */

import type { Quad } from '@noocodex/dagonizer/patterns';
import type { NodeContextInterface, NodeOutputInterface, NodeStateInterface } from '@noocodex/dagonizer';

import { GraphNode, type GraphServices } from './GraphNode.js';

export abstract class RecordFindingsNode<
  TState extends NodeStateInterface,
  TEntity,
  TOutput extends string = 'success',
> extends GraphNode<TState, TOutput> {
  protected abstract selectEntities(state: TState): readonly TEntity[];
  protected abstract toQuads(entity: TEntity): readonly Quad[];


  async execute(
    state: TState,
    context: NodeContextInterface<GraphServices>,
  ): Promise<NodeOutputInterface<TOutput>> {
    const entities = this.selectEntities(state);
    for (const entity of entities) {
      for (const q of this.toQuads(entity)) {
        context.services.memory.assert(q.subject, q.predicate, q.object, q.graph);
      }
    }
    return { 'output': this.successPort() };
  }
}
