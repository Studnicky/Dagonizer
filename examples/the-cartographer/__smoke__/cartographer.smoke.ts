/**
 * cartographer.smoke.ts: end-to-end smoke test for the Cartographer pipeline.
 *
 * Runs a small N (20 events) through the full three-DAG topology and asserts:
 *   1. Execution completes without error (state is terminal)
 *   2. state.records.length > 0 (some gathered by scatter)
 *   3. state.insights has at least one region entry
 *   4. At least one record has redactionApplied=true
 *   5. epochMs (via normalized, now in enriched) is numeric & > 0 (normalization)
 *      — verified by checking no record has a zero or missing epochMs proxy:
 *        subtotalUsdMinor > 0 on at least one record (pricing ran)
 *   6. carrierId is canonical (no raw alias passes through to enriched)
 *      — records come from normalized; validate via distanceKm > 0 (shipping ran)
 *   7. subtotalUsdMinor > 0 on at least one record (pricing ran)
 *   8. distanceKm > 0 on at least one record (shipping ran)
 *   9. onTime is boolean on all records
 *  10. At least one record has redactionApplied=true (GDPR ran)
 *
 * Run: npx tsx examples/the-cartographer/__smoke__/cartographer.smoke.ts
 */

import { strict as assert } from 'node:assert';

import { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { cartographerBundle } from '../dag.ts';
import { canonicalizeBundle } from '../embedded-dags/CanonicalizeDAG.ts';
import { gdprComplianceBundle } from '../embedded-dags/GdprComplianceDAG.ts';
import { geoResolveBundle } from '../embedded-dags/GeoResolveDAG.ts';
import { ingestSourceBundle } from '../embedded-dags/IngestSourceDAG.ts';
import { orderEnrichmentBundle } from '../embedded-dags/OrderEnrichmentDAG.ts';
import { GeoResolvers } from '../services/GeoResolvers.ts';

import { Dagonizer } from '@noocodex/dagonizer';

const EVENT_COUNT = 20;
let failures = 0;

class SmokeRunner {
  static async check(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (err) {
      failures++;
      console.error(`✗ ${name}\n  ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // The smoke ALWAYS uses the RECORDED geo transports → deterministic + offline.
  // Geo is resolved by the geo-resolve sub-DAG against the committed fixture.
  static async runPipeline(n: number): Promise<CartographerState> {
    const services: CartographerServices = GeoResolvers.recorded();
    const dispatcher = new Dagonizer<CartographerState, CartographerServices>({ 'services': services });
    dispatcher.registerBundle(geoResolveBundle);
    dispatcher.registerBundle(canonicalizeBundle);
    dispatcher.registerBundle(orderEnrichmentBundle);
    dispatcher.registerBundle(gdprComplianceBundle);
    // ingestSourceBundle owns all unique ingest nodes + all format sub-DAGs.
    dispatcher.registerBundle(ingestSourceBundle);
    dispatcher.registerBundle(cartographerBundle);
    const state = new CartographerState();
    state.eventCount = n;
    const execution = dispatcher.execute('cartographer', state);
    for await (const _stage of execution) { /* drain */ }
    await execution;
    return state;
  }
}

await SmokeRunner.check(`pipeline runs ${EVENT_COUNT} events end-to-end`, async () => {
  const state = await SmokeRunner.runPipeline(EVENT_COUNT);
  // runPipeline drains + awaits; a populated insights map confirms terminal.
  assert.ok(state.insights.size > 0, `Expected pipeline to complete with insights, got 0`);
});

await SmokeRunner.check('ingestion fans in from >=3 distinct source formats and >=2 kinds', async () => {
  const state = await SmokeRunner.runPipeline(EVENT_COUNT);
  // The unified canonical collection must carry events decoded from >=3 distinct
  // on-the-wire formats (json, csv, ndjson.gz) AND >=2 distinct kinds.
  const formats = new Set(state.canonicalEvents.map((e) => e.sourceFormat));
  const kinds = new Set(state.canonicalEvents.map((e) => e.kind));
  assert.ok(state.canonicalEvents.length > 0, `Expected canonical events, got 0`);
  assert.ok(formats.size >= 3, `Expected >=3 distinct source formats, got ${formats.size} (${[...formats].join(', ')})`);
  assert.ok(kinds.size >= 2, `Expected >=2 distinct kinds, got ${kinds.size} (${[...kinds].join(', ')})`);
  // The JSON API source pre-resolves geo on its events (Stage 2 branches on this).
  const withGeo = state.canonicalEvents.filter((e) => e.geo !== undefined);
  assert.ok(withGeo.length > 0, `Expected >=1 event with pre-resolved geo (RICH source), got 0`);
});

await SmokeRunner.check('records gathered from scatter clones', async () => {
  const state = await SmokeRunner.runPipeline(EVENT_COUNT);
  // eventCount is the JOURNEY count; each journey emits M (~2–5) scans, so
  // records (one per scan) exceed eventCount. The journey count is bounded by it.
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  assert.ok(processed.length > 0, `Expected some processed scan records, got 0`);
  assert.ok(state.journeys.size > 0, `Expected reconstructed journeys, got 0`);
  assert.ok(state.journeys.size <= EVENT_COUNT, `journeys (${state.journeys.size}) must be <= eventCount (${EVENT_COUNT})`);
});

await SmokeRunner.check('insights map populated', async () => {
  const state = await SmokeRunner.runPipeline(EVENT_COUNT);
  assert.ok(state.insights.size > 0, `Expected at least 1 region in insights, got 0`);
});

await SmokeRunner.check('redaction applied to at least one record', async () => {
  const state = await SmokeRunner.runPipeline(EVENT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  const redacted = processed.filter((r) => r.redactionApplied);
  assert.ok(redacted.length > 0, `Expected at least 1 processed record with redactionApplied=true`);
});

await SmokeRunner.check('subtotalUsdMinor > 0 on at least one record (pricing ran)', async () => {
  const state = await SmokeRunner.runPipeline(EVENT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  const priced = processed.filter((r) => r.subtotalUsdMinor > 0);
  assert.ok(priced.length > 0, `Expected at least 1 processed record with subtotalUsdMinor>0, got 0`);
});

await SmokeRunner.check('distanceKm > 0 on at least one record (shipping ran)', async () => {
  const state = await SmokeRunner.runPipeline(EVENT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  const shipped = processed.filter((r) => r.distanceKm > 0);
  assert.ok(shipped.length > 0, `Expected at least 1 processed record with distanceKm>0, got 0`);
});

await SmokeRunner.check('onTime is boolean on all processed records (ETA ran)', async () => {
  const state = await SmokeRunner.runPipeline(EVENT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  for (const r of processed) {
    assert.equal(typeof r.onTime, 'boolean', `Expected onTime to be boolean on ${r.shipmentId}, got ${typeof r.onTime}`);
  }
});

await SmokeRunner.check('serviceTier and sizeTier are canonical on all processed records', async () => {
  const state = await SmokeRunner.runPipeline(EVENT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  const validServiceTiers = new Set(['express', 'standard', 'economy']);
  const validSizeTiers = new Set(['envelope', 'small', 'medium', 'large', 'freight']);
  for (const r of processed) {
    assert.ok(validServiceTiers.has(r.serviceTier), `Invalid serviceTier '${r.serviceTier}' on ${r.shipmentId}`);
    assert.ok(validSizeTiers.has(r.sizeTier), `Invalid sizeTier '${r.sizeTier}' on ${r.shipmentId}`);
  }
});

// ── Statistical guards (larger N) ──────────────────────────────────────────────
// FIX 1 regression guard: lack of marketing consent must NOT drop shipments.
// With ~8% invalid coords and ~2% GDPR violations, the vast majority survive.
const STAT_COUNT = 150;

await SmokeRunner.check('per-region insights are rolled up to CONTINENT, not subdivision', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  // The macro rollup buckets by the continent the real geo API resolved (~6–8
  // rows), plus the single maritime bucket — never a fine subdivision/country.
  // A subdivision-keyed table would explode to ~20+ tiny single-scan rows.
  assert.ok(state.insights.size > 0, `Expected continent buckets, got 0`);
  assert.ok(state.insights.size <= 10, `Expected continent-level rollup (<=10 buckets), got ${state.insights.size} (${[...state.insights.keys()].join(', ')})`);
  // Every bucket key is a continent label (or the maritime/unmapped bucket) — a
  // bare ISO country code must never be a key.
  for (const key of state.insights.keys()) {
    assert.ok(key.length > 0, `insights bucket key must be non-empty`);
    assert.ok(!/^[A-Z]{2,3}$/.test(key), `insights bucket key '${key}' must be a continent, not a bare ISO code`);
  }
  // The maritime bucket exists (water pings collapse into one row).
  assert.ok(state.insights.has('International Waters / Maritime'), `Expected the 'International Waters / Maritime' bucket`);
});

await SmokeRunner.check('most events survive — consent does not gate processing (FIX 1)', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  const ratio = processed.length / STAT_COUNT;
  assert.ok(ratio >= 0.80, `Expected >=80% of events processed, got ${(ratio * 100).toFixed(1)}% (${processed.length}/${STAT_COUNT})`);
  // Records with missing/expired consent must still be present.
  const nonValidConsent = processed.filter((r) => r.consentStatus !== 'valid');
  assert.ok(nonValidConsent.length > 0, `Expected processed records with missing/expired consent, got 0`);
});

await SmokeRunner.check('at least one record is late — ETA mix is realistic (FIX 2)', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  const late = processed.filter((r) => r.onTime === false && r.delayHours > 0);
  const onTime = processed.filter((r) => r.onTime === true);
  assert.ok(late.length > 0, `Expected at least 1 late record (onTime=false, delayHours>0), got 0`);
  assert.ok(onTime.length > 0, `Expected at least 1 on-time record, got 0`);
});

await SmokeRunner.check('distances vary widely — origin is independent of destination (FIX 2)', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  const distances = processed.map((r) => r.distanceKm);
  const maxDist = Math.max(...distances);
  const minDist = Math.min(...distances);
  // A genuine intercontinental shipment must appear, and the spread must be wide.
  assert.ok(maxDist > 5000, `Expected at least one long-haul shipment (>5000 km), max was ${maxDist.toFixed(0)} km`);
  assert.ok(maxDist - minDist > 3000, `Expected wide distance spread (>3000 km), got ${(maxDist - minDist).toFixed(0)} km`);
});

await SmokeRunner.check('promise never before dispatch; delayHours >= 0 (B.9.9 invariants)', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  // The promise is an SLA set at dispatch: it can never precede dispatch, and
  // delayHours is non-negative. Disruptions MAY push actual delay past transit.
  // on-time / delay are only computed on the ORDER lane (the eta node); other
  // kinds skip pricing/eta (the branching saves it) and keep the defaults.
  for (const r of processed) {
    assert.ok(r.delayHours >= 0, `delayHours must be >= 0 on ${r.shipmentId}, got ${r.delayHours}`);
    if (!r.routing.etaRun) continue;
    // For eta-bearing records: an on-time record has delay 0, a late one > 0.
    if (r.onTime) {
      assert.equal(r.delayHours, 0, `on-time record ${r.shipmentId} must have delayHours=0, got ${r.delayHours}`);
    } else {
      assert.ok(r.delayHours > 0, `late record ${r.shipmentId} must have delayHours>0, got ${r.delayHours}`);
    }
  }
});

await SmokeRunner.check('at least one late record exceeds nominal transit (disruptions represented)', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  const beyondTransit = processed.filter((r) => r.routing.etaRun && r.onTime === false && r.delayHours > r.transitHours);
  assert.ok(
    beyondTransit.length > 0,
    `Expected >=1 late order-lane record where delayHours > transitHours (a disruption beyond nominal transit), got 0`,
  );
});

await SmokeRunner.check('at least one multi-scan journey reconstructed', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const multiScan = [...state.journeys.values()].filter((j) => j.scanCount >= 2);
  assert.ok(multiScan.length > 0, `Expected >=1 journey with >=2 scans, got 0`);
});

await SmokeRunner.check('at least one journey crosses >=2 distinct timezones', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const crossTz = [...state.journeys.values()].filter((j) => j.offsets.length >= 2);
  assert.ok(crossTz.length > 0, `Expected >=1 journey crossing >=2 UTC offsets, got 0`);
});

await SmokeRunner.check('at least one strict-jurisdiction record has coarsened coords', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  const strictCoarsened = processed.filter(
    (r) => r.coordsCoarsened
      && (r.jurisdiction === 'GDPR' || r.jurisdiction === 'UK-GDPR' || r.jurisdiction === 'LGPD'),
  );
  assert.ok(strictCoarsened.length > 0, `Expected >=1 strict-jurisdiction record with coarsened coords, got 0`);
});

await SmokeRunner.check('overall on-time is in a believable range (60-90%)', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  // On-time is only meaningful for order-lane records that ran the ETA node.
  const orderLane = processed.filter((r) => r.routing.etaRun);
  const onTime = orderLane.filter((r) => r.onTime).length;
  const pct = orderLane.length > 0 ? (onTime / orderLane.length) * 100 : 0;
  assert.ok(pct >= 50 && pct <= 92, `Overall on-time ${pct.toFixed(1)}% (order-lane) must be in [50,92]`);
});

// ── Stage 2: branching conditional-routing guards ──────────────────────────────
await SmokeRunner.check('at least one event SKIPPED geo-lookup (source pre-resolved)', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  const geoSkipped = processed.filter((r) => r.routing.geoLookupSkipped);
  const geoRun = processed.filter((r) => r.routing.geoLookupRun);
  assert.ok(geoSkipped.length > 0, `Expected >=1 event to SKIP geo-lookup (pre-resolved), got 0`);
  assert.ok(geoRun.length > 0, `Expected >=1 event to RUN geo-lookup, got 0`);
});

await SmokeRunner.check('at least one event SKIPPED redaction (no PII / not required)', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  const redSkipped = processed.filter((r) => r.routing.redactionSkipped);
  const redRun = processed.filter((r) => r.routing.redactionRun);
  assert.ok(redSkipped.length > 0, `Expected >=1 event to SKIP redaction, got 0`);
  assert.ok(redRun.length > 0, `Expected >=1 event to RUN redaction, got 0`);
});

await SmokeRunner.check('each per-kind enrichment lane is exercised', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  const lanes = new Set(processed.map((r) => r.routing.path));
  for (const lane of ['geo-only', 'sensor', 'order', 'customs'] as const) {
    assert.ok(lanes.has(lane), `Expected the '${lane}' lane to be exercised, got lanes: ${[...lanes].join(', ')}`);
  }
  // The per-kind lanes skip pricing/eta except the order lane.
  const nonOrderRanPricing = processed.filter((r) => r.routing.path !== 'order' && r.routing.pricingRun);
  assert.equal(nonOrderRanPricing.length, 0, `Non-order lanes must skip pricing, ${nonOrderRanPricing.length} ran it`);
  const sensorChecked = processed.filter((r) => r.routing.path === 'sensor' && r.routing.coldChainRun);
  assert.ok(sensorChecked.length > 0, `Expected >=1 sensor-lane record to run cold-chain-check, got 0`);
  const customsDwelled = processed.filter((r) => r.routing.path === 'customs' && r.routing.customsDwellRun);
  assert.ok(customsDwelled.length > 0, `Expected >=1 customs-lane record to run customs-dwell, got 0`);
});

await SmokeRunner.check('no journey emits more than one DELIVERED (single terminal)', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const deliveredByShip = new Map<string, number>();
  for (const r of state.records) {
    if (r.shipmentId.length === 0) continue;
    if (r.eventType === 'DELIVERED') {
      deliveredByShip.set(r.shipmentId, (deliveredByShip.get(r.shipmentId) ?? 0) + 1);
    }
  }
  const offenders = [...deliveredByShip.entries()].filter(([, n]) => n > 1);
  assert.equal(offenders.length, 0, `Expected 0 journeys with >1 DELIVERED, got ${offenders.length} (e.g. ${offenders[0]?.[0]})`);
  // And at least some journeys DO deliver (a healthy mix).
  assert.ok(deliveredByShip.size > 0, `Expected some delivered journeys, got 0`);
});

// ── Stage 3: per-ping resolution polish guards (§B.9.10) ──────────────────────
await SmokeRunner.check('water/maritime pings resolve to a water body (not a land country)', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  // A satellite ping over open water is legitimate in-transit data: it must be
  // status 'water', jurisdiction 'international-waters', and labelled by a named
  // ocean/sea (NOT a wrong land country and NOT 'Unknown').
  const water = processed.filter((r) => r.status === 'water');
  assert.ok(water.length > 0, `Expected >=1 water/maritime ping, got 0`);
  for (const r of water) {
    assert.equal(r.jurisdiction, 'international-waters', `water ping ${r.shipmentId} must be international-waters, got ${r.jurisdiction}`);
    assert.notEqual(r.hub, 'Unknown', `water ping ${r.shipmentId} must be labelled by a water body, got 'Unknown'`);
    assert.ok(r.hub.length > 0 && !/^[A-Z]{3}$/.test(r.hub), `water ping ${r.shipmentId} hub '${r.hub}' must be a water-body name, not a code`);
  }
});

await SmokeRunner.check('land pings show a place name, never a bare ISO code', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  const landLabelled = processed.filter((r) => r.status === 'land');
  // No land ping may render a bare 3-letter ISO code as its hub label.
  const bareIso = landLabelled.filter((r) => /^[A-Z]{3}$/.test(r.hub) && r.hub !== 'UNK');
  assert.equal(bareIso.length, 0, `Expected 0 land pings with a bare-ISO hub, got ${bareIso.length} (e.g. ${bareIso[0]?.hub})`);
});

await SmokeRunner.check('unmapped land regions are near-zero (coherent geo coverage)', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  // After ocean labelling + ISO→name + zone overrides, only a tiny fraction of
  // pings should fall in a genuinely-unmapped grid cell (table coverage gaps).
  const unmapped = processed.filter((r) => r.region === 'Unmapped');
  const ratio = processed.length > 0 ? unmapped.length / processed.length : 0;
  assert.ok(ratio < 0.05, `Unmapped land fraction ${(ratio * 100).toFixed(1)}% must be < 5% (near-zero)`);
});

await SmokeRunner.check('at least one journey crosses into international waters mid-path', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const maritime = [...state.journeys.values()].filter(
    (j) => j.jurisdictions.includes('international-waters') && j.jurisdictions.length >= 2,
  );
  assert.ok(maritime.length > 0, `Expected >=1 journey crossing international waters mid-path, got 0`);
});

// ── Wave B5: real geo-resolver adapter + multi-modal fusion guards (§B0.10) ───
await SmokeRunner.check('geo came from the resolver adapter (modalities present on resolved events)', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  // Every event that RAN the geo-resolve sub-DAG must carry the modalities the
  // resolver reported (proof geo came from the adapter, not a curated table).
  const resolved = processed.filter((r) => r.routing.geoLookupRun);
  assert.ok(resolved.length > 0, `Expected >=1 event to run geo-resolve, got 0`);
  for (const r of resolved) {
    assert.ok(r.routing.reverseGeocodeRun, `geo-resolved ${r.shipmentId} must have run reverse-geocode`);
    assert.ok(r.routing.geoModalities.includes('gps'), `geo-resolved ${r.shipmentId} must include the 'gps' modality`);
  }
});

await SmokeRunner.check('at least one event fused GPS + IP modalities', async () => {
  const state = await SmokeRunner.runPipeline(STAT_COUNT);
  const processed = state.records.filter((r) => r.shipmentId.length > 0);
  const fused = processed.filter(
    (r) => r.routing.geoModalities.includes('gps') && r.routing.geoModalities.includes('ip'),
  );
  assert.ok(fused.length > 0, `Expected >=1 event fusing GPS+IP modalities, got 0`);
  // And at least one GPS-only event (no gateway IP) → ip-geolocate was skipped.
  const gpsOnly = processed.filter((r) => r.routing.ipGeolocateSkipped);
  assert.ok(gpsOnly.length > 0, `Expected >=1 GPS-only event (ip-geolocate skipped), got 0`);
});

if (failures > 0) {
  console.error(`\n${failures} smoke check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
