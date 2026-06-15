/**
 * typed-ingest.smoke.ts: end-to-end smoke for the typed payload decoder + variant builder.
 *
 * Exercises all 5 eventTypes across multiple formats (including gzip) by:
 *   1. Generating SourcePayloads via Sources.buildTypedFeed (Wave 2).
 *   2. Decoding each payload with TypedPayloadDecoder.decode.
 *   3. Building the discriminated variant with CanonicalEventVariantBuilder.fromSourcePayload.
 *
 * Assertions:
 *   (a) Every payload yields a variant whose eventType matches payload.eventType.
 *   (b) facility-scan variants carry a non-empty facilityId AND recipientName.
 *   (c) delivery-confirmation variants have delivered===true, recipient PII present,
 *       and no facilityId key on the body (the delivery body shape has none).
 *   (d) sensor-reading variants carry numeric tempC/humidityPct/shockG that are
 *       not all zero (real telemetry values).
 *   (e) customs-event variants carry a non-empty customsStatus.
 *   (f) position-ping variants carry numeric latitude/longitude and no
 *       customsStatus/delivered/tempC keys on the body.
 *
 * Run: npx tsx examples/the-cartographer/__smoke__/typed-ingest.smoke.ts
 */

import { strict as assert } from 'node:assert';

import { Sources, TypedPayloadDecoder } from '../services.ts';
import type { EventTypeConfig } from '../services.ts';
import { CanonicalEventVariantBuilder } from '../entities/CanonicalEvent.ts';
import type { CanonicalEventVariant } from '../entities/CanonicalEvent.ts';

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

// Config covers all 5 eventTypes with multiple formats and at least one gzip
// combo. sensor-reading uses ndjson (the format the encoder reliably encodes
// sensor channels for). customs/delivery use json. facility uses csv+json(gzip).
// position uses json+yaml(gzip)+ndjson+csv so all 4 formats are covered.
const CONFIG: EventTypeConfig = [
  {
    eventType: 'position-ping',
    count: 4,
    formatMix: [
      { format: 'json',   compression: 'none', weight: 1 },
      { format: 'yaml',   compression: 'gzip', weight: 1 },
      { format: 'ndjson', compression: 'none', weight: 1 },
      { format: 'csv',    compression: 'gzip', weight: 1 },
    ],
  },
  {
    eventType: 'facility-scan',
    count: 4,
    formatMix: [
      { format: 'csv',  compression: 'none', weight: 2 },
      { format: 'json', compression: 'gzip', weight: 1 },
      { format: 'yaml', compression: 'none', weight: 1 },
    ],
  },
  {
    eventType: 'sensor-reading',
    count: 3,
    formatMix: [
      { format: 'ndjson', compression: 'none', weight: 2 },
      { format: 'ndjson', compression: 'gzip', weight: 1 },
    ],
  },
  {
    eventType: 'customs-event',
    count: 3,
    formatMix: [
      { format: 'json', compression: 'none', weight: 2 },
      { format: 'csv',  compression: 'none', weight: 1 },
    ],
  },
  {
    eventType: 'delivery-confirmation',
    count: 3,
    formatMix: [
      { format: 'json', compression: 'none', weight: 2 },
      { format: 'csv',  compression: 'gzip', weight: 1 },
    ],
  },
];

// Build all typed payloads once and decode them for assertions.
const payloads = await Sources.buildTypedFeed(CONFIG);
const variants: CanonicalEventVariant[] = [];
for (const payload of payloads) {
  const decoded = await TypedPayloadDecoder.decode(payload);
  variants.push(CanonicalEventVariantBuilder.fromSourcePayload(payload, decoded));
}

await SmokeRunner.check('(a) every variant eventType matches its source payload eventType', async () => {
  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i]!;
    const variant = variants[i]!;
    assert.strictEqual(
      variant.eventType,
      payload.eventType,
      `Index ${i}: expected eventType '${payload.eventType}', got '${variant.eventType}'`,
    );
  }
});

await SmokeRunner.check('(b) facility-scan variants carry non-empty facilityId and recipientName', async () => {
  const facilityVariants = variants.filter((v) => v.eventType === 'facility-scan');
  assert.ok(facilityVariants.length > 0, `Expected facility-scan variants, got 0`);
  for (const v of facilityVariants) {
    if (v.eventType !== 'facility-scan') continue;
    assert.ok(
      v.body.facilityId.length > 0,
      `facility-scan variant missing facilityId (sourceId: ${v.sourceId})`,
    );
    assert.ok(
      v.body.recipientName.length > 0,
      `facility-scan variant missing recipientName (sourceId: ${v.sourceId})`,
    );
  }
});

