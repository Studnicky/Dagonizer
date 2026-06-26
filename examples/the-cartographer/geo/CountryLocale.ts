/**
 * CountryLocale: ISO 3166-1 alpha-2 → primary BCP-47 locale tag.
 *
 * Backed by geo/data/countryLocale.json — a single source of truth shared with
 * the build-time generate-map.mjs enricher.
 *
 * Browser-safe: JSON static import only.
 *
 * @module
 */
import LOCALE_MAP from './data/countryLocale.json' with { type: 'json' };

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const LOCALE_DATA: Record<string, string> = isStringRecord(LOCALE_MAP) ? LOCALE_MAP : {};

export class CountryLocale {
  public static forIso2(code: string): string {
    return LOCALE_DATA[code.toUpperCase()] ?? '';
  }
}
