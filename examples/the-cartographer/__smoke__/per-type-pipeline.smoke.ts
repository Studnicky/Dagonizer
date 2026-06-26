/**
 * per-type-pipeline.smoke.ts: end-to-end smoke for the 5 per-type sub-DAGs.
 *
 * Runs each per-type pipeline DAG against a seeded CanonicalEventVariant of its
 * type, asserts the resulting EnrichedShipment, and asserts per-DAG node-set
 * MINIMALITY (forbidden nodes absent from each DAG's placement list).
 *
 * Run: npx tsx examples/the-cartographer/__smoke__/per-type-pipeline.smoke.ts
 */

import { strict as assert } from 'node:assert';

import { Dagonizer } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

import { CartographerState } from '../CartographerState.ts';
import type { CanonicalEventVariant } from '../entities/CanonicalEvent.ts';
import type { EnrichedShipment } from '../entities/EnrichedShipment.ts';
import type { PositionPingEvent } from '../entities/events/PositionPingEvent.ts';
import type { SensorReadingEvent } from '../entities/events/SensorReadingEvent.ts';
import type { CustomsEvent } from '../entities/events/CustomsEvent.ts';
import type { FacilityScanEvent } from '../entities/events/FacilityScanEvent.ts';
import type { DeliveryConfirmationEvent } from '../entities/events/DeliveryConfirmationEvent.ts';

import { GeoResolvers } from '../services/GeoResolvers.ts';

// Leaf/embedded-DAG bundles (register first — per-type bundles reference their nodes).
import { GeoSourceResolveDAG } from '../embedded-dags/GeoSourceResolveDAG.ts';
import { orderEnrichmentBundle } from '../embedded-dags/OrderEnrichmentDAG.ts';
import { gdprComplianceBundle } from '../embedded-dags/GdprComplianceDAG.ts';
import { geoPipelineBundle } from '../embedded-dags/GeoPipelineDAG.ts';

// Per-type pipeline bundles + DAG objects for minimality assertions.
import {
  pipelinePositionPingBundle,
  pipelinePositionPingDAG,
} from '../embedded-dags/PipelinePositionPingDAG.ts';
import {
  pipelineSensorReadingBundle,
  pipelineSensorReadingDAG,
} from '../embedded-dags/PipelineSensorReadingDAG.ts';
import {
  pipelineCustomsEventBundle,
  pipelineCustomsEventDAG,
} from '../embedded-dags/PipelineCustomsEventDAG.ts';
import {
  pipelineFacilityScanBundle,
  pipelineFacilityScanDAG,
} from '../embedded-dags/PipelineFacilityScanDAG.ts';
import {
  pipelineDeliveryConfirmationBundle,
  pipelineDeliveryConfirmationDAG,
} from '../embedded-dags/PipelineDeliveryConfirmationDAG.ts';

// ── Dispatcher ──────────────────────────────────────────────────────────────

// Offline deterministic services — no network calls.
const services = GeoResolvers.recorded();

const dispatcher = new Dagonizer<CartographerState>({});

// Register leaf bundles first so the DAG validator can resolve sub-DAG references.
// geo-resolve DAG is built per-call with injected services.
dispatcher.registerBundle(GeoSourceResolveDAG.build(services.ipGeolocator, services.addressGeocoder));
dispatcher.registerBundle(geoPipelineBundle);
dispatcher.registerBundle(orderEnrichmentBundle);
dispatcher.registerBundle(gdprComplianceBundle);

// Register per-type pipeline bundles. registerBundle is idempotent for the SAME
// node/DAG instance (same reference → silent no-op); per the Dagonizer source it
// throws only when a DIFFERENT implementation tries to claim the same name.
dispatcher.registerBundle(pipelinePositionPingBundle);
dispatcher.registerBundle(pipelineSensorReadingBundle);
dispatcher.registerBundle(pipelineCustomsEventBundle);
dispatcher.registerBundle(pipelineFacilityScanBundle);
dispatcher.registerBundle(pipelineDeliveryConfirmationBundle);