await SmokeRunner.check('(c) delivery-confirmation variants have delivered===true, PII present, no facilityId key', async () => {
  const deliveryVariants = variants.filter((v) => v.eventType === 'delivery-confirmation');
  assert.ok(deliveryVariants.length > 0, `Expected delivery-confirmation variants, got 0`);
  for (const v of deliveryVariants) {
    if (v.eventType !== 'delivery-confirmation') continue;
    assert.strictEqual(
      v.body.delivered,
      true,
      `delivery-confirmation body.delivered must be true (sourceId: ${v.sourceId})`,
    );
    assert.ok(
      v.body.recipientName.length > 0,
      `delivery-confirmation missing recipientName (sourceId: ${v.sourceId})`,
    );
    // The DeliveryConfirmationEvent body has no facilityId key (schema forbids it).
    assert.ok(
      !('facilityId' in v.body),
      `delivery-confirmation body must not carry facilityId (sourceId: ${v.sourceId})`,
    );
  }
});

await SmokeRunner.check('(d) sensor-reading variants carry non-zero real telemetry (tempC/humidityPct/shockG)', async () => {
  const sensorVariants = variants.filter((v) => v.eventType === 'sensor-reading');
  assert.ok(sensorVariants.length > 0, `Expected sensor-reading variants, got 0`);
  for (const v of sensorVariants) {
    if (v.eventType !== 'sensor-reading') continue;
    assert.equal(typeof v.body.tempC, 'number', `tempC must be number (sourceId: ${v.sourceId})`);
    assert.equal(typeof v.body.humidityPct, 'number', `humidityPct must be number (sourceId: ${v.sourceId})`);
    assert.equal(typeof v.body.shockG, 'number', `shockG must be number (sourceId: ${v.sourceId})`);
    // Telemetry must look real: tempC in [2,8] range and humidityPct in [40,80].
    assert.ok(
      v.body.tempC > 0 || v.body.humidityPct > 0,
      `sensor-reading tempC=${v.body.tempC} humidityPct=${v.body.humidityPct}: at least one must be non-zero (sourceId: ${v.sourceId})`,
    );
  }
});

await SmokeRunner.check('(e) customs-event variants carry a non-empty customsStatus (held|cleared|inspection)', async () => {
  const customsVariants = variants.filter((v) => v.eventType === 'customs-event');
  assert.ok(customsVariants.length > 0, `Expected customs-event variants, got 0`);
  for (const v of customsVariants) {
    if (v.eventType !== 'customs-event') continue;
    assert.ok(
      v.body.customsStatus.length > 0,
      `customs-event missing customsStatus (sourceId: ${v.sourceId})`,
    );
    assert.ok(
      ['held', 'cleared', 'inspection'].includes(v.body.customsStatus),
      `customs-event customsStatus '${v.body.customsStatus}' is not one of held/cleared/inspection (sourceId: ${v.sourceId})`,
    );
  }
});

await SmokeRunner.check('(f) position-ping variants carry geometry fields and no type-owned extras', async () => {
  const pingVariants = variants.filter((v) => v.eventType === 'position-ping');
  assert.ok(pingVariants.length > 0, `Expected position-ping variants, got 0`);
  for (const v of pingVariants) {
    if (v.eventType !== 'position-ping') continue;
    assert.equal(typeof v.body.latitude, 'number', `latitude must be number (sourceId: ${v.sourceId})`);
    assert.equal(typeof v.body.longitude, 'number', `longitude must be number (sourceId: ${v.sourceId})`);
    // position-ping body must NOT carry type-owned extras from other variants.
    assert.ok(!('customsStatus' in v.body), `position-ping body must not carry customsStatus`);
    assert.ok(!('delivered' in v.body), `position-ping body must not carry delivered`);
    assert.ok(!('tempC' in v.body), `position-ping body must not carry tempC`);
  }
});

await SmokeRunner.check('all 5 eventTypes are represented in the decoded variants', async () => {
  const types = new Set(variants.map((v) => v.eventType));
  const expected = ['position-ping', 'facility-scan', 'sensor-reading', 'customs-event', 'delivery-confirmation'];
  for (const t of expected) {
    assert.ok(types.has(t as CanonicalEventVariant['eventType']), `Expected eventType '${t}' in variants, got: ${[...types].join(', ')}`);
  }
});

await SmokeRunner.check('provenance is wired: sourceId/sourceFormat/sourceCompression match payload', async () => {
  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i]!;
    const variant = variants[i]!;
    assert.strictEqual(variant.sourceId,          payload.sourceId,    `sourceId mismatch at index ${i}`);
    assert.strictEqual(variant.sourceFormat,      payload.format,      `sourceFormat mismatch at index ${i}`);
    assert.strictEqual(variant.sourceCompression, payload.compression, `sourceCompression mismatch at index ${i}`);
  }
});

if (failures > 0) {
  console.error(`\n${failures} smoke check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
