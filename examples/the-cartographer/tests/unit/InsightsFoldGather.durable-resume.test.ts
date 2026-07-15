/**
 * Unit tests: InsightsFoldGather durable-resume contract.
 *
 * Verifies that InsightsFoldGather is truly stateless — all accumulations live
 * in parent state via the accessor, so a snapshot→restore cycle between two
 * partial reduce passes produces identical results to a single full pass.
 *
 * Test architecture:
 *  - DirectAccessor: implements StateAccessorInterface using Reflect to read/write
 *    named properties on CartographerState without casts.
 *  - FixtureShipment: static factory that produces minimal EnrichedShipment fixtures.
 *  - InsightsFingerprint: extracts a deterministic comparable summary from state.
 *  - GatherHarness: static methods that drive gather steps directly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { InsightsFoldGather } from '../../core/InsightsFoldGather.ts';
import { CartographerState } from '../../CartographerState.ts';
import type { RegionInsights } from '../../CartographerState.ts';
import type { EnrichedShipment } from '../../entities/EnrichedShipment.ts';
import { GatherStrategies, Batch, GatherStrategy } from '@studnicky/dagonizer/core';
import type { GatherRecordType } from '@studnicky/dagonizer/contracts';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';


// ── DirectAccessor ─────────────────────────────────────────────────────────────
// Implements StateAccessorInterface by directly reading/writing named properties
// on CartographerState. Supports simple dotted paths by walking segments.

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

// ── FixtureShipment ───────────────────────────────────────────────────────────
// Static factory for minimal EnrichedShipment fixtures with deterministic data.

class FixtureShipment {
  static of(overrides: Partial<EnrichedShipment>): EnrichedShipment {
    return {
      'shipmentId':       'SHP-001',
      'scanSeq':          1,
      'epochMs':          1_700_000_000_000,
      'localIso':         '2023-11-14T21:46:40+00:00',
      'utcOffset':        '+00:00',
      'timezone':         'UTC',
      'jurisdiction':     'baseline',
      'continent':        'Europe',
      'region':           'Western Europe',
      'country':          'DE',
      'hub':              'FRA',
      'geoStatus':        'land',
      'lat':              50.1,
      'lng':              8.7,
      'coordsCoarsened':  false,
      'legKm':            100,
      'status':           'SCAN',
      'serviceTier':      'standard',
      'sizeTier':         'small',
      'onTime':           true,
      'exception':        false,
      'consentStatus':    'valid',
      'disruptionReason': '',
      'subtotalUsdMinor': 5000,
      'currency':         'USD',
      'shippingUsdMinor': 1200,
      'distanceKm':       100,
      'transitHours':     24,
      'delayHours':       0,
      'redactionApplied': false,
      'redactedSample': { 'recipientName': '', 'recipientEmail': '', 'recipientPhone': '' },
      'routing': CartographerState.defaultRouting(),
      ...overrides,
    };
  }
}

// ── InsightsFingerprint ───────────────────────────────────────────────────────
// Extracts a deterministic comparable summary from a CartographerState after
// gather. Comparing two fingerprints asserts the durable-resume contract.

interface RegionSummary {
  region: string;
  shipmentCount: number;
}

interface InsightsFingerprintData {
  regionSummaries: RegionSummary[];
  journeyCount: number;
  totalShipmentCount: number;
}

class InsightsFingerprint {
  static of(state: CartographerState): InsightsFingerprintData {
    const regions: RegionSummary[] = [];
    for (const [, r] of state.insights) {
      regions.push({ 'region': r.region, 'shipmentCount': r.shipmentCount });
    }
    regions.sort((a, b) => a.region.localeCompare(b.region));

    let totalShipmentCount = 0;
    for (const [, r] of state.insights) {
      totalShipmentCount += r.shipmentCount;
    }

    return {
      'regionSummaries': regions,
      'journeyCount': state.journeys.size,
      'totalShipmentCount': totalShipmentCount,
    };
  }
}

// ── GatherHarness ─────────────────────────────────────────────────────────────
// Static methods that drive InsightsFoldGather steps directly without a real DAG.

const CONFIG = { 'strategy': 'insights-fold' } as const;

class GatherHarness {
  /**
   * Builds a GatherRecordType for a given enriched shipment, embedding it in a
   * child CartographerState so the strategy can read `accessor.get(cloneState, 'enriched')`.
   */
  static record(enriched: EnrichedShipment, accessor: StateAccessorInterface): GatherRecordType<unknown> {
    const cloneState = new CartographerState();
    accessor.set(cloneState, 'enriched', enriched);
    accessor.set(cloneState, 'capturedErrors', []);
    return {
      'source':          'insights-fold',
      'index':           0,
      'item':            null,
      'output':          'default',
      'terminalOutcome': 'completed',
      'result':          undefined,
      'cloneState':      cloneState,
    };
  }

  /** Run all items through initial + reduce + finalize on the given state. */
  static async run(
    strategy: GatherStrategy,
    state: CartographerState,
    accessor: DirectAccessor,
    items: EnrichedShipment[],
  ): Promise<void> {
    strategy.initial(CONFIG, state, accessor);
    const records: GatherRecordType<unknown>[] = items.map((e) => GatherHarness.record(e, accessor));
    const batch = Batch.from(records.map((r) => ({ 'id': '0', 'state': r })));
    strategy.reduce(CONFIG, batch, state, accessor);
    await strategy.finalize(CONFIG, {
      'state':    state,
      'records':  records,
      'dagName':  'test',
      'signal':   new AbortController().signal,
      'accessor': accessor,
      'invoker':  { invokeNode: async (): Promise<void> => { /* no-op for test */ } },
    });
  }

  /**
   * Simulate durable resume: run first half, snapshot, restore to fresh state,
   * then run second half and finalize.
   */
  static async resume(
    strategy: GatherStrategy,
    accessor: DirectAccessor,
    firstHalf: EnrichedShipment[],
    secondHalf: EnrichedShipment[],
  ): Promise<CartographerState> {
    // First pass
    const stateA = new CartographerState();
    strategy.initial(CONFIG, stateA, accessor);
    const recordsA: GatherRecordType<unknown>[] = firstHalf.map((e) => GatherHarness.record(e, accessor));
    const batchA = Batch.from(recordsA.map((r) => ({ 'id': '0', 'state': r })));
    strategy.reduce(CONFIG, batchA, stateA, accessor);

    // Snapshot stateA then restore into a fresh CartographerState instance
    const snapshot = stateA.snapshotJsonLd();
    const stateB = new CartographerState();
    await stateB.restoreJsonLd(stateA.runIri, snapshot);

    // Second pass on restored state — no initial() call (resume path: accumulators
    // are restored from checkpoint, not reset)
    const recordsB: GatherRecordType<unknown>[] = secondHalf.map((e) => GatherHarness.record(e, accessor));
    const batchB = Batch.from(recordsB.map((r) => ({ 'id': '0', 'state': r })));
    strategy.reduce(CONFIG, batchB, stateB, accessor);

    // Finalize
    await strategy.finalize(CONFIG, {
      'state':    stateB,
      'records':  [...recordsA, ...recordsB],
      'dagName':  'test',
      'signal':   new AbortController().signal,
      'accessor': accessor,
      'invoker':  { invokeNode: async (): Promise<void> => { /* no-op for test */ } },
    });

    return stateB;
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
// 6 deterministic items: 2 per region (Europe, Asia, Americas)

const ITEMS: EnrichedShipment[] = [
  FixtureShipment.of({ 'shipmentId': 'SHP-001', 'scanSeq': 1, 'continent': 'Europe',   'epochMs': 1_700_000_001_000, 'legKm': 100, 'subtotalUsdMinor': 5000, 'shippingUsdMinor': 1200, 'routing': { ...CartographerState.defaultRouting(), 'etaRun': true } }),
  FixtureShipment.of({ 'shipmentId': 'SHP-002', 'scanSeq': 1, 'continent': 'Europe',   'epochMs': 1_700_000_002_000, 'legKm': 200, 'subtotalUsdMinor': 6000, 'shippingUsdMinor': 1400, 'routing': { ...CartographerState.defaultRouting(), 'etaRun': true } }),
  FixtureShipment.of({ 'shipmentId': 'SHP-003', 'scanSeq': 1, 'continent': 'Asia',     'epochMs': 1_700_000_003_000, 'legKm': 300, 'subtotalUsdMinor': 7000, 'shippingUsdMinor': 1600, 'routing': CartographerState.defaultRouting() }),
  FixtureShipment.of({ 'shipmentId': 'SHP-004', 'scanSeq': 1, 'continent': 'Asia',     'epochMs': 1_700_000_004_000, 'legKm': 400, 'subtotalUsdMinor': 8000, 'shippingUsdMinor': 1800, 'routing': CartographerState.defaultRouting() }),
  FixtureShipment.of({ 'shipmentId': 'SHP-005', 'scanSeq': 1, 'continent': 'Americas', 'epochMs': 1_700_000_005_000, 'legKm': 500, 'subtotalUsdMinor': 9000, 'shippingUsdMinor': 2000, 'routing': CartographerState.defaultRouting() }),
  FixtureShipment.of({ 'shipmentId': 'SHP-006', 'scanSeq': 1, 'continent': 'Americas', 'epochMs': 1_700_000_006_000, 'legKm': 600, 'subtotalUsdMinor': 10000,'shippingUsdMinor': 2200, 'routing': CartographerState.defaultRouting() }),
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InsightsFoldGather durable-resume contract', () => {
  it('is registered under "insights-fold"', () => {
    const strategy = GatherStrategies.resolve('insights-fold');
    assert.ok(strategy, 'strategy must be registered');
    assert.equal(strategy.name, 'insights-fold');
    assert.ok(strategy instanceof InsightsFoldGather, 'must be InsightsFoldGather instance');
  });

  it('full run produces correct region shipmentCount', async () => {
    const strategy = GatherStrategies.resolve('insights-fold');
    assert.ok(strategy instanceof InsightsFoldGather);
    const accessor = new DirectAccessor();
    const state = new CartographerState();

    await GatherHarness.run(strategy, state, accessor, ITEMS);

    const fingerprint = InsightsFingerprint.of(state);
    assert.equal(fingerprint.totalShipmentCount, 6, 'all 6 items must be counted');
    assert.equal(fingerprint.journeyCount, 6, 'all 6 distinct journeys must be finalized');

    const europeSummary = fingerprint.regionSummaries.find((r) => r.region === 'Europe');
    const asiaSummary   = fingerprint.regionSummaries.find((r) => r.region === 'Asia');
    const americasSummary = fingerprint.regionSummaries.find((r) => r.region === 'Americas');

    assert.ok(europeSummary,    'Europe region must be present');
    assert.ok(asiaSummary,      'Asia region must be present');
    assert.ok(americasSummary,  'Americas region must be present');

    assert.equal(europeSummary.shipmentCount,   2, 'Europe: 2 shipments');
    assert.equal(asiaSummary.shipmentCount,     2, 'Asia: 2 shipments');
    assert.equal(americasSummary.shipmentCount, 2, 'Americas: 2 shipments');
  });

  it('sampleRecords keeps the newest 200 records in FIFO order', async () => {
    const strategy = GatherStrategies.resolve('insights-fold');
    assert.ok(strategy instanceof InsightsFoldGather);
    const accessor = new DirectAccessor();
    const state = new CartographerState();
    const items = Array.from({ 'length': 205 }, (_unused, index) =>
      FixtureShipment.of({
        'shipmentId': `SHP-${String(index).padStart(3, '0')}`,
        'scanSeq': index,
        'epochMs': 1_700_000_000_000 + index,
      }),
    );

    await GatherHarness.run(strategy, state, accessor, items);

    assert.equal(state.sampleRecords.length, 200);
    assert.equal(state.sampleRecords[0]?.shipmentId, 'SHP-005');
    assert.equal(state.sampleRecords[199]?.shipmentId, 'SHP-204');
  });

  it('snapshot → restore → resume produces same fingerprint as full run', async () => {
    const strategy = GatherStrategies.resolve('insights-fold');
    assert.ok(strategy instanceof InsightsFoldGather);
    const accessor = new DirectAccessor();

    // Baseline: run all 6 in one pass
    const baselineState = new CartographerState();
    await GatherHarness.run(strategy, baselineState, accessor, ITEMS);
    const baseline = InsightsFingerprint.of(baselineState);

    // Resume: first 3 → snapshot → restore → last 3
    const resumedState = await GatherHarness.resume(strategy, accessor, ITEMS.slice(0, 3), ITEMS.slice(3));
    const resumed = InsightsFingerprint.of(resumedState);

    assert.equal(resumed.totalShipmentCount, baseline.totalShipmentCount,
      'total shipmentCount must match after resume');
    assert.equal(resumed.journeyCount, baseline.journeyCount,
      'journey count must match after resume');
    assert.deepEqual(resumed.regionSummaries, baseline.regionSummaries,
      'per-region summaries must match after resume');
  });

  it('regionSummaries total shipmentCount is 6 after resume', async () => {
    const strategy = GatherStrategies.resolve('insights-fold');
    assert.ok(strategy instanceof InsightsFoldGather);
    const accessor = new DirectAccessor();

    const resumedState = await GatherHarness.resume(strategy, accessor, ITEMS.slice(0, 3), ITEMS.slice(3));
    const fingerprint = InsightsFingerprint.of(resumedState);
    assert.equal(fingerprint.totalShipmentCount, 6);
  });

  it('insights map is restored from snapshot (contains pre-restart accumulations)', async () => {
    const strategy = GatherStrategies.resolve('insights-fold');
    assert.ok(strategy instanceof InsightsFoldGather);
    const accessor = new DirectAccessor();

    // Run first 3 items, snapshot
    const stateA = new CartographerState();
    strategy.initial(CONFIG, stateA, accessor);
    const recordsA = ITEMS.slice(0, 3).map((e) => GatherHarness.record(e, accessor));
    const batchA = Batch.from(recordsA.map((r) => ({ 'id': '0', 'state': r })));
    strategy.reduce(CONFIG, batchA, stateA, accessor);

    // Verify accumulations exist in stateA
    assert.ok(stateA.insights.size > 0, 'insights must be non-empty after first reduce');
    assert.ok(stateA.journeyAccumulators.size > 0, 'journeyAccumulators must be non-empty after first reduce');

    // Snapshot and restore
    const snapshot = stateA.snapshotJsonLd();
    const stateB = new CartographerState();
    await stateB.restoreJsonLd(stateA.runIri, snapshot);

    // Confirm restored state has the accumulated insights
    assert.ok(stateB.insights.size > 0, 'restored insights must be non-empty');
    assert.ok(stateB.journeyAccumulators.size > 0, 'restored journeyAccumulators must be non-empty');

    // The Europe region (SHP-001, SHP-002) must be present with count 2
    // Asia (SHP-003) must be present with count 1
    let europeEntry: RegionInsights | undefined;
    let asiaEntry: RegionInsights | undefined;
    for (const [, r] of stateB.insights) {
      if (r.region === 'Europe') europeEntry = r;
      if (r.region === 'Asia') asiaEntry = r;
    }
    assert.ok(europeEntry, 'Europe must survive snapshot → restore');
    assert.ok(asiaEntry, 'Asia must survive snapshot → restore');
    assert.equal(europeEntry.shipmentCount, 2, 'Europe shipmentCount must be 2');
    assert.equal(asiaEntry.shipmentCount, 1, 'Asia shipmentCount must be 1');
  });
});
