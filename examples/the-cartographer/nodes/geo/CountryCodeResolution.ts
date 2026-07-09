import type { GeoResolution } from '../../entities/GeoResolution.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { CountryLocale } from '@studnicky/geo-resolver';
import { CountryCodes } from '../../services.ts';
import { getCountry } from 'countries-and-timezones';

export class CountryCodeResolution {
  private constructor() {}

  static forCountryCode(countryCode: string, source: GeoResolution['source'], weight: number): GeoResolution {
    const iso2 = CountryCodes.toIso2(countryCode);
    const countryInfo = iso2.length > 0 ? getCountry(iso2) : null;
    if (countryInfo === null) {
      return GeoResolutionBuilder.from({ 'source': source, 'weight': 0 });
    }
    const timezone = countryInfo.timezones[0] ?? '';
    const locale = CountryLocale.forIso2(iso2);
    return GeoResolutionBuilder.from({
      'source':       source,
      'secondaryLookupUsed': false,
      'timezone':     timezone,
      'country':      iso2,
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
