/**
 * BCP-47 locale tag → primary IANA timezone for the tag's region subtag.
 *
 * **Confidence note:** locale→timezone is LOW-CONFIDENCE by design.
 * A country code identifies a political boundary that may span multiple IANA
 * zones (e.g. US has ~6, Russia has ~11). Returns the FIRST timezone in
 * `countries-and-timezones`'s ordered list for the country, which is the most
 * commonly referenced primary zone. For precise per-user timezone resolution,
 * prefer a coordinate-based lookup and store the result explicitly.
 *
 * Browser-safe: uses only `Intl.Locale` (built-in ECMA-402) and
 * `countries-and-timezones` (pure JS, no Node APIs).
 *
 * @module
 */
import { getCountry } from 'countries-and-timezones';

// ---------------------------------------------------------------------------
// Public domain object — one exported symbol per file
// ---------------------------------------------------------------------------

/**
 * Maps a BCP-47 locale tag to the primary IANA timezone for the tag's region.
 *
 * All methods are pure and stateless.
 */
export class LocaleTimezone {
  /**
   * Returns the primary IANA timezone for the region subtag of a BCP-47 tag.
   *
   * Resolution steps:
   *   1. Parse the tag with `new Intl.Locale(tag)` — invalid tag → `''`.
   *   2. Extract `.region` — absent (e.g. `'en'` with no subtag) → `''`.
   *   3. Look up the country in `countries-and-timezones` → first timezone.
   *   4. Unknown country code → `''`.
   *
   * @param localeTag BCP-47 locale tag, e.g. `'en-US'`, `'ja-JP'`, `'en'`.
   * @returns Primary IANA zone string, or `''` when unresolvable.
   */
  public static toIana(localeTag: string): string {
    let region: string | undefined;
    try {
      region = new Intl.Locale(localeTag).region;
    } catch {
      return '';
    }
    if (region === undefined || region === '') {
      return '';
    }

    const countryInfo = getCountry(region);
    if (countryInfo === null) {
      return '';
    }

    return countryInfo.timezones[0] ?? '';
  }
}