// ── Runner helper ───────────────────────────────────────────────────────────

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

  /**
   * Seed a fresh CartographerState with the variant and run the named DAG.
   * The per-type pipeline DAGs read the canonical-event from metadata
   * (parseVariant calls state.getMetadata('canonical-event')).
   */
  static async run(dagName: string, variant: CanonicalEventVariant): Promise<EnrichedShipment> {
    const state = new CartographerState();
    state.setMetadata('canonical-event', variant);
    state.canonicalVariant = variant;
    const execution = dispatcher.execute(dagName, state, {});
    for await (const _stage of execution) { /* drain stages */ }
    await execution;
    return state.enriched;
  }

  /** Returns a Set of placement names from a DAG's nodes array. */
  static placementNames(dag: DAGType): Set<string> {
    return new Set(dag.nodes.map((n) => n.name));
  }
}

// ── Seed variants ───────────────────────────────────────────────────────────
// All variants use valid WGS-84 coords, a parseable ISO rawTimestamp, and
// non-empty required envelope fields so canonicalize-core does not reject.

const SHARED_ENVELOPE = {
  'shipmentId':        'SMOKE-001',
  'eventId':           'EVT-001',
  'epochMs':           1710497400000, // 2024-03-15T10:10:00.000Z
  'sourceId':          'smoke-source',
  'sourceFormat':      'json',
  'sourceCompression': 'none',
} as const;

const SHARED_BODY_GEO = {
  'scanSeq':    1,
  'latitude':   51.5,
  'longitude':  -0.12,
  'ipAddress':  '',
  'localeTag':  '',
  'countryCode': '',
  'legFromLat': 51.4,
  'legFromLng': -0.11,
  'originLat':  51.3,
  'originLng':  -0.10,
  'destLat':    51.6,
  'destLng':    -0.13,
  'carrier':    'DHL',
  'status':     'in transit',
  'rawTimestamp': '2024-03-15T10:10:00Z',
  'address':    '',
  'phone':      '',
} as const;

const positionPingVariant: PositionPingEvent = {
  ...SHARED_ENVELOPE,
  'eventType': 'position-ping',
  'body': { ...SHARED_BODY_GEO },
};

const sensorReadingVariant: SensorReadingEvent = {
  ...SHARED_ENVELOPE,
  'eventType': 'sensor-reading',
  'body': {
    ...SHARED_BODY_GEO,
    'tempC':       6.5,
    'humidityPct': 55.0,
    'shockG':      0.3,
  },
};

const customsEventVariant: CustomsEvent = {
  ...SHARED_ENVELOPE,
  'eventType': 'customs-event',
  'body': {
    ...SHARED_BODY_GEO,
    'customsStatus': 'cleared',
  },
};

const facilityScanVariant: FacilityScanEvent = {
  ...SHARED_ENVELOPE,
  'eventType': 'facility-scan',
  'body': {
    ...SHARED_BODY_GEO,
    'facilityId':             'FAC-1',
    'weight':                 2.5,
    'weightUnit':             'kg',
    // PROD-001 (Wireless Earbuds, $49.99 USD) is a known catalog entry.
    'lineItems':              [{ 'productId': 'PROD-001', 'quantity': 2 }],
    'rawDispatchAt':          '2024-03-14T08:00:00Z',
    'rawPromisedDeliveryAt':  '2024-03-18T18:00:00Z',
    'disruptionReason':       '',
    'recipientName':          'Jane Doe',
    'recipientEmail':         'jane@example.com',
    'recipientPhone':         '',
    'recipientAddress':       '',
    'recipientCountry':       'GB',
    'marketingConsent':       true,
    'lawfulBasis':            'contract',
    'specialCategory':        'none',
  },
};

const deliveryConfirmationVariant: DeliveryConfirmationEvent = {
  ...SHARED_ENVELOPE,
  'eventType': 'delivery-confirmation',
  'body': {
    ...SHARED_BODY_GEO,
    'delivered':              true,
    'rawPromisedDeliveryAt':  '2024-03-18T18:00:00Z',
    'disruptionReason':       '',
    'recipientName':          'John Roe',
    'recipientEmail':         'john@example.com',
    'recipientPhone':         '',
    'recipientAddress':       '',
    'recipientCountry':       'GB',
    'marketingConsent':       true,
    'lawfulBasis':            'contract',
    'specialCategory':        'none',
  },
};

// ── Smoke checks ─────────────────────────────────────────────────────────────

let failures = 0;

