/**
 * Unit tests for GeohashTzMap and LocaleTimezone.
 *
 * Uses hardcoded expectations derived from the geo-tz source test suite.
 * Validates that the browser-safe decoder reads the embedded binary artifacts
 * identically to the original Node-based implementation.
 *
 * No geo-tz oracle dependency — expectations are fixed constants.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GeohashTzMap } from '../../geo/GeohashTzMap.ts';
import { LocaleTimezone } from '../../geo/LocaleTimezone.ts';

// ---------------------------------------------------------------------------
// GeohashTzMap
// ---------------------------------------------------------------------------

describe('GeohashTzMap', () => {
  // Construct once — all fields set at construction (monomorphic shape).
  const tzMap = new GeohashTzMap();

  it('NYC (40.7128, -74.006) → America/New_York, US, waterBody=""', () => {
    const result = tzMap.lookup(40.7128, -74.006);
    assert.equal(result.timezone, 'America/New_York');
    assert.equal(result.country, 'US');
    assert.equal(result.waterBody, '');
  });

  it('London (51.5074, -0.1278) → Europe/London, GB, waterBody=""', () => {
    const result = tzMap.lookup(51.5074, -0.1278);
    assert.equal(result.timezone, 'Europe/London');
    assert.equal(result.country, 'GB');
    assert.equal(result.waterBody, '');
  });

  it('Tokyo (35.68, 139.69) → Asia/Tokyo, JP', () => {
    const result = tzMap.lookup(35.68, 139.69);
    assert.equal(result.timezone, 'Asia/Tokyo');
    assert.equal(result.country, 'JP');
  });

  it('Sydney (-33.87, 151.21) → Australia/Sydney, AU', () => {
    const result = tzMap.lookup(-33.87, 151.21);
    assert.equal(result.timezone, 'Australia/Sydney');
    assert.equal(result.country, 'AU');
  });

  it('mid-Atlantic (30, -40) → non-empty waterBody', () => {
    const result = tzMap.lookup(30, -40);
    assert.ok(result.waterBody.length > 0, `expected non-empty waterBody, got: ${JSON.stringify(result.waterBody)}`);
  });

  it('Lake Michigan (43.5, -87) → waterBody contains "michigan" (case-insensitive)', () => {
    const result = tzMap.lookup(43.5, -87);
    assert.ok(
      result.waterBody.toLowerCase().includes('michigan'),
      `expected waterBody to include 'michigan', got: ${JSON.stringify(result.waterBody)}`,
    );
  });

  // Locale assertions — values read directly from the generated tuples.json
  it('NYC locale → en-US', () => {
    const result = tzMap.lookup(40.7128, -74.006);
    assert.equal(result.locale, 'en-US');
  });

  it('London locale → en-GB', () => {
    const result = tzMap.lookup(51.5074, -0.1278);
    assert.equal(result.locale, 'en-GB');
  });

  it('Tokyo locale → ja-JP', () => {
    const result = tzMap.lookup(35.68, 139.69);
    assert.equal(result.locale, 'ja-JP');
  });
});

// ---------------------------------------------------------------------------
// LocaleTimezone
// ---------------------------------------------------------------------------

describe('LocaleTimezone', () => {
  it('toIana("en-US") startsWith "America/"', () => {
    const tz = LocaleTimezone.toIana('en-US');
    assert.ok(tz.startsWith('America/'), `expected America/…, got: ${JSON.stringify(tz)}`);
  });

  it('toIana("ja-JP") === "Asia/Tokyo"', () => {
    assert.equal(LocaleTimezone.toIana('ja-JP'), 'Asia/Tokyo');
  });

  it('toIana("en") === "" (no region subtag)', () => {
    assert.equal(LocaleTimezone.toIana('en'), '');
  });
});
