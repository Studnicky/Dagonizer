import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import { GeohashTzMap } from '../../geo/GeohashTzMap.ts';
import { CoordTimezone } from '../../geo/CoordTimezone.ts';
import { CountryLocale } from '../../geo/CountryLocale.ts';
import {
  NodeOutputBuilder,
  ScalarNode,
  type NodeContextType,
  type NodeOutputType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

const GEO_TABLE = new GeohashTzMap();

// #region resolve-coords-node
export class ResolveCoordsNode extends ScalarNode<CartographerState, 'resolved'> {
  readonly 'name' = 'resolve-coords';
  readonly 'outputs' = ['resolved'] as const;

  override get outputSchema(): Record<'resolved', SchemaObjectType> {
    return { 'resolved': { 'type': 'object' } };
  }

  protected override async executeOne(
    state: CartographerState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'resolved'>> {
    const raw = state.getMetadata('geo-signal');

    if (!GeoSignalDescriptorGuard.is(raw)) {
      state.candidate = GeoResolutionBuilder.from({ 'source': 'coords', 'weight': 0 });
      return NodeOutputBuilder.of('resolved');
    }

    const result = GEO_TABLE.lookup(raw.lat, raw.lng);
    const tableResolved =
      result.timezone.length > 0 &&
      (result.country.length > 0 || result.waterBody.length > 0);

    if (tableResolved) {
      state.candidate = GeoResolutionBuilder.from({
        'source':       'coords',
        'fallbackUsed': false,
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
      return NodeOutputBuilder.of('resolved');
    }

    const { timezone, country } = CoordTimezone.resolve(raw.lat, raw.lng);
    const locale = country.length > 0 ? CountryLocale.forIso2(country) : '';
    const fallbackResolved = timezone.length > 0 || country.length > 0;

    state.candidate = GeoResolutionBuilder.from({
      'source':       'coords',
      'fallbackUsed': true,
      'timezone':     timezone,
      'country':      country,
      'countryName':  '',
      'locale':       locale,
      'region':       '',
      'locality':     '',
      'lat':          raw.lat,
      'lng':          raw.lng,
      'status':       'land',
      'weight':       fallbackResolved ? raw.weight : 0,
    });
    return NodeOutputBuilder.of('resolved');
  }
}

export const resolveCoords = new ResolveCoordsNode();
// #endregion resolve-coords-node
