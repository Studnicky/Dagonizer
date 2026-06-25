/**
 * CoordTimezone: browser-safe WGS-84 coordinate → IANA timezone + ISO country.
 *
 * Uses tz-lookup (nearest-neighbour IANA zone, browser-safe) for the timezone
 * and @rapideditor/country-coder for the ISO 3166-1 alpha-2 country code.
 *
 * Browser-safe: no node:fs, no node:path, no geo-tz, no Buffer.
 *
 * @module
 */
import tzlookup from 'tz-lookup';
import { iso1A2Code } from '@rapideditor/country-coder';

export class CoordTimezone {
  public static resolve(latitude: number, longitude: number): { timezone: string; country: string } {
    let timezone: string;
    try {
      timezone = tzlookup(latitude, longitude);
    } catch {
      timezone = '';
    }

    const countryCode = iso1A2Code([longitude, latitude], { level: 'country' });
    const country = countryCode ?? '';

    return { timezone: timezone, country: country };
  }
}
