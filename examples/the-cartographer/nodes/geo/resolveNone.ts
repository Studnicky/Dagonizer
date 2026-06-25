import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import {
  NodeOutputBuilder,
  ScalarNode,
  type NodeContextType,
  type NodeOutputType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region resolve-none-node
export class ResolveNoneNode extends ScalarNode<CartographerState, 'resolved'> {
  readonly 'name' = 'resolve-none';
  readonly 'outputs' = ['resolved'] as const;

  override get outputSchema(): Record<'resolved', SchemaObjectType> {
    return { 'resolved': { 'type': 'object' } };
  }

  protected override async executeOne(
    state: CartographerState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'resolved'>> {
    state.candidate = GeoResolutionBuilder.from({ 'source': 'none', 'weight': 0 });
    return NodeOutputBuilder.of('resolved');
  }
}

export const resolveNone = new ResolveNoneNode();
// #endregion resolve-none-node
