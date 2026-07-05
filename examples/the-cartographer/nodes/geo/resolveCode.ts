import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import { CountryCodeResolution } from './CountryCodeResolution.ts';
import {
  MonadicNode,
  RoutedBatchBuilder,
  type Batch,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region resolve-code-node
export class ResolveCodeNode extends MonadicNode<CartographerState, 'resolved'> {
  readonly 'name' = 'resolve-code';
  readonly 'outputs' = ['resolved'] as const;

  override get outputSchema(): Record<'resolved', SchemaObjectType> {
    return { 'resolved': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'resolved', CartographerState>> {
    for (const item of batch) {
      const raw = item.state.getMetadata('geo-signal');

      if (!GeoSignalDescriptorGuard.is(raw)) {
        item.state.candidate = GeoResolutionBuilder.from({ 'source': 'code', 'weight': 0 });
        continue;
      }

      item.state.candidate = CountryCodeResolution.forIso2(raw.countryCode, 'code', raw.weight);
    }
    return RoutedBatchBuilder.of('resolved', batch);
  }
}

export const resolveCode = new ResolveCodeNode();
// #endregion resolve-code-node
