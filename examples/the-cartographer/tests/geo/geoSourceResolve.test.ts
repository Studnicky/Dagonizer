/**
 * Unit tests for Wave 2 source-model geo-resolution sprout.
 *
 * Covers:
 *   - CoordTimezone (tz-lookup + country-coder integration)
 *   - CountryLocale (JSON map lookup)
 *   - GeoSignalBuilder.from (classify decision from state)
 *   - GeoResolutionBuilder.from (partial → full with defaults)
 *   - GeoSourceResolveDAG end-to-end integration (coords path)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Dagonizer } from '@studnicky/dagonizer';
import { CoordTimezone } from '../../geo/CoordTimezone.ts';
import { CountryLocale } from '../../geo/CountryLocale.ts';
import { Continents } from '../../services.ts';
import { GeoSignalBuilder } from '../../entities/GeoSignal.ts';
import { GeoResolutionBuilder, DEFAULT_GEO_RESOLUTION } from '../../entities/GeoResolution.ts';
import { GeoSourceResolveDAG } from '../../embedded-dags/GeoSourceResolveDAG.ts';
import { CartographerState } from '../../CartographerState.ts';
import { CanonicalEventVariantBuilder } from '../../entities/CanonicalEvent.ts';
import type { IpGeolocator } from '../../contracts/IpGeolocator.ts';
import type { AddressGeocoder } from '../../contracts/AddressGeocoder.ts';
import type { GeoLookupOutcomeType } from '../../errors/GeoLookupOutcome.ts';

// ---------------------------------------------------------------------------
// CoordTimezone
// ---------------------------------------------------------------------------

describe('CoordTimezone', () => {
  it('NYC (40.7128, -74.006) → America/New_York, US', () => {
    const result = CoordTimezone.resolve(40.7128, -74.006);
    assert.equal(result.timezone, 'America/New_York');
    assert.equal(result.country, 'US');
  });

  it('London (51.5074, -0.1278) → Europe/London, GB', () => {
    const result = CoordTimezone.resolve(51.5074, -0.1278);
    assert.equal(result.timezone, 'Europe/London');
    assert.equal(result.country, 'GB');
  });

  it('Tokyo (35.68, 139.69) → Asia/Tokyo, JP', () => {
    const result = CoordTimezone.resolve(35.68, 139.69);
    assert.equal(result.timezone, 'Asia/Tokyo');
    assert.equal(result.country, 'JP');
  });

  it('invalid coords (NaN, NaN) → empty strings, no throw', () => {
    const result = CoordTimezone.resolve(NaN, NaN);
    assert.equal(typeof result.timezone, 'string');
    assert.equal(typeof result.country, 'string');
  });
});

// ---------------------------------------------------------------------------
// CountryLocale
// ---------------------------------------------------------------------------

describe('CountryLocale', () => {
  it('forIso2("US") → "en-US"', () => {
    assert.equal(CountryLocale.forIso2('US'), 'en-US');
  });

  it('forIso2("GB") → "en-GB"', () => {
    assert.equal(CountryLocale.forIso2('GB'), 'en-GB');
  });

  it('forIso2("JP") → "ja-JP"', () => {
    assert.equal(CountryLocale.forIso2('JP'), 'ja-JP');
  });

  it('forIso2("us") (lowercase) → "en-US" (normalises to upper)', () => {
    assert.equal(CountryLocale.forIso2('us'), 'en-US');
  });

  it('forIso2("ZZ") (unknown) → ""', () => {
    assert.equal(CountryLocale.forIso2('ZZ'), '');
  });
});

// ---------------------------------------------------------------------------
// GeoSignalBuilder.from
// ---------------------------------------------------------------------------

describe('GeoSignalBuilder.from', () => {
  function stateWith(opts: { lat?: number; lng?: number; ip?: string; localeTag?: string; countryCode?: string }): CartographerState {
    const state = new CartographerState();
    // CanonicalEventVariantBuilder.from merges with POSITION_PING_DEFAULT so
    // only the fields we want to override need to be provided.
    const partial = CanonicalEventVariantBuilder.from({});
    partial.body.latitude    = opts.lat         ?? 0;
    partial.body.longitude   = opts.lng         ?? 0;
    partial.body.ipAddress   = opts.ip          ?? '';
    partial.body.localeTag   = opts.localeTag   ?? '';
    partial.body.countryCode = opts.countryCode ?? '';
    state.canonical = partial;
    return state;
  }

  it('non-zero coords → primaryModel = "coords"', () => {
    const state = stateWith({ 'lat': 40.7128, 'lng': -74.006 });
    const sig = GeoSignalBuilder.from(state);
    assert.equal(sig.primaryModel, 'coords');
    assert.equal(sig.lat, 40.7128);
    assert.equal(sig.lng, -74.006);
  });

  it('zero coords + IP → primaryModel = "ip"', () => {
    const state = stateWith({ 'lat': 0, 'lng': 0, 'ip': '8.8.8.8' });
    const sig = GeoSignalBuilder.from(state);
    assert.equal(sig.primaryModel, 'ip');
    assert.equal(sig.ipAddress, '8.8.8.8');
  });

  it('zero coords + no IP → primaryModel = "none"', () => {
    const state = stateWith({ 'lat': 0, 'lng': 0 });
    const sig = GeoSignalBuilder.from(state);
    assert.equal(sig.primaryModel, 'none');
  });

  it('non-zero lat + zero lng → primaryModel = "coords"', () => {
    // At the prime meridian, lat alone is non-zero → coords model.
    const state = stateWith({ 'lat': 51.5, 'lng': 0 });
    const sig = GeoSignalBuilder.from(state);
    assert.equal(sig.primaryModel, 'coords');
  });

  it('zero coords + localeTag set → primaryModel = "locale"', () => {
    const state = stateWith({ 'lat': 0, 'lng': 0, 'localeTag': 'ja-JP' });
    const sig = GeoSignalBuilder.from(state);
    assert.equal(sig.primaryModel, 'locale');
    assert.equal(sig.localeTag, 'ja-JP');
  });

  it('zero coords + no localeTag + countryCode set → primaryModel = "code"', () => {
    const state = stateWith({ 'lat': 0, 'lng': 0, 'countryCode': 'DE' });
    const sig = GeoSignalBuilder.from(state);
    assert.equal(sig.primaryModel, 'code');
    assert.equal(sig.countryCode, 'DE');
  });

  it('localeTag and IP but non-zero coords → primaryModel = "coords" (coords wins)', () => {
    const state = stateWith({ 'lat': 35.68, 'lng': 139.69, 'localeTag': 'ja-JP', 'ip': '210.130.1.1' });
    const sig = GeoSignalBuilder.from(state);
    assert.equal(sig.primaryModel, 'coords');
  });
});

// ---------------------------------------------------------------------------
// Continents
// ---------------------------------------------------------------------------

describe('Continents', () => {
  it('forIso2("US") → "North America"', () => {
    assert.equal(Continents.forIso2('US'), 'North America');
  });

  it('forIso2("JP") → "Asia"', () => {
    assert.equal(Continents.forIso2('JP'), 'Asia');
  });

  it('forIso2("DE") → "Europe"', () => {
    assert.equal(Continents.forIso2('DE'), 'Europe');
  });

  it('forIso2("ZZ") (unknown) → "Unmapped"', () => {
    assert.equal(Continents.forIso2('ZZ'), 'Unmapped');
  });
});

// ---------------------------------------------------------------------------
// GeoResolutionBuilder.from
// ---------------------------------------------------------------------------

describe('GeoResolutionBuilder.from', () => {
  it('empty partial → DEFAULT_GEO_RESOLUTION values', () => {
    const res = GeoResolutionBuilder.from({});
    assert.equal(res.source, DEFAULT_GEO_RESOLUTION.source);
    assert.equal(res.fallbackUsed, DEFAULT_GEO_RESOLUTION.fallbackUsed);
    assert.equal(res.timezone, DEFAULT_GEO_RESOLUTION.timezone);
  });

  it('locale branch — sets source=locale, timezone, country, locale', () => {
    const res = GeoResolutionBuilder.from({
      'source':    'locale',
      'timezone':  'Asia/Tokyo',
      'country':   'JP',
      'locale':    'ja-JP',
      'fallbackUsed': false,
      'countryName': 'Japan',
      'region':    '',
      'locality':  '',
      'lat':       0,
      'lng':       0,
      'status':    'land',
    });
    assert.equal(res.source, 'locale');
    assert.equal(res.timezone, 'Asia/Tokyo');
    assert.equal(res.country, 'JP');
    assert.equal(res.locale, 'ja-JP');
  });

  it('code branch — sets source=code, country, countryName', () => {
    const res = GeoResolutionBuilder.from({
      'source':      'code',
      'country':     'DE',
      'countryName': 'Germany',
      'locale':      'de-DE',
      'timezone':    'Europe/Berlin',
      'fallbackUsed': false,
      'region':      '',
      'locality':    '',
      'lat':         0,
      'lng':         0,
      'status':      'land',
    });
    assert.equal(res.source, 'code');
    assert.equal(res.country, 'DE');
    assert.equal(res.countryName, 'Germany');
    assert.equal(res.locale, 'de-DE');
  });

  it('fallbackUsed=true carried through', () => {
    const res = GeoResolutionBuilder.from({
      'source':       'coords',
      'fallbackUsed': true,
      'timezone':     'America/Chicago',
      'country':      'US',
      'countryName':  '',
      'locale':       'en-US',
      'region':       '',
      'locality':     '',
      'lat':          41.8,
      'lng':          -87.6,
      'status':       'land',
    });
    assert.equal(res.fallbackUsed, true);
    assert.equal(res.lat, 41.8);
  });
});

// ---------------------------------------------------------------------------
// GeoSourceResolveDAG — end-to-end integration (coords path)
// ---------------------------------------------------------------------------

describe('GeoSourceResolveDAG integration', () => {
  // Stub IpGeolocator — returns unresolved for all IPs so the coords path
  // does not invoke any network calls.
  const stubIpGeolocator: IpGeolocator = {
    async lookup(_ipAddress: string, _signal: AbortSignal): Promise<GeoLookupOutcomeType> {
      return {
        'candidate': {
          'modality':    'ip',
          'resolved':    false,
          'country':     '',
          'countryName': '',
          'continent':   '',
          'region':      '',
          'locality':    '',
          'lat':         0,
          'lng':         0,
          'water':       false,
        },
        'error': null,
      };
    },
  };

  // Stub AddressGeocoder — returns unresolved for all addresses (no network calls).
  const stubAddressGeocoder: AddressGeocoder = {
    async geocode(_address: string, _signal: AbortSignal): Promise<GeoLookupOutcomeType> {
      return {
        'candidate': {
          'modality':    'address',
          'resolved':    false,
          'country':     '',
          'countryName': '',
          'continent':   '',
          'region':      '',
          'locality':    '',
          'lat':         0,
          'lng':         0,
          'water':       false,
        },
        'error': null,
      };
    },
  };

  it('coords event: resolvedGeo.country and .locale populated, provenance includes coords, confidence=1.0', async () => {
    const bundle = GeoSourceResolveDAG.build(stubIpGeolocator, stubAddressGeocoder);

    const state = new CartographerState();
    // Set up a position-ping canonical event with NYC coords (no IP address).
    const ev = CanonicalEventVariantBuilder.from({});
    ev.body.latitude  = 40.7128;
    ev.body.longitude = -74.006;
    ev.body.ipAddress = '';
    state.canonical = ev;

    const dispatcher = new Dagonizer<CartographerState>({});
    dispatcher.registerBundle(bundle);

    const execution = dispatcher.execute('geo-source-resolve', state);
    for await (const _event of execution) { /* drain */ }

    assert.ok(state.resolvedGeo.country.length > 0, `expected country, got: ${JSON.stringify(state.resolvedGeo.country)}`);
    assert.ok(state.resolvedGeo.locale.length > 0, `expected locale, got: ${JSON.stringify(state.resolvedGeo.locale)}`);
    // Coords is the highest-weight signal — confidence equals the coords weight (1.0).
    assert.equal(state.resolvedGeo.confidence, 1.0, `expected confidence=1.0, got: ${state.resolvedGeo.confidence}`);
    // Provenance must include 'coords'.
    assert.ok(state.resolvedGeo.provenance.includes('coords'), `expected provenance to include 'coords', got: ${JSON.stringify(state.resolvedGeo.provenance)}`);
    // Modalities must include 'gps'.
    assert.ok(state.resolvedGeo.modalities.includes('gps'), `expected modalities to include 'gps', got: ${JSON.stringify(state.resolvedGeo.modalities)}`);
    assert.ok(state.geoContext.timezone.length > 0, `expected timezone, got: ${JSON.stringify(state.geoContext.timezone)}`);
  });

  it('coords+IP event: provenance includes both, modalities includes gps+ip, confidence=1.0, continent non-empty', async () => {
    // Stub IpGeolocator that returns a resolved candidate (to test the merge path).
    const ipCandidateReturningLocator: IpGeolocator = {
      async lookup(_ipAddress: string, _signal: AbortSignal): Promise<GeoLookupOutcomeType> {
        return {
          'candidate': {
            'modality':    'ip',
            'resolved':    true,
            'country':     'US',
            'countryName': 'United States',
            'continent':   'North America',
            'region':      'New York',
            'locality':    'New York City',
            'lat':         40.71,
            'lng':         -74.0,
            'water':       false,
          },
          'error': null,
        };
      },
    };

    const bundle = GeoSourceResolveDAG.build(ipCandidateReturningLocator, stubAddressGeocoder);

    const state = new CartographerState();
    // NYC coords + IP — both signals scored; coords wins (weight 1.0 > ip weight 0.55).
    const ev = CanonicalEventVariantBuilder.from({});
    ev.body.latitude  = 40.7128;
    ev.body.longitude = -74.006;
    ev.body.ipAddress = '8.8.8.8';
    state.canonical = ev;

    const dispatcher = new Dagonizer<CartographerState>({});
    dispatcher.registerBundle(bundle);

    const execution = dispatcher.execute('geo-source-resolve', state);
    for await (const _event of execution) { /* drain */ }

    // Both signals contributed — provenance contains both source strings.
    assert.ok(state.resolvedGeo.provenance.includes('coords'), `expected provenance to include 'coords', got: ${JSON.stringify(state.resolvedGeo.provenance)}`);
    assert.ok(state.resolvedGeo.provenance.includes('ip'), `expected provenance to include 'ip', got: ${JSON.stringify(state.resolvedGeo.provenance)}`);
    // Modalities should include both gps and ip.
    assert.ok(
      state.resolvedGeo.modalities.includes('gps') && state.resolvedGeo.modalities.includes('ip'),
      `expected modalities to include gps and ip, got: ${JSON.stringify(state.resolvedGeo.modalities)}`,
    );
    // Coords wins — confidence is 1.0 (coords weight).
    assert.equal(state.resolvedGeo.confidence, 1.0, `expected confidence=1.0, got: ${state.resolvedGeo.confidence}`);
    // Continent resolved from coords path (not empty).
    assert.ok(state.resolvedGeo.continent.length > 0, `expected non-empty continent, got: ${JSON.stringify(state.resolvedGeo.continent)}`);
    assert.ok(state.resolvedGeo.country.length > 0, `expected country, got: ${JSON.stringify(state.resolvedGeo.country)}`);
  });

  it('empty-signals event: geo-baseline path fires, confidence=0, jurisdiction=baseline, geoContext.country=INTL', async () => {
    const bundle = GeoSourceResolveDAG.build(stubIpGeolocator, stubAddressGeocoder);

    const state = new CartographerState();
    // No coords, no IP, no locale, no code, no address, no phone — zero signals scored.
    const ev = CanonicalEventVariantBuilder.from({});
    ev.body.latitude    = 0;
    ev.body.longitude   = 0;
    ev.body.ipAddress   = '';
    ev.body.localeTag   = '';
    ev.body.countryCode = '';
    ev.body.address     = '';
    ev.body.phone       = '';
    state.canonical = ev;

    const dispatcher = new Dagonizer<CartographerState>({});
    dispatcher.registerBundle(bundle);

    const execution = dispatcher.execute('geo-source-resolve', state);
    for await (const _event of execution) { /* drain */ }

    // Baseline values: no country resolved, zero confidence.
    assert.equal(state.resolvedGeo.confidence, 0, `expected confidence=0, got: ${state.resolvedGeo.confidence}`);
    assert.equal(state.resolvedGeo.jurisdiction, 'baseline', `expected jurisdiction=baseline, got: ${state.resolvedGeo.jurisdiction}`);
    // GeoContext.country must be 'INTL' on the baseline path.
    assert.equal(state.geoContext.country, 'INTL', `expected geoContext.country=INTL, got: ${state.geoContext.country}`);
    // No provenance (no signals resolved anything).
    assert.deepEqual(state.resolvedGeo.provenance, [], `expected empty provenance, got: ${JSON.stringify(state.resolvedGeo.provenance)}`);
  });
});
