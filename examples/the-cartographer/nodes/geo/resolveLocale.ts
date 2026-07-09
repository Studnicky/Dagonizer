import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import { LocaleTimezone } from '../../geo/LocaleTimezone.ts';
import { CountryLocale } from '../../geo/CountryLocale.ts';
import {
  MonadicNode,
  RoutedBatch,
  type Batch,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region resolve-locale-node
export class ResolveLocaleNode extends MonadicNode<CartographerState, 'resolved'> {
  readonly '@id' = 'urn:noocodec:node:resolve-locale';
  readonly 'name' = 'resolve-locale';
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
        item.state.candidate = GeoResolutionBuilder.from({ 'source': 'locale', 'weight': 0 });
        continue;
      }

      let country = '';
      try {
        country = new Intl.Locale(raw.localeTag).region ?? '';
      } catch {
        country = '';
      }

      const timezone = LocaleTimezone.toIana(raw.localeTag);
      const locale = CountryLocale.forIso2(country);

      item.state.candidate = GeoResolutionBuilder.from({
        'source':       'locale',
        'secondaryLookupUsed': false,
        'timezone':     timezone,
        'country':      country,
        'countryName':  '',
        'locale':       locale.length > 0 ? locale : raw.localeTag,
        'region':       '',
        'locality':     '',
        'lat':          0,
        'lng':          0,
        'status':       'land',
        'weight':       raw.weight,
      });
    }
    return RoutedBatch.create('resolved', batch);
  }
}

export const resolveLocale = new ResolveLocaleNode();
// #endregion resolve-locale-node
