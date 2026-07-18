/**
 * Unit tests: GeoWeightedFusionGather accumulation + empty-case baseline.
 *
 * The gather accumulates weight>0 candidates into
 * `state.geoCandidates` (reduce) and writing the baseline ResolvedGeo/GeoContext
 * when zero candidates accumulated (finalize). The layered-consensus algorithm
 * runs in the downstream node chain
 * (`resolve-country-consensus` → `verify-point-containment` →
 * `assemble-resolved-geo`, tested in `GeoConsensusChain.test.ts`).
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
import type { NodeStateInterface } from '@studnicky/dagonizer/types';
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

  append(state: object, path: string, value: unknown): void {
    const current = this.get(state, path);
    if (Array.isArray(current)) current.push(value);
    else this.set(state, path, [value]);
  }
}

// ── FixtureCandidate ──────────────────────────────────────────────────────────

class FixtureCandidate {
  static of(overrides: Partial<GeoResolution>): GeoResolution {
    return {
      'source':       'coords',
      'secondaryLookupUsed': false,
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
      'source':          'geo-weighted-fusion',
      'index':           0,
      'item':            null,
      'output':          'default',
      'terminalOutcome': 'completed',
      'result':          undefined,
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
      'signal':   new AbortController().signal,
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

  // ── transientResultSelection: honest 'full' declaration ────────────────────
  it('declares transientResultSelection mode "full" (finalize needs cloneState.capturedErrors, which a single-field record.result cannot carry alongside candidate)', () => {
    const strategy = GatherStrategies.resolve('geo-weighted-fusion');
    assert.ok(strategy instanceof GeoWeightedFusionGather);

    const selection = strategy.transientResultSelection();
    assert.equal(selection.mode, 'full');
    assert.deepEqual(selection.domainPaths, []);
    assert.deepEqual(selection.metadataKeys, []);
  });

  // ── finalize: capturedErrors merge requires full clone state on resume ────
  it('mergeCapturedErrors reads cloneState directly, so a snapshot→restore cycle (the durable-resume path this mode:"full" declaration guarantees) still merges every clone\'s captured errors', async () => {
    const strategy = GatherStrategies.resolve('geo-weighted-fusion');
    assert.ok(strategy instanceof GeoWeightedFusionGather);

    const accessor = new DirectAccessor();
    const state = new CartographerState();
    strategy.initial(CONFIG, state, accessor);

    const coordsCandidate = FixtureCandidate.of({ 'source': 'coords', 'weight': 1.0, 'country': 'DE' });
    const coordsClone = new CartographerState();
    accessor.set(coordsClone, 'candidate', coordsCandidate);
    accessor.set(coordsClone, 'capturedErrors', [{ 'kind': 'RangeError', 'message': 'coords out of range' }]);

    const ipCandidate = FixtureCandidate.of({ 'source': 'ip', 'weight': 0.55, 'country': 'DE' });
    const ipClone = new CartographerState();
    accessor.set(ipClone, 'candidate', ipCandidate);
    accessor.set(ipClone, 'capturedErrors', [{ 'kind': 'TypeError', 'message': 'ip lookup malformed' }]);

    const recordsA: GatherRecordType<NodeStateInterface>[] = [{
      'source': 'coords', 'index': 0, 'item': undefined, 'output': 'default',
      'terminalOutcome': 'completed', 'result': undefined, 'cloneState': coordsClone,
    }];
    strategy.reduce(CONFIG, Batch.from(recordsA.map((r) => ({ 'id': '0', 'state': r }))), state, accessor);

    // Durable-resume boundary: snapshot the parent accumulator state (what
    // `capturedErrors` folds into) and restore it into a fresh instance,
    // mirroring the checkpoint/resume cycle a real run crosses between two
    // gather batches. `capturedErrors` is part of CartographerState's declared
    // transient-domain surface, so it round-trips; `candidate`/`geoCandidates`
    // are not (a pre-existing CartographerState field-ownership gap tracked
    // separately — out of scope here), so this test asserts only the
    // errors-merge correctness this gather's `finalize()` is responsible for.
    const snapshot = state.snapshotTransientState();
    const resumedState = new CartographerState();
    await resumedState.restoreTransientState(state.runIri, snapshot);

    const recordsB: GatherRecordType<NodeStateInterface>[] = [{
      'source': 'ip', 'index': 0, 'item': undefined, 'output': 'default',
      'terminalOutcome': 'completed', 'result': undefined, 'cloneState': ipClone,
    }];
    strategy.reduce(CONFIG, Batch.from(recordsB.map((r) => ({ 'id': '0', 'state': r }))), resumedState, accessor);

    await strategy.finalize(CONFIG, {
      'state': resumedState,
      'records': [...recordsA, ...recordsB],
      'dagName': 'test',
      'signal': new AbortController().signal,
      'accessor': accessor,
      'invoker': { invokeNode: async (): Promise<void> => { /* no-op */ } },
    });

    const capturedErrors = accessor.get(resumedState, 'capturedErrors');
    assert.ok(Array.isArray(capturedErrors));
    assert.equal(capturedErrors.length, 2, 'captured errors from both the pre-resume and post-resume clone must merge');
  });

  // ── reduce: accumulates weight>0 candidates into state.geoCandidates ──────
  it('accumulates every weight>0 candidate into state.geoCandidates, in gather-record order', async () => {
    const strategy = GatherStrategies.resolve('geo-weighted-fusion');
    assert.ok(strategy instanceof GeoWeightedFusionGather);

    const coordsCandidate = FixtureCandidate.of({ 'source': 'coords', 'weight': 1.0, 'country': 'DE' });
    const ipCandidate     = FixtureCandidate.of({ 'source': 'ip',     'weight': 0.55, 'country': 'DE' });
    const zeroCandidate   = FixtureCandidate.of({ 'source': 'phone',  'weight': 0 });

    const state = await GeoFusionHarness.run(strategy, [coordsCandidate, ipCandidate, zeroCandidate]);

    assert.equal(state.geoCandidates.length, 2, 'only weight>0 candidates accumulate');
    assert.deepEqual(state.geoCandidates.map((c) => c.source), ['coords', 'ip']);
  });

  it('leaves resolvedGeo/geoContext untouched when candidates accumulated (downstream node chain owns fusion)', async () => {
    const strategy = GatherStrategies.resolve('geo-weighted-fusion');
    assert.ok(strategy instanceof GeoWeightedFusionGather);

    const coordsCandidate = FixtureCandidate.of({ 'source': 'coords', 'weight': 1.0, 'country': 'DE' });
    const state = await GeoFusionHarness.run(strategy, [coordsCandidate]);

    // finalize() no longer computes resolvedGeo for the non-empty case — it is
    // still the CartographerState construction default (baseline shape).
    assert.equal(state.resolvedGeo.confidence, 0);
    assert.deepEqual(state.resolvedGeo.provenance, []);
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
