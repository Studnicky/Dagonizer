import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import { LocaleTimezone } from '../../geo/LocaleTimezone.ts';
import { CountryLocale } from '../../geo/CountryLocale.ts';
import {
  NodeOutputBuilder,
  ScalarNode,
  type NodeContextType,
  type NodeOutputType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region resolve-locale-node
export class ResolveLocaleNode extends ScalarNode<CartographerState, 'resolved'> {
  readonly 'name' = 'resolve-locale';
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
      state.candidate = GeoResolutionBuilder.from({ 'source': 'locale', 'weight': 0 });
      return NodeOutputBuilder.of('resolved');
    }

    let country = '';
    try {
      country = new Intl.Locale(raw.localeTag).region ?? '';
    } catch {
      country = '';
    }

    const timezone = LocaleTimezone.toIana(raw.localeTag);
    const locale = CountryLocale.forIso2(country);

    state.candidate = GeoResolutionBuilder.from({
      'source':       'locale',
      'fallbackUsed': false,
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
    return NodeOutputBuilder.of('resolved');
  }
}

export const resolveLocale = new ResolveLocaleNode();
// #endregion resolve-locale-node