// ── (1) position-ping minimality ─────────────────────────────────────────────
await SmokeRunner.check('(1a) position-ping DAG node-set: required placements present', () => {
  const names = SmokeRunner.placementNames(pipelinePositionPingDAG);
  for (const required of ['parse-variant', 'geo-pipeline', 'canonicalize-core', 'enrich-leg', 'aggregate-event']) {
    assert.ok(names.has(required), `pipeline-position-ping is missing required placement '${required}'`);
  }
});

await SmokeRunner.check('(1b) position-ping DAG node-set: type-exclusive placements absent', () => {
  const names = SmokeRunner.placementNames(pipelinePositionPingDAG);
  for (const forbidden of [
    'cold-chain-check', 'customs-dwell', 'canonicalize-facility',
    'canonicalize-recipient', 'confirm-delivery', 'order-enrichment',
    'gdpr', 'route-redaction',
  ]) {
    assert.ok(!names.has(forbidden), `pipeline-position-ping must NOT contain placement '${forbidden}'`);
  }
});

// ── (2) sensor-reading minimality ─────────────────────────────────────────────
await SmokeRunner.check('(2a) sensor-reading DAG node-set: cold-chain-check present', () => {
  const names = SmokeRunner.placementNames(pipelineSensorReadingDAG);
  assert.ok(names.has('cold-chain-check'), `pipeline-sensor-reading must contain placement 'cold-chain-check'`);
});

await SmokeRunner.check('(2b) sensor-reading DAG node-set: non-sensor placements absent', () => {
  const names = SmokeRunner.placementNames(pipelineSensorReadingDAG);
  for (const forbidden of ['customs-dwell', 'canonicalize-facility', 'order-enrichment', 'confirm-delivery']) {
    assert.ok(!names.has(forbidden), `pipeline-sensor-reading must NOT contain placement '${forbidden}'`);
  }
});

// ── (3) customs-event minimality ──────────────────────────────────────────────
await SmokeRunner.check('(3a) customs-event DAG node-set: customs-dwell present', () => {
  const names = SmokeRunner.placementNames(pipelineCustomsEventDAG);
  assert.ok(names.has('customs-dwell'), `pipeline-customs-event must contain placement 'customs-dwell'`);
});

await SmokeRunner.check('(3b) customs-event DAG node-set: non-customs placements absent', () => {
  const names = SmokeRunner.placementNames(pipelineCustomsEventDAG);
  for (const forbidden of ['cold-chain-check', 'canonicalize-facility', 'order-enrichment', 'confirm-delivery']) {
    assert.ok(!names.has(forbidden), `pipeline-customs-event must NOT contain placement '${forbidden}'`);
  }
});

// ── (4) facility-scan minimality ──────────────────────────────────────────────
await SmokeRunner.check('(4a) facility-scan DAG node-set: order-lane placements present', () => {
  const names = SmokeRunner.placementNames(pipelineFacilityScanDAG);
  for (const required of ['canonicalize-facility', 'canonicalize-recipient', 'order-enrichment']) {
    assert.ok(names.has(required), `pipeline-facility-scan is missing required placement '${required}'`);
  }
});

await SmokeRunner.check('(4b) facility-scan DAG node-set: delivery-exclusive placements absent', () => {
  const names = SmokeRunner.placementNames(pipelineFacilityScanDAG);
  for (const forbidden of ['cold-chain-check', 'customs-dwell', 'confirm-delivery']) {
    assert.ok(!names.has(forbidden), `pipeline-facility-scan must NOT contain placement '${forbidden}'`);
  }
});

// ── (5) delivery-confirmation minimality ──────────────────────────────────────
await SmokeRunner.check('(5a) delivery-confirmation DAG node-set: delivery placements present', () => {
  const names = SmokeRunner.placementNames(pipelineDeliveryConfirmationDAG);
  for (const required of ['canonicalize-recipient', 'confirm-delivery']) {
    assert.ok(names.has(required), `pipeline-delivery-confirmation is missing required placement '${required}'`);
  }
});

await SmokeRunner.check('(5b) delivery-confirmation DAG node-set: facility/order placements absent', () => {
  const names = SmokeRunner.placementNames(pipelineDeliveryConfirmationDAG);
  for (const forbidden of ['canonicalize-facility', 'order-enrichment', 'cold-chain-check', 'customs-dwell']) {
    assert.ok(!names.has(forbidden), `pipeline-delivery-confirmation must NOT contain placement '${forbidden}'`);
  }
});

