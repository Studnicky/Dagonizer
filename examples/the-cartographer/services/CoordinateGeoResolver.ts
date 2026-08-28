import { feature } from '@rapideditor/country-coder';
import { GeohashTzMap } from '@studnicky/geo-resolver';
import tzLookup from 'tz-lookup';

const coordinateMap = GeohashTzMap.default();

export class CoordinateGeoResolver {
  private constructor() {}

  static resolve(latitude: number, longitude: number): {
    readonly country: string;
    readonly countryName: string;
    readonly timezone: string;
    readonly water: boolean;
    readonly waterBody: string;
  } {
    const valid =
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180;

    if (!valid) {
      return { 'country': '', 'countryName': '', 'timezone': '', 'water': false, 'waterBody': '' };
    }

    const mapped = coordinateMap.lookup(latitude, longitude);
    const water = mapped.waterBody.length > 0;
    const countryFeature = water
      ? null
      : feature([longitude, latitude], { 'level': 'country' });

    return {
      'country':     countryFeature?.properties.iso1A2 ?? '',
      'countryName': countryFeature?.properties.nameEn ?? '',
      'timezone':    tzLookup(latitude, longitude),
      'water':       water,
      'waterBody':   mapped.waterBody,
    };
  }
}
