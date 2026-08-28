import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CoordinateGeoResolver } from '../../services/CoordinateGeoResolver.ts';

describe('CoordinateGeoResolver', () => {
  it('resolves land containment and timezone through the canonical boundary', () => {
    const result = CoordinateGeoResolver.resolve(40.7128, -74.006);

    assert.equal(result.water, false);
    assert.equal(result.country, 'US');
    assert.equal(result.countryName, 'United States of America');
    assert.equal(result.timezone, 'America/New_York');
  });

  it('classifies Lake Michigan as named water rather than United States land', () => {
    const result = CoordinateGeoResolver.resolve(43.5, -87);

    assert.equal(result.water, true);
    assert.equal(result.waterBody, 'Lake Michigan');
    assert.equal(result.country, '');
    assert.equal(result.countryName, '');
    assert.ok(result.timezone.length > 0);
  });

  it('resolves the Vatican enclave independently of the surrounding Italian timezone', () => {
    const result = CoordinateGeoResolver.resolve(41.9029, 12.4534);

    assert.equal(result.water, false);
    assert.equal(result.waterBody, '');
    assert.equal(result.country, 'VA');
    assert.equal(result.countryName, 'Vatican City');
    assert.equal(result.timezone, 'Europe/Rome');
  });

  it('rejects non-finite coordinates before containment lookup', () => {
    assert.deepEqual(CoordinateGeoResolver.resolve(Number.NaN, Number.NaN), {
      country: '',
      countryName: '',
      timezone: '',
      water: false,
      waterBody: '',
    });
  });
});
