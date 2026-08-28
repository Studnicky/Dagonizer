import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildLiveStreamFeed,
  buildCartographerBrowserTelemetry,
  CARTOGRAPHER_BROWSER_TELEMETRY_KEY,
  parseCartographerBrowserHarness,
} from '../../app/cartographerBrowserHarness.ts';
import type { EnrichedShipment } from '../../entities/EnrichedShipment.ts';

describe('cartographer browser harness', () => {
  it('parses autorun and clamped numeric query params', () => {
    const parsed = parseCartographerBrowserHarness('?autorun=1&loadTopology=1&totalEvents=1000001&poolSize=0&batchCapacity=2500&reservoirIdleMs=70000&liveFlushMs=5');

    assert.equal(parsed.autorun, true);
    assert.equal(parsed.loadEmbeddedTopology, true);
    assert.equal(parsed.totalEvents, 1_000_000);
    assert.equal(parsed.poolSize, 1);
    assert.equal(parsed.batchCapacity, 2500);
    assert.equal(parsed.reservoirIdleMs, 60_000);
    assert.equal(parsed.liveFlushMs, 16);
  });

  it('ignores invalid numeric query params', () => {
    const parsed = parseCartographerBrowserHarness('?totalEvents=nope&poolSize=&batchCapacity=nan&reservoirIdleMs=nope&liveFlushMs=');

    assert.equal(parsed.totalEvents, null);
    assert.equal(parsed.poolSize, null);
    assert.equal(parsed.batchCapacity, null);
    assert.equal(parsed.reservoirIdleMs, null);
    assert.equal(parsed.liveFlushMs, null);
  });

  it('builds a deterministic telemetry object shape', () => {
    const telemetry = buildCartographerBrowserTelemetry({
      'status': 'running',
      'progressPct': 42,
      'processedCount': 420,
      'totalEvents': 1000,
      'sampleRecordCount': 12,
      'insightCount': 6,
      'journeyCount': 4,
      'errorMessage': null,
      'flushCount': 9,
      'averageFlushMs': 3.5,
      'lastFlushMs': 4.25,
      'maxFlushMs': 6.75,
      'stateRefreshCount': 7,
      'skippedStateRefreshCount': 2,
      'graphMutationCount': 55,
    });

    assert.equal(telemetry.status, 'running');
    assert.equal(telemetry.progressPct, 42);
    assert.equal(telemetry.processedCount, 420);
    assert.equal(telemetry.totalEvents, 1000);
    assert.equal(telemetry.sampleRecordCount, 12);
    assert.equal(telemetry.insightCount, 6);
    assert.equal(telemetry.journeyCount, 4);
    assert.equal(telemetry.flushCount, 9);
    assert.equal(telemetry.averageFlushMs, 3.5);
    assert.equal(telemetry.lastFlushMs, 4.25);
    assert.equal(telemetry.maxFlushMs, 6.75);
    assert.equal(telemetry.stateRefreshCount, 7);
    assert.equal(telemetry.skippedStateRefreshCount, 2);
    assert.equal(telemetry.graphMutationCount, 55);
    assert.equal(typeof telemetry.timestamp, 'number');
    assert.equal(CARTOGRAPHER_BROWSER_TELEMETRY_KEY, '__cartographerTelemetry');
  });

  it('orders wrapped sample-record rings chronologically for the live feed', () => {
    const records = [
      { 'shipmentId': 'SHP-003', 'scanSeq': 3, 'status': 'DELIVERED', 'continent': 'Europe', 'redactionApplied': false },
      { 'shipmentId': 'SHP-004', 'scanSeq': 4, 'status': 'DELIVERED', 'continent': 'Europe', 'redactionApplied': false },
      { 'shipmentId': 'SHP-002', 'scanSeq': 2, 'status': 'IN_TRANSIT', 'continent': 'Asia', 'redactionApplied': true },
    ] as EnrichedShipment[];

    const feed = buildLiveStreamFeed(records, 2, true, 10);

    assert.deepEqual(
      feed.map((line) => line.shipmentId),
      ['SHP-002', 'SHP-003', 'SHP-004'],
    );
  });

  it('caps the live feed to the newest visible rows after ring reordering', () => {
    const records = [
      { 'shipmentId': 'SHP-003', 'scanSeq': 3, 'status': 'DELIVERED', 'continent': 'Europe', 'redactionApplied': false },
      { 'shipmentId': 'SHP-004', 'scanSeq': 4, 'status': 'DELIVERED', 'continent': 'Europe', 'redactionApplied': false },
      { 'shipmentId': 'SHP-001', 'scanSeq': 1, 'status': 'PICKED', 'continent': 'North America', 'redactionApplied': false },
      { 'shipmentId': 'SHP-002', 'scanSeq': 2, 'status': 'IN_TRANSIT', 'continent': 'Asia', 'redactionApplied': true },
    ] as EnrichedShipment[];

    const feed = buildLiveStreamFeed(records, 2, true, 2);

    assert.deepEqual(
      feed.map((line) => line.shipmentId),
      ['SHP-003', 'SHP-004'],
    );
  });
});
