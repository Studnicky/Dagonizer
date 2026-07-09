import type { GeoResolution } from '../../entities/GeoResolution.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { CountryLocale } from '../../geo/CountryLocale.ts';
import { getCountry } from 'countries-and-timezones';

export class CountryCodeResolution {
  private constructor() {}

  static forIso2(iso2: string, source: GeoResolution['source'], weight: number): GeoResolution {
    const countryInfo = getCountry(iso2.toUpperCase());
    if (countryInfo === null) {
      return GeoResolutionBuilder.from({ 'source': source, 'weight': 0 });
    }
    const timezone = countryInfo.timezones[0] ?? '';
    const locale = CountryLocale.forIso2(iso2.toUpperCase());
    return GeoResolutionBuilder.from({
      'source':       source,
      'secondaryLookupUsed': false,
      'timezone':     timezone,
      'country':      iso2.toUpperCase(),
      'countryName':  countryInfo.name,
      'locale':       locale,
      'region':       '',
      'locality':     '',
      'lat':          0,
      'lng':          0,
      'status':       'land',
      'weight':       weight,
    });
  }
}
