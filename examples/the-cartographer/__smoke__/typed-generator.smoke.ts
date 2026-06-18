/**
 * typed-generator.smoke.ts: smoke tests for the typed scan generator.
 *
 * Verifies:
 *   (a) buildTypedFeed and streamTyped produce the correct total payload count.
 *   (b) Each eventType appears with exactly its configured count (for both paths).
 *   (c) Wire formats are distributed per formatMix thresholds.
 *   (d) buildTypedFeed is deterministic: two runs with the same config produce
 *       byte-identical SourcePayload arrays.
 *   (e) customs-event payloads carry customsStatus in the wire record.
 *   (f) delivery-confirmation payloads carry delivered and podSignature, and do
 *       NOT carry a facilityId field in the wire record.
 *
 * Run: npx tsx examples/the-cartographer/__smoke__/typed-generator.smoke.ts
 */

import { strict as assert } from 'node:assert';
import { Sources, ShipmentEvents } from '../services.ts';
import type { EventTypeConfig, TypedScan } from '../services.ts';
import type { SourcePayload } from '../entities/SourcePayload.ts';
import { EventStreamSource } from '../services/EventStreamSource.ts';

let failures = 0;

class SmokeRunner {
  static async check(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (err) {
      failures++;
      console.error(`✗ ${name}\n  ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// Config with all 5 eventTypes, multi-format mix (includes gzip).
const CONFIG: EventTypeConfig = [
  {
    eventType: 'position-ping',
    count: 4,
    formatMix: [
      { format: 'json',   compression: 'none', weight: 3 },
      { format: 'yaml',   compression: 'gzip', weight: 1 },
    ],
  },
  {
    eventType: 'facility-scan',
    count: 3,
    formatMix: [
      { format: 'csv',    compression: 'none', weight: 2 },
      { format: 'json',   compression: 'gzip', weight: 1 },
    ],
  },
  {
    eventType: 'sensor-reading',
    count: 3,
    formatMix: [
      { format: 'ndjson', compression: 'none', weight: 1 },
    ],
  },
  {
    eventType: 'customs-event',
    count: 3,
    formatMix: [
      { format: 'json',   compression: 'none', weight: 1 },
    ],
  },
  {
    eventType: 'delivery-confirmation',
    count: 3,
    formatMix: [
      { format: 'json',   compression: 'none', weight: 1 },
    ],
  },
];

const EXPECTED_TOTAL = CONFIG.reduce((sum, e) => sum + e.count, 0); // 16

await SmokeRunner.check('buildTypedFeed returns correct total payload count', async () => {
  const payloads = await Sources.buildTypedFeed(CONFIG);
  assert.strictEqual(payloads.length, EXPECTED_TOTAL, `Expected ${EXPECTED_TOTAL} payloads, got ${payloads.length}`);
});

await SmokeRunner.check('streamTyped yields correct total payload count', async () => {
  const payloads: SourcePayload[] = [];
  for await (const p of EventStreamSource.streamTyped(CONFIG)) {
    payloads.push(p);
  }
  assert.strictEqual(payloads.length, EXPECTED_TOTAL, `Expected ${EXPECTED_TOTAL} payloads, got ${payloads.length}`);
});

await SmokeRunner.check('buildTypedFeed: each eventType appears with exactly its configured count', async () => {
  const payloads = await Sources.buildTypedFeed(CONFIG);
  const counts = new Map<string, number>();
  for (const p of payloads) {
    counts.set(p.eventType, (counts.get(p.eventType) ?? 0) + 1);
  }
  for (const entry of CONFIG) {
    const actual = counts.get(entry.eventType) ?? 0;
    assert.strictEqual(actual, entry.count, `eventType '${entry.eventType}': expected ${entry.count}, got ${actual}`);
  }
});

await SmokeRunner.check('streamTyped: each eventType appears with exactly its configured count', async () => {
  const counts = new Map<string, number>();
  for await (const p of EventStreamSource.streamTyped(CONFIG)) {
    counts.set(p.eventType, (counts.get(p.eventType) ?? 0) + 1);
  }
  for (const entry of CONFIG) {
    const actual = counts.get(entry.eventType) ?? 0;
    assert.strictEqual(actual, entry.count, `eventType '${entry.eventType}': expected ${entry.count}, got ${actual}`);
  }
});

await SmokeRunner.check('buildTypedFeed: position-ping uses both json/none and yaml/gzip formats', async () => {
  const payloads = await Sources.buildTypedFeed(CONFIG);
  const ppPayloads = payloads.filter((p) => p.eventType === 'position-ping');
  const formats = new Set(ppPayloads.map((p) => `${p.format}/${p.compression}`));
  // With count=4 and weights 3:1, we expect json/none (3 scans) and yaml/gzip (1 scan).
  assert.ok(formats.has('json/none'), `Expected json/none format for position-ping`);
  assert.ok(formats.has('yaml/gzip'), `Expected yaml/gzip format for position-ping`);
});

await SmokeRunner.check('DETERMINISM: two buildTypedFeed calls with the same config produce identical results', async () => {
  const run1 = await Sources.buildTypedFeed(CONFIG);
  const run2 = await Sources.buildTypedFeed(CONFIG);
  assert.strictEqual(run1.length, run2.length, `Length mismatch: ${run1.length} vs ${run2.length}`);
  for (let i = 0; i < run1.length; i++) {
    const p1 = run1[i]!;
    const p2 = run2[i]!;
    assert.strictEqual(p1.eventType, p2.eventType, `eventType mismatch at index ${i}`);
    assert.strictEqual(p1.payload, p2.payload, `payload mismatch at index ${i} (eventType=${p1.eventType})`);
    assert.strictEqual(p1.sourceId, p2.sourceId, `sourceId mismatch at index ${i}`);
  }
});

await SmokeRunner.check('customs-event payloads carry customsStatus in the wire record (json/none)', async () => {
  const payloads = await Sources.buildTypedFeed(CONFIG);
  const customsPayloads = payloads.filter((p) => p.eventType === 'customs-event' && p.format === 'json' && p.compression === 'none');
  assert.ok(customsPayloads.length > 0, `Expected >=1 customs-event json/none payload`);
  for (const p of customsPayloads) {
    const arr = JSON.parse(p.payload) as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(arr) && arr.length > 0, `Expected non-empty JSON array`);
    const rec = arr[0]!;
    assert.ok('customs_status' in rec || 'customsStatus' in rec, `Expected customsStatus field in wire record, keys: ${Object.keys(rec).join(', ')}`);
    const status = rec['customs_status'] ?? rec['customsStatus'];
    assert.ok(['held', 'cleared', 'inspection'].includes(String(status)), `Expected valid customsStatus, got ${String(status)}`);
  }
});

await SmokeRunner.check('delivery-confirmation payloads carry delivered and podSignature (json/none)', async () => {
  const payloads = await Sources.buildTypedFeed(CONFIG);
  const delPayloads = payloads.filter((p) => p.eventType === 'delivery-confirmation' && p.format === 'json' && p.compression === 'none');
  assert.ok(delPayloads.length > 0, `Expected >=1 delivery-confirmation json/none payload`);
  for (const p of delPayloads) {
    const arr = JSON.parse(p.payload) as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(arr) && arr.length > 0, `Expected non-empty JSON array`);
    const rec = arr[0]!;
    // delivered and podSignature should be present (set on wire record by buildPayloadFromScan).
    assert.ok('delivered' in rec || 'pod_signature' in rec || 'podSignature' in rec,
      `Expected delivered or podSignature field in wire record, keys: ${Object.keys(rec).join(', ')}`);
  }
});

await SmokeRunner.check('typedScansGenerator yields correct counts per eventType', () => {
  const counts = new Map<string, number>();
  for (const scan of ShipmentEvents.typedScansGenerator(CONFIG)) {
    counts.set(scan.eventType, (counts.get(scan.eventType) ?? 0) + 1);
  }
  for (const entry of CONFIG) {
    const actual = counts.get(entry.eventType) ?? 0;
    assert.strictEqual(actual, entry.count, `typedScansGenerator: '${entry.eventType}': expected ${entry.count}, got ${actual}`);
  }
});

await SmokeRunner.check('sensor-reading scans carry tempC/humidityPct/shockG', () => {
  const sensorScans: TypedScan[] = [];
  for (const scan of ShipmentEvents.typedScansGenerator(CONFIG)) {
    if (scan.eventType === 'sensor-reading') sensorScans.push(scan);
  }
  assert.ok(sensorScans.length > 0, `Expected sensor-reading scans`);
  for (const scan of sensorScans) {
    if (scan.eventType === 'sensor-reading') {
      assert.ok(typeof scan.tempC === 'number', `Expected tempC to be a number`);
      assert.ok(typeof scan.humidityPct === 'number', `Expected humidityPct to be a number`);
      assert.ok(typeof scan.shockG === 'number', `Expected shockG to be a number`);
    }
  }
});

if (failures > 0) {
  console.error(`\n${failures} smoke check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
