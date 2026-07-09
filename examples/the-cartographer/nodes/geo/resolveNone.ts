import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import {
  MonadicNode,
  RoutedBatch,
  type Batch,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region resolve-none-node
export class ResolveNoneNode extends MonadicNode<CartographerState, 'resolved'> {
  readonly '@id' = 'urn:noocodec:node:resolve-none';
  readonly 'name' = 'resolve-none';
  readonly 'outputs' = ['resolved'] as const;

  override get outputSchema(): Record<'resolved', SchemaObjectType> {
    return { 'resolved': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'resolved', CartographerState>> {
    for (const item of batch) {
      item.state.candidate = GeoResolutionBuilder.from({ 'source': 'none', 'weight': 0 });
    }
    return RoutedBatch.create('resolved', batch);
  }
}

export const resolveNone = new ResolveNoneNode();
// #endregion resolve-none-node
