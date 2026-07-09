import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import { CallingCode } from '../../geo/CallingCode.ts';
import { CountryCodeResolution } from './CountryCodeResolution.ts';
import {
  MonadicNode,
  RoutedBatch,
  type Batch,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region resolve-phone-node
export class ResolvePhoneNode extends MonadicNode<CartographerState, 'resolved'> {
  readonly '@id' = 'urn:noocodec:node:resolve-phone';
  readonly 'name' = 'resolve-phone';
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
        item.state.candidate = GeoResolutionBuilder.from({ 'source': 'phone', 'weight': 0 });
        continue;
      }

      const iso2 = CallingCode.countryFor(raw.phone);
      if (iso2 === '') {
        item.state.candidate = GeoResolutionBuilder.from({ 'source': 'phone', 'weight': 0 });
      } else {
        item.state.candidate = CountryCodeResolution.forIso2(iso2, 'phone', raw.weight);
      }
    }
    return RoutedBatch.create('resolved', batch);
  }
}

export const resolvePhone = new ResolvePhoneNode();
// #endregion resolve-phone-node