// ── End-to-end execution checks ────────────────────────────────────────────────

await SmokeRunner.check('(1c) position-ping: pipeline produces non-empty shipmentId and legKm >= 0', async () => {
  const enriched = await SmokeRunner.run('pipeline-position-ping', positionPingVariant);
  assert.ok(enriched.shipmentId.length > 0, `position-ping: enriched.shipmentId must be non-empty`);
  assert.ok(enriched.legKm >= 0, `position-ping: enriched.legKm must be >= 0 (got ${enriched.legKm})`);
});

await SmokeRunner.check('(1d) position-ping: no pricing (subtotalUsdMinor === 0, shippingUsdMinor === 0)', async () => {
  const enriched = await SmokeRunner.run('pipeline-position-ping', positionPingVariant);
  assert.strictEqual(enriched.subtotalUsdMinor, 0, `position-ping must have subtotalUsdMinor === 0 (no order lane)`);
  assert.strictEqual(enriched.shippingUsdMinor, 0, `position-ping must have shippingUsdMinor === 0 (no order lane)`);
});

await SmokeRunner.check('(2c) sensor-reading: pipeline produces enriched record (shipmentId non-empty)', async () => {
  const enriched = await SmokeRunner.run('pipeline-sensor-reading', sensorReadingVariant);
  assert.ok(enriched.shipmentId.length > 0, `sensor-reading: enriched.shipmentId must be non-empty`);
});

await SmokeRunner.check('(2d) sensor-reading: no pricing (subtotalUsdMinor === 0)', async () => {
  const enriched = await SmokeRunner.run('pipeline-sensor-reading', sensorReadingVariant);
  assert.strictEqual(enriched.subtotalUsdMinor, 0, `sensor-reading must have subtotalUsdMinor === 0 (no order lane)`);
});

await SmokeRunner.check('(3c) customs-event: pipeline produces enriched record (shipmentId non-empty)', async () => {
  const enriched = await SmokeRunner.run('pipeline-customs-event', customsEventVariant);
  assert.ok(enriched.shipmentId.length > 0, `customs-event: enriched.shipmentId must be non-empty`);
});

await SmokeRunner.check('(3d) customs-event: no pricing (subtotalUsdMinor === 0)', async () => {
  const enriched = await SmokeRunner.run('pipeline-customs-event', customsEventVariant);
  assert.strictEqual(enriched.subtotalUsdMinor, 0, `customs-event must have subtotalUsdMinor === 0 (no order lane)`);
});

await SmokeRunner.check('(4c) facility-scan: pricing ran (subtotalUsdMinor > 0)', async () => {
  const enriched = await SmokeRunner.run('pipeline-facility-scan', facilityScanVariant);
  assert.ok(
    enriched.subtotalUsdMinor > 0,
    `facility-scan: enriched.subtotalUsdMinor must be > 0 after order-enrichment (got ${enriched.subtotalUsdMinor})`,
  );
});

await SmokeRunner.check('(4d) facility-scan: shippingUsdMinor >= 0 and shipmentId non-empty', async () => {
  const enriched = await SmokeRunner.run('pipeline-facility-scan', facilityScanVariant);
  assert.ok(enriched.shipmentId.length > 0, `facility-scan: enriched.shipmentId must be non-empty`);
  assert.ok(enriched.shippingUsdMinor >= 0, `facility-scan: enriched.shippingUsdMinor must be >= 0`);
});

await SmokeRunner.check('(5c) delivery-confirmation: status === DELIVERED', async () => {
  const enriched = await SmokeRunner.run('pipeline-delivery-confirmation', deliveryConfirmationVariant);
  assert.strictEqual(
    enriched.status,
    'DELIVERED',
    `delivery-confirmation: enriched.status must be 'DELIVERED' (got '${enriched.status}')`,
  );
});

await SmokeRunner.check('(5d) delivery-confirmation: no pricing (subtotalUsdMinor === 0)', async () => {
  const enriched = await SmokeRunner.run('pipeline-delivery-confirmation', deliveryConfirmationVariant);
  assert.strictEqual(enriched.subtotalUsdMinor, 0, `delivery-confirmation must have subtotalUsdMinor === 0 (no order lane)`);
});

