/**
 * Unit tests: GeoWeightedFusionGather fusion rules.
 *
 * Test architecture:
 *  - DirectAccessor: implements StateAccessorInterface using Reflect to read/write
 *    named properties on CartographerState without casts.
 *  - FixtureCandidate: static factory for minimal GeoResolution fixtures.
 *  - GeoFusionHarness: static methods that drive gather steps directly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GeoWeightedFusionGather } from '../../core/GeoWeightedFusionGather.ts';
import { CartographerState } from '../../CartographerState.ts';
import { GatherStrategies, Batch, GatherStrategy } from '@studnicky/dagonizer/core';
import type { GatherRecordType } from '@studnicky/dagonizer/contracts';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';
import type { GeoResolution } from '../../entities/GeoResolution.ts';
import type { ResolvedGeo } from '../../entities/ResolvedGeo.ts';

// ── DirectAccessor ─────────────────────────────────────────────────────────────

class DirectAccessor implements StateAccessorInterface {
  get(state: object, path: string): unknown {
    const segments = path.split('.');
    let current: unknown = state;
    for (const seg of segments) {
      if (current === null || typeof current !== 'object') return null;
      current = Reflect.get(current, seg);
    }
    return current;
  }

  set(state: object, path: string, value: unknown): void {
    const segments = path.split('.');
    let current: unknown = state;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (seg === undefined) return;
      if (current === null || typeof current !== 'object') return;
      let next = Reflect.get(current, seg);
      if (next === null || typeof next !== 'object') {
        next = {};
        Reflect.set(current, seg, next);
      }
      current = next;
    }
    const lastSeg = segments[segments.length - 1];
    if (lastSeg === undefined || current === null || typeof current !== 'object') return;
    Reflect.set(current, lastSeg, value);
  }
}

// ── FixtureCandidate ──────────────────────────────────────────────────────────

class FixtureCandidate {
  static of(overrides: Partial<GeoResolution>): GeoResolution {
    return {
      'source':       'coords',
      'fallbackUsed': false,
      'timezone':     '',
      'country':      '',
      'countryName':  '',
      'locale':       '',
      'region':       '',
      'locality':     '',
      'lat':          0,
      'lng':          0,
      'status':       'land',
      'weight':       0,
      ...overrides,
    };
  }
}

// ── ResolvedGeoGuard ──────────────────────────────────────────────────────────

class ResolvedGeoGuard {
  static is(v: unknown): v is ResolvedGeo {
    if (v === null || typeof v !== 'object') return false;
    const obj = v as Record<string, unknown>;
    return (
      typeof obj['country'] === 'string' &&
      typeof obj['confidence'] === 'number' &&
      Array.isArray(obj['provenance']) &&
      Array.isArray(obj['modalities'])
    );
  }
}

// ── GeoFusionHarness ──────────────────────────────────────────────────────────

const CONFIG = { 'strategy': 'geo-weighted-fusion' } as const;

class GeoFusionHarness {
  /**
   * Build a GatherRecordType with `candidate` set on a child CartographerState,
   * so the strategy reads `accessor.get(cloneState, 'candidate')`.
   */
  static record(candidate: GeoResolution, accessor: StateAccessorInterface): GatherRecordType<unknown> {
    const cloneState = new CartographerState();
    accessor.set(cloneState, 'candidate', candidate);
    return {
      'index':           0,
      'item':            null,
      'output':          'default',
      'terminalOutcome': 'completed',
      'cloneState':      cloneState,
    };
  }

  /** Run initial + reduce + finalize on a fresh CartographerState. */
  static async run(
    strategy: GatherStrategy,
    candidates: GeoResolution[],
  ): Promise<CartographerState> {
    const accessor = new DirectAccessor();
    const state    = new CartographerState();
    strategy.initial(CONFIG, state, accessor);
    const records: GatherRecordType<unknown>[] = candidates.map((c) => GeoFusionHarness.record(c, accessor));
    const batch = Batch.from(records.map((r) => ({ 'id': '0', 'state': r })));
    strategy.reduce(CONFIG, batch, state, accessor);
    await strategy.finalize(CONFIG, {
      'state':    state,
      'records':  records,
      'dagName':  'test',
      'signal':   null,
      'accessor': accessor,
      'invoker':  { invokeNode: async (): Promise<void> => { /* no-op */ } },
    });
    return state;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GeoWeightedFusionGather', () => {

  it('is registered under "geo-weighted-fusion"', () => {
    const strategy = GatherStrategies.resolve('geo-weighted-fusion');
    assert.ok(strategy, 'strategy must be registered');
    assert.equal(strategy.name, 'geo-weighted-fusion');
    assert.ok(strategy instanceof GeoWeightedFusionGather, 'must be GeoWeightedFusionGather instance');
  });

  // ── Test 1: coords (weight 1.0, empty region) + ip (weight 0.55, with region)
  it('coords wins; region back-filled from ip; provenance and modalities correct', async () => {
    const strategy = GatherStrategies.resolve('geo-weighted-fusion');
    assert.ok(strategy instanceof GeoWeightedFusionGather);

    const coordsCandidate = FixtureCandidate.of({
      'source':      'coords',
      'weight':      1.0,
      'country':     'DE',
      'countryName': 'Germany',
      'region':      '',          // empty — should be back-filled from ip
      'locality':    'Berlin',
      'timezone':    'Europe/Berlin',
      'status':      'land',
      'lat':         52.5,
      'lng':         13.4,
    });

    const ipCandidate = FixtureCandidate.of({
      'source':      'ip',
      'weight':      0.55,
      'country':     'DE',
      'countryName': 'Germany',
      'region':      'Berlin State',
      'locality':    'Berlin',
      'timezone':    'Europe/Berlin',
      'status':      'land',
    });

    const state = await GeoFusionHarness.run(strategy, [coordsCandidate, ipCandidate]);
    const resolved = state.resolvedGeo;

    assert.ok(ResolvedGeoGuard.is(resolved), 'resolvedGeo must be set');

    // Winner is coords (weight 1.0)
    assert.equal(resolved.confidence, 1.0, 'confidence must be winner weight 1.0');

    // region back-filled from ip
    assert.equal(resolved.region, 'Berlin State', 'region must be back-filled from ip candidate');

    // Provenance: coords first (highest weight), then ip
    assert.deepEqual(resolved.provenance, ['coords', 'ip'], 'provenance must be ordered by weight, de-duplicated');

    // Modalities: 'gps' from coords, 'ip' from ip
    assert.ok(resolved.modalities.includes('gps'), 'modalities must include gps');
    assert.ok(resolved.modalities.includes('ip'),  'modalities must include ip');
  });

  // ── Test 2: code (0.35, country 'DE') + locale (0.2, country 'DE') → composite
  it('code + locale agree on country → confidence is composite 0.45', async () => {
    const strategy = GatherStrategies.resolve('geo-weighted-fusion');
    assert.ok(strategy instanceof GeoWeightedFusionGather);

    const codeCandidate = FixtureCandidate.of({
      'source':  'code',
      'weight':  0.35,
      'country': 'DE',
      'status':  'land',
    });

    const localeCandidate = FixtureCandidate.of({
      'source':  'locale',
      'weight':  0.2,
      'country': 'DE',
      'status':  'land',
    });

    const state = await GeoFusionHarness.run(strategy, [codeCandidate, localeCandidate]);
    const resolved = state.resolvedGeo;

    assert.ok(ResolvedGeoGuard.is(resolved), 'resolvedGeo must be set');

    // Winner is code (weight 0.35), but composite override applies
    assert.equal(resolved.confidence, 0.45, 'confidence must be composite 0.45 when code+locale agree');

    // Provenance contains both sources
    assert.ok(resolved.provenance.includes('code'),   'provenance must include code');
    assert.ok(resolved.provenance.includes('locale'), 'provenance must include locale');
    // code is first (higher weight)
    assert.equal(resolved.provenance[0], 'code', 'code must appear before locale in provenance');
  });

  // ── Test 3: code 'DE' + locale 'FR' disagree → no composite, confidence stays 0.35
  it('code + locale disagree on country → no composite, confidence stays at winner weight', async () => {
    const strategy = GatherStrategies.resolve('geo-weighted-fusion');
    assert.ok(strategy instanceof GeoWeightedFusionGather);

    const codeCandidate = FixtureCandidate.of({
      'source':  'code',
      'weight':  0.35,
      'country': 'DE',
      'status':  'land',
    });

    const localeCandidate = FixtureCandidate.of({
      'source':  'locale',
      'weight':  0.2,
      'country': 'FR',
      'status':  'land',
    });

    const state = await GeoFusionHarness.run(strategy, [codeCandidate, localeCandidate]);
    const resolved = state.resolvedGeo;

    assert.ok(ResolvedGeoGuard.is(resolved), 'resolvedGeo must be set');

    // No composite override: confidence = winner weight
    assert.equal(resolved.confidence, 0.35, 'confidence must stay at winner weight 0.35 when code+locale disagree');
  });

  // ── Test 4: zero weight>0 candidates → baseline resolvedGeo
  it('zero weight>0 candidates → baseline resolvedGeo with confidence 0 and empty provenance', async () => {
    const strategy = GatherStrategies.resolve('geo-weighted-fusion');
    assert.ok(strategy instanceof GeoWeightedFusionGather);

    // All candidates have weight 0 (or negative) → none qualify
    const zeroCandidate = FixtureCandidate.of({ 'source': 'coords', 'weight': 0 });

    const state = await GeoFusionHarness.run(strategy, [zeroCandidate]);
    const resolved = state.resolvedGeo;

    assert.ok(ResolvedGeoGuard.is(resolved), 'resolvedGeo must be set to baseline');
    assert.equal(resolved.confidence,   0,            'confidence must be 0 for baseline');
    assert.equal(resolved.country,      '',           'country must be empty for baseline');
    assert.equal(resolved.jurisdiction, 'baseline',   'jurisdiction must be baseline');
    assert.equal(resolved.status,       'land',       'status must be land for baseline');
    assert.equal(resolved.continent,    'Unmapped',   'continent must be Unmapped for baseline');
    assert.deepEqual(resolved.provenance,  [],        'provenance must be empty for baseline');
    assert.deepEqual(resolved.modalities,  [],        'modalities must be empty for baseline');
  });

  // ── Additional: no candidates at all (empty array)
  it('empty candidate list → baseline resolvedGeo', async () => {
    const strategy = GatherStrategies.resolve('geo-weighted-fusion');
    assert.ok(strategy instanceof GeoWeightedFusionGather);

    const state = await GeoFusionHarness.run(strategy, []);
    const resolved = state.resolvedGeo;

    assert.ok(ResolvedGeoGuard.is(resolved), 'resolvedGeo must be set to baseline');
    assert.equal(resolved.confidence, 0,          'confidence must be 0 for empty input');
    assert.deepEqual(resolved.provenance, [],     'provenance must be empty for empty input');
    assert.deepEqual(resolved.modalities, [],     'modalities must be empty for empty input');
  });
});
