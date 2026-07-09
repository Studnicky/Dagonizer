import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import { GeohashTzMap } from '../../geo/GeohashTzMap.ts';
import { CoordTimezone } from '../../geo/CoordTimezone.ts';
import { CountryLocale } from '../../geo/CountryLocale.ts';
import {
  MonadicNode,
  RoutedBatch,
  type Batch,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

const GEO_TABLE = new GeohashTzMap();

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

      const result = GEO_TABLE.lookup(raw.lat, raw.lng);
      const tableResolved =
        result.timezone.length > 0 &&
        (result.country.length > 0 || result.waterBody.length > 0);

      if (tableResolved) {
        item.state.candidate = GeoResolutionBuilder.from({
          'source':       'coords',
          'secondaryLookupUsed': false,
          'timezone':     result.timezone,
          'country':      result.country,
          'countryName':  '',
          'locale':       result.locale,
          'region':       '',
          'locality':     result.waterBody.length > 0 ? result.waterBody : '',
          'lat':          raw.lat,
          'lng':          raw.lng,
          'status':       result.waterBody.length > 0 ? 'water' : 'land',
          'weight':       raw.weight,
        });
        continue;
      }

      const { timezone, country } = CoordTimezone.resolve(raw.lat, raw.lng);
      const locale = country.length > 0 ? CountryLocale.forIso2(country) : '';
      const secondaryLookupResolved = timezone.length > 0 || country.length > 0;

      item.state.candidate = GeoResolutionBuilder.from({
        'source':       'coords',
        'secondaryLookupUsed': true,
        'timezone':     timezone,
        'country':      country,
        'countryName':  '',
        'locale':       locale,
        'region':       '',
        'locality':     '',
        'lat':          raw.lat,
        'lng':          raw.lng,
        'status':       'land',
        'weight':       secondaryLookupResolved ? raw.weight : 0,
      });
    }
    return RoutedBatch.create('resolved', batch);
  }
}

export const resolveCoords = new ResolveCoordsNode();
// #endregion resolve-coords-node
