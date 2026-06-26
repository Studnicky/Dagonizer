/**
 * generate-map.mjs — build-time Node ESM enricher (never imported by the app).
 *
 * Reads the source geo-tz data/tuples.json and widens every tuple from
 * [tzIdx, ctryIdx, wbIdx] → [tzIdx, ctryIdx, wbIdx, localeIdx], appending
 * a `locales` array to the output.  Writes the result to
 * geo/data/tuples.json (relative to this script's directory, i.e. one level up).
 *
 * Usage:
 *   node geo/scripts/generate-map.mjs [path/to/source/tuples.json]
 *
 * The default source path is:
 *   /Users/studs/Workspace/noocodec-bot/packages/geo-tz/data/tuples.json
 *
 * Idempotent: running twice produces the same output.
 *
 * NOTE — the .b64.json binary artifacts (geohash4.b64.json, overrides.b64.json)
 * were produced from the geo-tz package's geohash4.bin + overrides.bin artifacts,
 * which were generated from geo-tz + country-coder + Natural Earth polygons.
 * Those binaries are already embedded as base64 and are NOT touched by this script.
 * Tuple ordering MUST be preserved to keep the binary indices valid.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const scriptDir = dirname(fileURLToPath(import.meta.url));

const COUNTRY_LOCALE_PATH = join(scriptDir, '../data/countryLocale.json');
const COUNTRY_LOCALE = JSON.parse(readFileSync(COUNTRY_LOCALE_PATH, 'utf8'));

const DEFAULT_SOURCE = '/Users/studs/Workspace/noocodec-bot/packages/geo-tz/data/tuples.json';
const sourcePath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_SOURCE;

const outputPath = join(scriptDir, '../data/tuples.json');

const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
const { timezones, countries, waterBodies, tuples } = source;

// Build the locales array, index 0 MUST be '' (empty/unknown).
const localesList = [''];
const localeIndex = new Map();
localeIndex.set('', 0);

/** Derive locale string for a country code. */
function deriveLocale(country) {
  if (country === '' || country === undefined) return '';
  const mapped = COUNTRY_LOCALE[country];
  if (mapped !== undefined) return mapped;
  return `und-${country}`;
}

/** Get or insert locale, returning its index. */
function internLocale(locale) {
  const existing = localeIndex.get(locale);
  if (existing !== undefined) return existing;
  const idx = localesList.length;
  localesList.push(locale);
  localeIndex.set(locale, idx);
  return idx;
}

// Widen tuples from width-3 to width-4.
const widened = tuples.map(([tzIdx, ctryIdx, wbIdx]) => {
  const country = countries[ctryIdx] ?? '';
  const locale = deriveLocale(country);
  const localeIdx = internLocale(locale);
  return [tzIdx, ctryIdx, wbIdx, localeIdx];
});

const output = {
  timezones,
  countries,
  waterBodies,
  locales: localesList,
  tuples: widened,
};

writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(`Wrote ${outputPath}`);
console.log(`  tuples: ${widened.length}, locales: ${localesList.length}`);