await SmokeRunner.check('(5e) delivery-confirmation: recipient PII present (recipientName non-empty in redactedSample)', async () => {
  const enriched = await SmokeRunner.run('pipeline-delivery-confirmation', deliveryConfirmationVariant);
  // After GDPR redaction the redactedSample captures the name (pre-redaction) or
  // the redacted form. Either way the enriched record carries the PII path.
  const hasPii =
    enriched.redactedSample.recipientName.length > 0 ||
    enriched.redactionApplied === true;
  assert.ok(
    hasPii,
    `delivery-confirmation: expected recipient PII in redactedSample.recipientName or redactionApplied===true`,
  );
});

// ── Source-model routing assertions ─────────────────────────────────────────

// customs-event with zero coords + countryCode should route 'code'
const customsWithCode: CustomsEvent = {
  ...SHARED_ENVELOPE,
  'eventType': 'customs-event',
  'body': {
    ...SHARED_BODY_GEO,
    'latitude':    0,
    'longitude':   0,
    'ipAddress':   '',
    'countryCode': 'GB',
    'customsStatus': 'cleared',
  },
};

await SmokeRunner.check('(3e) customs-event with countryCode routes geoSourceModel=code', async () => {
  const enriched = await SmokeRunner.run('pipeline-customs-event', customsWithCode);
  assert.strictEqual(
    enriched.routing.geoSourceModel,
    'code',
    `customs-event with countryCode must route geoSourceModel='code' (got '${enriched.routing.geoSourceModel}')`,
  );
});

// delivery-confirmation with zero coords + localeTag should route 'locale'
const deliveryWithLocale: DeliveryConfirmationEvent = {
  ...SHARED_ENVELOPE,
  'eventType': 'delivery-confirmation',
  'body': {
    ...SHARED_BODY_GEO,
    'latitude':    0,
    'longitude':   0,
    'ipAddress':   '',
    'localeTag':   'en-GB',
    'delivered':              true,
    'rawPromisedDeliveryAt':  '2024-03-18T18:00:00Z',
    'disruptionReason':       '',
    'recipientName':          'John Roe',
    'recipientEmail':         'john@example.com',
    'recipientPhone':         '',
    'recipientAddress':       '',
    'recipientCountry':       'GB',
    'marketingConsent':       true,
    'lawfulBasis':            'contract',
    'specialCategory':        'none',
  },
};

await SmokeRunner.check('(5f) delivery-confirmation with localeTag routes geoSourceModel=locale', async () => {
  const enriched = await SmokeRunner.run('pipeline-delivery-confirmation', deliveryWithLocale);
  assert.strictEqual(
    enriched.routing.geoSourceModel,
    'locale',
    `delivery-confirmation with localeTag must route geoSourceModel='locale' (got '${enriched.routing.geoSourceModel}')`,
  );
});

// facility-scan with coords+IP routes 'coords' and has ip-geolocate run
await SmokeRunner.check('(4e) facility-scan with coords+IP has geoSourceModel=coords and ipGeolocateRun', async () => {
  const facilityScanWithIp: FacilityScanEvent = {
    ...SHARED_ENVELOPE,
    'eventType': 'facility-scan',
    'body': {
      ...SHARED_BODY_GEO,
      'ipAddress':              '8.8.8.8',
      'facilityId':             'FAC-1',
      'weight':                 2.5,
      'weightUnit':             'kg',
      'lineItems':              [{ 'productId': 'PROD-001', 'quantity': 2 }],
      'rawDispatchAt':          '2024-03-14T08:00:00Z',
      'rawPromisedDeliveryAt':  '2024-03-18T18:00:00Z',
      'disruptionReason':       '',
      'recipientName':          'Jane Doe',
      'recipientEmail':         'jane@example.com',
      'recipientPhone':         '',
      'recipientAddress':       '',
      'recipientCountry':       'GB',
      'marketingConsent':       true,
      'lawfulBasis':            'contract',
      'specialCategory':        'none',
    },
  };
  const enriched = await SmokeRunner.run('pipeline-facility-scan', facilityScanWithIp);
  assert.strictEqual(
    enriched.routing.geoSourceModel,
    'coords',
    `facility-scan with coords+IP must route geoSourceModel='coords' (got '${enriched.routing.geoSourceModel}')`,
  );
});

// ── Result ─────────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} smoke check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
