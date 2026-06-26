/**
 * Unit tests for RecordedAddressGeocoder and LiveAddressGeocoder.
 * Covers: recorded graceful-unresolved, live happy path (fetch stub), non-2xx,
 * and empty-string short-circuit.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RecordedAddressGeocoder } from '../../services/RecordedAddressGeocoder.ts';
import { LiveAddressGeocoder } from '../../services/LiveAddressGeocoder.ts';

// ---------------------------------------------------------------------------
// RecordedAddressGeocoder
// ---------------------------------------------------------------------------

describe('RecordedAddressGeocoder', () => {
  it('resolves every address to an unresolved address candidate without error', async () => {
    const geocoder = new RecordedAddressGeocoder();
    const signal = new AbortController().signal;

    const outcome = await geocoder.geocode('1600 Amphitheatre Parkway, Mountain View, CA', signal);

    assert.equal(outcome.error, null);
    assert.equal(outcome.candidate.resolved, false);
    assert.equal(outcome.candidate.modality, 'address');
  });
});

// ---------------------------------------------------------------------------
// LiveAddressGeocoder — fetch stubbing helpers
// ---------------------------------------------------------------------------

type FetchFn = typeof globalThis.fetch;

function makeMockFetch(status: number, body: unknown): FetchFn {
  return async (_input: Parameters<FetchFn>[0], _init?: Parameters<FetchFn>[1]) => {
    return {
      ok:         status >= 200 && status < 300,
      status:     status,
      statusText: status === 200 ? 'OK' : 'Not Found',
      json:       async () => body,
    } as Response;
  };
}

// A minimal Nominatim-shaped array response for a successful geocode.
const NOMINATIM_SUCCESS_BODY = [
  {
    lat: '37.4224764',
    lon: '-122.0842499',
    address: {
      country_code: 'us',
      country:      'United States',
      state:        'California',
      city:         'Mountain View',
    },
  },
];

// ---------------------------------------------------------------------------
// LiveAddressGeocoder
// ---------------------------------------------------------------------------

describe('LiveAddressGeocoder', () => {
  let originalFetch: FetchFn;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  describe('geocode — mocked OK response (Nominatim-shaped array)', () => {
    let fetchCallCount = 0;

    beforeEach(() => {
      fetchCallCount = 0;
      globalThis.fetch = async (input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]) => {
        fetchCallCount++;
        return makeMockFetch(200, NOMINATIM_SUCCESS_BODY)(input, init);
      };
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns resolved candidate with correct ISO-2 country and numeric lat/lng', async () => {
      const geocoder = new LiveAddressGeocoder();
      const signal = new AbortController().signal;

      const outcome = await geocoder.geocode('1600 Amphitheatre Parkway, Mountain View, CA', signal);

      assert.equal(outcome.error, null);
      assert.equal(outcome.candidate.resolved, true);
      assert.equal(outcome.candidate.modality, 'address');
      assert.equal(outcome.candidate.country, 'US');
      assert.equal(typeof outcome.candidate.lat, 'number');
      assert.equal(typeof outcome.candidate.lng, 'number');
      assert.ok(Math.abs(outcome.candidate.lat - 37.4224764) < 0.0001);
      assert.ok(Math.abs(outcome.candidate.lng - (-122.0842499)) < 0.0001);
    });
  });

  describe('geocode — mocked non-2xx response', () => {
    beforeEach(() => {
      globalThis.fetch = makeMockFetch(503, []);
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns error !== null and candidate.resolved === false on non-2xx', async () => {
      const geocoder = new LiveAddressGeocoder();
      const signal = new AbortController().signal;

      const outcome = await geocoder.geocode('some address', signal);

      assert.notEqual(outcome.error, null);
      assert.equal(outcome.candidate.resolved, false);
      assert.equal(outcome.candidate.modality, 'address');
    });
  });

  describe('geocode — empty address short-circuit', () => {
    let fetchInvoked = false;

    beforeEach(() => {
      fetchInvoked = false;
      globalThis.fetch = async (_input: Parameters<FetchFn>[0], _init?: Parameters<FetchFn>[1]) => {
        fetchInvoked = true;
        return makeMockFetch(200, NOMINATIM_SUCCESS_BODY)(_input, _init);
      };
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('resolves unresolved WITHOUT calling fetch for an empty-string address', async () => {
      const geocoder = new LiveAddressGeocoder();
      const signal = new AbortController().signal;

      const outcome = await geocoder.geocode('   ', signal);

      assert.equal(fetchInvoked, false, 'fetch must not be called for empty address');
      assert.equal(outcome.error, null);
      assert.equal(outcome.candidate.resolved, false);
      assert.equal(outcome.candidate.modality, 'address');
    });
  });
});
