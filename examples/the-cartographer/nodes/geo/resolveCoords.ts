import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import { CoordinateGeoResolver } from '../../services/CoordinateGeoResolver.ts';
import { CountryLocale } from '@studnicky/geo-resolver';
import {
  MonadicNode,
  RoutedBatch,
  type Batch,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region resolve-coords-node
export class ResolveCoordsNode extends MonadicNode<CartographerState, 'resolved'> {
  readonly '@id' = 'urn:noocodec:node:resolve-coords';
  readonly 'name' = 'resolve-coords';
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
        item.state.candidate = GeoResolutionBuilder.from({ 'source': 'coords', 'weight': 0 });
        continue;
      }

      const { timezone, country, countryName, water, waterBody } = CoordinateGeoResolver.resolve(raw.lat, raw.lng);
      const locale = country.length > 0 ? CountryLocale.forIso2(country) : '';
      const resolved = timezone.length > 0 || country.length > 0;

      item.state.candidate = GeoResolutionBuilder.from({
        'source':       'coords',
        'secondaryLookupUsed': false,
        'timezone':     timezone,
        'country':      country,
        'countryName':  countryName,
        'locale':       locale,
        'region':       '',
        'locality':     water ? waterBody : '',
        'lat':          raw.lat,
        'lng':          raw.lng,
        'status':       water ? 'water' : 'land',
        'weight':       resolved ? raw.weight : 0,
      });
    }
    return RoutedBatch.create('resolved', batch);
  }
}

export const resolveCoords = new ResolveCoordsNode();
// #endregion resolve-coords-node
