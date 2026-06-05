/**
 * runCartographer: CLI entry point for the Cartographer tracking-feed pipeline.
 *
 * Streams N synthetic tracking scans (many journeys interleaved in time order)
 * through the geo-first pipeline, then prints:
 *   (a) Normalization sample — a multi-scan journey with per-scan LOCAL times
 *       and differing UTC offsets (the movement/timezone showcase)
 *   (b) Per-continent insights table (the macro rollup)
 *   (c) Per-journey summaries (multi-line) — a few journeys with scan path,
 *       timezones crossed, jurisdictions traversed, on-time at delivery
 *   (d) Location-driven redaction comparison — a strict-jurisdiction record
 *       (coarsened coords + irreversible redaction even with consent) vs a
 *       baseline record
 *
 * Run: npx tsx examples/the-cartographer/runCartographer.ts [--events N]
 */

// #region run-cartographer
import { CartographerState } from './CartographerState.ts';
import type { JourneyInsights } from './CartographerState.ts';
import type { CartographerServices } from './CartographerServices.ts';
import { cartographerBundle } from './dag.ts';
import { canonicalizeBundle } from './embedded-dags/CanonicalizeDAG.ts';
import { gdprComplianceBundle } from './embedded-dags/GdprComplianceDAG.ts';
import { geoResolveBundle } from './embedded-dags/GeoResolveDAG.ts';
import { ingestSourceBundle } from './embedded-dags/IngestSourceDAG.ts';
import { ingestJsonBundle } from './embedded-dags/IngestJsonDAG.ts';
import { ingestCsvBundle } from './embedded-dags/IngestCsvDAG.ts';
import { ingestNdjsonGzBundle } from './embedded-dags/IngestNdjsonGzDAG.ts';
import { orderEnrichmentBundle } from './embedded-dags/OrderEnrichmentDAG.ts';
import type { EnrichedShipment } from './entities/EnrichedShipment.ts';
import { GeoResolvers } from './services/GeoResolvers.ts';

import { Dagonizer } from '@noocodex/dagonizer';
import { ExecutionError } from '@noocodex/dagonizer/errors';

// ── Parse CLI args ────────────────────────────────────────────────────────────
let eventCount = 200;
let forceRecorded = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--events' && args[i + 1] !== undefined) {
    const parsed = parseInt(args[i + 1] ?? '200', 10);
    if (!isNaN(parsed) && parsed > 0) eventCount = parsed;
  } else if (args[i] === '--recorded') {
    forceRecorded = true;
  } else if (/^\d+$/.test(args[i] ?? '')) {
    const parsed = parseInt(args[i] ?? '200', 10);
    if (!isNaN(parsed) && parsed > 0) eventCount = parsed;
  }
}

// ── Geo backend selection: LIVE IP if a network is reachable, else RECORDED ────
// GPS reverse-geocode is ALWAYS offline (the `@rapideditor/country-coder` boundary
// dataset — deterministic, no network) — only the IP modality is a live API call.
// `useLive` selects the live freeipapi.com IP geolocator when reachable; otherwise
// (and with `--recorded`) the recorded IP fixture replays for a deterministic,
// offline run. The probe targets freeipapi (the only live modality).
async function networkReachable(): Promise<boolean> {
  try {
    const probe = new AbortController();
    const timer = setTimeout(() => probe.abort(), 4000);
    const res = await fetch('https://freeipapi.com/api/json/8.8.8.8', {
      'signal':  probe.signal,
      'headers': { 'accept': 'application/json' },
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

const useLive = !forceRecorded && (await networkReachable());
const services: CartographerServices = useLive ? GeoResolvers.live() : GeoResolvers.recorded();

// ── Dispatcher ────────────────────────────────────────────────────────────────
const dispatcher = new Dagonizer<CartographerState, CartographerServices>({ 'services': services });
dispatcher.registerBundle(geoResolveBundle);
dispatcher.registerBundle(canonicalizeBundle);
dispatcher.registerBundle(orderEnrichmentBundle);
dispatcher.registerBundle(gdprComplianceBundle);
dispatcher.registerBundle(ingestJsonBundle);
dispatcher.registerBundle(ingestCsvBundle);
dispatcher.registerBundle(ingestNdjsonGzBundle);
dispatcher.registerBundle(ingestSourceBundle);
dispatcher.registerBundle(cartographerBundle);

const state = new CartographerState();
state.eventCount = eventCount;

console.log(`\nCartographer: ${eventCount} journeys → multi-format sources → fan-in → streaming enrichment (concurrency=16)`);
console.log(`Geo backend: offline country-coder reverse-geocode + ${useLive ? 'LIVE freeipapi.com IP geolocation' : 'RECORDED IP fixture replay (offline)'}\n`);

// ── Execute ───────────────────────────────────────────────────────────────────
const ac = new AbortController();
process.once('SIGINT', () => {
  console.log('\n[SIGINT] Aborting pipeline...');
  ac.abort();
});

let dotCount = 0;
try {
  const execution = dispatcher.execute('cartographer', state, { 'signal': ac.signal });
  for await (const stage of execution) {
    if (!stage.skipped) {
      process.stdout.write('.');
      dotCount++;
      if (dotCount % 80 === 0) process.stdout.write('\n');
    }
  }
  await execution;
} catch (err) {
  if (err instanceof ExecutionError) {
    console.error(`\nExecution failed: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
if (dotCount > 0) process.stdout.write('\n');

const processedRecords = state.records.filter((r) => r.shipmentId.length > 0);

// ── (0a) Multi-source ingestion provenance: per-source / per-format counts ─────
console.log('=== (0) Ingestion fan-in — ≥3 formats decoded via SHARED nodes → one model ===\n');
const COL_SRC = 26;
const COL_FMT = 12;
const ihdr = 'Source'.padEnd(COL_SRC) + 'Format'.padEnd(COL_FMT) + 'Events'.padStart(8);
console.log(ihdr);
console.log('-'.repeat(ihdr.length));
const eventsBySource = new Map<string, number>();
for (const ev of state.canonicalEvents) {
  eventsBySource.set(ev.sourceId, (eventsBySource.get(ev.sourceId) ?? 0) + 1);
}
const formatBySource = new Map<string, string>();
for (const s of state.sources) formatBySource.set(s.sourceId, s.format);
const distinctFormats = new Set<string>();
for (const s of state.sources) distinctFormats.add(s.format);
for (const s of state.sources) {
  const count = eventsBySource.get(s.sourceId) ?? 0;
  console.log(
    s.sourceId.slice(0, COL_SRC - 1).padEnd(COL_SRC) +
    s.format.padEnd(COL_FMT) +
    String(count).padStart(8),
  );
}
console.log(`\nDistinct source formats decoded: ${distinctFormats.size} (${[...distinctFormats].sort().join(', ')})`);
console.log(`Total canonical events fanned in: ${state.canonicalEvents.length}`);

// ── (0b) Per-kind counts on the unified canonical model ───────────────────────
console.log('\n=== (0b) Canonical kinds (heterogeneous events, one collection) ===\n');
const byKind = new Map<string, number>();
for (const ev of state.canonicalEvents) byKind.set(ev.kind, (byKind.get(ev.kind) ?? 0) + 1);
for (const kind of [...byKind.keys()].sort()) {
  console.log(`  ${kind.padEnd(24)} ${String(byKind.get(kind) ?? 0).padStart(6)}`);
}
const richGeo = state.canonicalEvents.filter((e) => e.geo !== undefined).length;
console.log(`\nEvents carrying pre-resolved geo (RICH source → Stage 2 can skip geo-lookup): ${richGeo}`);
console.log('');

// ── (a) Normalization sample — a multi-zone, multi-scan journey ───────────────
function fmtCoord(lat: number, lng: number): string {
  const ns = `${Math.abs(lat).toFixed(2)}${lat >= 0 ? 'N' : 'S'}`;
  const ew = `${Math.abs(lng).toFixed(2)}${lng >= 0 ? 'E' : 'W'}`;
  return `${ns} ${ew}`;
}

// Prefer a journey that crosses >=2 timezones to show differing local offsets.
const multiZoneJourney =
  [...state.journeys.values()].find((j) => j.scanCount >= 3 && j.offsets.length >= 2)
  ?? [...state.journeys.values()].find((j) => j.scanCount >= 2 && j.offsets.length >= 2)
  ?? [...state.journeys.values()].find((j) => j.scanCount >= 2);

console.log('=== (a) Normalization Sample — one journey, per-scan LOCAL time ===\n');
if (multiZoneJourney !== undefined) {
  console.log(`${multiZoneJourney.shipmentId}  (${multiZoneJourney.scanCount} scans, ${multiZoneJourney.timezones.length} timezone(s), offsets: ${multiZoneJourney.offsets.join(', ')})`);
  for (const s of multiZoneJourney.scans) {
    const time = s.localIso.slice(11, 16);
    console.log(
      `  seq ${s.scanSeq}  ${time} ${s.utcOffset.padEnd(7)} ${s.eventType.padEnd(16)} ` +
      `${s.hub.slice(0, 18).padEnd(19)} ${fmtCoord(s.lat, s.lng).padEnd(20)} [${s.jurisdiction}]`,
    );
  }
}

// ── (b) Per-continent insights table ─────────────────────────────────────────
// Rolled up to the macro continent the real geo API resolved (~6–8 rows), plus a
// single maritime bucket — the precise locality/country stays on each journey scan.
console.log('\n=== (b) Per-Continent Insights ===\n');

const COL_REGION = 34;
const COL_COUNT  = 7;
const COL_EXC    = 6;
const COL_ONTIME = 8;
const COL_REV    = 12;
const COL_SHIP   = 11;
const COL_DIST   = 10;

const hdr =
  'Continent'.padEnd(COL_REGION) +
  'Scans'.padStart(COL_COUNT) +
  'Exc'.padStart(COL_EXC) +
  'OnTime%'.padStart(COL_ONTIME) +
  'Rev $USD'.padStart(COL_REV) +
  'Ship $USD'.padStart(COL_SHIP) +
  'Dist km'.padStart(COL_DIST);
console.log(hdr);
console.log('-'.repeat(hdr.length));

const sortedRegions = [...state.insights.values()].sort((a, b) => a.region.localeCompare(b.region));
for (const r of sortedRegions) {
  const total = r.onTimeCount + r.lateCount;
  const onTimePct = total > 0 ? Math.round((r.onTimeCount / total) * 100) : 0;
  const revUsd  = (r.totalSubtotalUsdMinor / 100).toFixed(0);
  const shipUsd = (r.totalShippingUsdMinor / 100).toFixed(0);
  const distKm  = r.totalDistanceKm > 0 ? Math.round(r.totalDistanceKm / r.shipmentCount).toString() : '0';
  console.log(
    r.region.slice(0, COL_REGION - 1).padEnd(COL_REGION) +
    String(r.shipmentCount).padStart(COL_COUNT) +
    String(r.exceptions).padStart(COL_EXC) +
    `${onTimePct}%`.padStart(COL_ONTIME) +
    `$${revUsd}`.padStart(COL_REV) +
    `$${shipUsd}`.padStart(COL_SHIP) +
    `${distKm}`.padStart(COL_DIST),
  );
}
console.log(`\nTotal processed scans: ${processedRecords.length} of ${state.records.length} gathered (${state.records.length - processedRecords.length} rejected/skipped)`);
console.log(`Journeys reconstructed: ${state.journeys.size}`);

// ── (b2) ROUTING SAVINGS VIEW (the thesis made tangible — §B0.7c) ─────────────
// Each clone recorded its own RAN/SKIPPED decisions on the enriched record; the
// parent totals them here and compares the actual node-executions against the
// naive "always-run every node for every event" maximum.
//
// Node cost model (the nodes a branch runs/skips per event):
//   geo-lookup chain : validate-coords + geo-grid + geo-context = 3 nodes
//                      (skip path runs apply-geo = 1 node → 2 avoided per skip)
//   order enrichment : enrich-pricing + enrich-shipping + enrich-eta = 3 nodes
//   redaction sub-DAG: consent-gate + classify-pii + redact-pii = 3 nodes
//                      (skip path bypasses all 3 directly → 3 avoided)
const GEO_CHAIN_NODES = 3;        // validate-coords, geo-grid, geo-context
const GEO_SKIP_ADAPTER = 1;       // apply-geo
const ORDER_ENRICH_NODES = 3;     // pricing, shipping, eta
const REDACTION_NODES = 3;        // consent-gate, classify-pii, redact-pii
const REDACTION_SKIP_ADAPTER = 0; // no intermediate node on skip path

let geoRun = 0, geoSkip = 0, redRun = 0, redSkip = 0, priceSkip = 0, etaSkip = 0;
let coldRun = 0, customsRun = 0;
// Geo modality accounting: reverse-geocode is offline (free); the avoidable REAL
// calls are IP geolocations (freeipapi.com).
let revgeoRun = 0, ipgeoRun = 0, ipgeoSkip = 0, fusedGpsIp = 0;
let actualNodes = 0, naiveNodes = 0;
const pathCounts = new Map<string, number>();
for (const r of processedRecords) {
  const rt = r.routing;
  if (rt.geoLookupRun) geoRun++;
  if (rt.geoLookupSkipped) geoSkip++;
  if (rt.reverseGeocodeRun) revgeoRun++;
  if (rt.ipGeolocateRun) ipgeoRun++;
  if (rt.ipGeolocateSkipped) ipgeoSkip++;
  if (rt.geoModalities.includes('gps') && rt.geoModalities.includes('ip')) fusedGpsIp++;
  if (rt.redactionRun) redRun++;
  if (rt.redactionSkipped) redSkip++;
  if (rt.pricingSkipped) priceSkip++;
  if (rt.etaSkipped) etaSkip++;
  if (rt.coldChainRun) coldRun++;
  if (rt.customsDwellRun) customsRun++;
  pathCounts.set(rt.path, (pathCounts.get(rt.path) ?? 0) + 1);

  // Naive maximum: every event runs every branch's nodes.
  naiveNodes += GEO_CHAIN_NODES + ORDER_ENRICH_NODES + REDACTION_NODES;
  // Actual: only what this event's routing ran.
  actualNodes += rt.geoLookupRun ? GEO_CHAIN_NODES : GEO_SKIP_ADAPTER;
  if (rt.pricingRun) actualNodes += ORDER_ENRICH_NODES;
  actualNodes += rt.redactionRun ? REDACTION_NODES : REDACTION_SKIP_ADAPTER;
}
const total = processedRecords.length;
const pct = (n: number, base: number): string => base > 0 ? `${Math.round((n / base) * 100)}%` : '0%';
const skippedNodes = naiveNodes - actualNodes;
const redactionPassesAvoided = redSkip;
const pricingEtaAvoided = priceSkip * ORDER_ENRICH_NODES;

// REAL API calls avoided: reverse-geocode is now OFFLINE/FREE (no call to avoid);
// the avoidable real calls are IP geolocations (freeipapi.com). ip-geolocate runs
// only when a gateway IP is present and the geo sub-DAG isn't skipped. Caching
// collapses repeated IPs, so unique calls are far fewer than the per-event count.
const ipGeolocateAvoided = geoSkip + ipgeoSkip;          // skipped sub-DAG + GPS-only signals

console.log('\n=== (b2) Routing Savings — deterministic routing skips REAL API calls ===\n');
console.log(`  HEADLINE: deterministic routing skipped ${skippedNodes.toLocaleString('en-US')} node-executions ` +
  `(~${pct(skippedNodes, naiveNodes)} of the ${naiveNodes.toLocaleString('en-US')} always-run maximum).\n`);
console.log('  Geo resolution (the real-world win — don\'t hammer the API):');
console.log(`    • reverse-geocode (offline country-coder, no network): RESOLVED ${revgeoRun} events · 0 API calls (deterministic, free, no key)`);
console.log(`    • ip-geolocate (freeipapi.com, REAL API):              RAN for ${ipgeoRun} events · AVOIDED ${ipGeolocateAvoided} (pre-resolved or no gateway IP)`);
console.log(`    • caching collapses repeated IPs → the actual UNIQUE upstream IP calls are far fewer (per-IP cache).`);
console.log(`    • multi-modal fusion: ${fusedGpsIp} events fused GPS+IP (agreement → high confidence); the rest are GPS-only.`);
console.log('');
console.log(`  geo-resolve: RAN ${geoRun}  ·  SKIPPED ${geoSkip} (${pct(geoSkip, total)} — source already resolved → geo sub-DAG + IP call avoided)`);
console.log(`  redaction:   RAN ${redRun}  ·  SKIPPED ${redSkip} (${pct(redSkip, total)} — no PII / not required → redaction sub-DAG bypassed)`);
console.log(`  pricing+eta: RAN ${total - priceSkip}  ·  SKIPPED ${priceSkip} (${pct(priceSkip, total)} — non-order kinds carry no basket/delivery)`);
console.log(`  per-kind lanes: ${[...pathCounts.entries()].sort().map(([p, n]) => `${p}=${n}`).join('  ')}`);
console.log(`  cold-chain-check RAN ${coldRun} (sensor lane only) · customs-dwell RAN ${customsRun} (customs lane only)`);
console.log('\n  Compute avoided (beyond API calls):');
console.log(`    • ${redactionPassesAvoided.toLocaleString('en-US')} redaction passes avoided — skip hashing/coarsening when there is no PII to protect.`);
console.log(`    • ${pricingEtaAvoided.toLocaleString('en-US')} pricing/shipping/ETA node-executions avoided — don't price a position ping.`);

// ── (c) Per-journey summaries (a few) ─────────────────────────────────────────
function printJourney(j: JourneyInsights): void {
  const km = Math.round(j.pathKm).toLocaleString('en-US');
  const elapsedH = Math.floor(j.elapsedHours);
  const elapsedM = Math.round((j.elapsedHours - elapsedH) * 60);
  console.log(`${j.shipmentId}  (${j.scanCount} scans, ${j.timezones.length} timezone(s))`);
  for (const s of j.scans) {
    const time = s.localIso.slice(11, 16);
    const cum = `+${Math.round(s.legKm).toLocaleString('en-US')} km`;
    console.log(
      `  ${time} ${s.utcOffset.padEnd(7)} ${s.eventType.padEnd(16)} ` +
      `${s.hub.slice(0, 18).padEnd(19)} ${fmtCoord(s.lat, s.lng).padEnd(20)} ${cum}`,
    );
  }
  const tzCrossings = Math.max(0, j.offsets.length - 1);
  const jurisLabel = j.jurisdictions.length > 1 ? `${j.jurisdictions.join('→')}` : j.jurisdictions[0] ?? 'baseline';
  const otLabel = j.delivered ? (j.onTime ? 'on-time' : `late ${j.delayHours}h`) : `in transit (${j.lastStatus})`;
  console.log(`  journey: ${km} km · ${elapsedH}h${String(elapsedM).padStart(2, '0')}m elapsed · ${tzCrossings} tz crossing(s) · jurisdiction ${jurisLabel} · ${otLabel}`);
}

console.log('\n=== (c) Per-Journey Summaries ===\n');
const journeysSorted = [...state.journeys.values()].sort((a, b) => b.scanCount - a.scanCount);
// Show a few: one multi-tz, one multi-jurisdiction, one delivered.
const shown = new Set<string>();
const picks: JourneyInsights[] = [];
const multiTz = journeysSorted.find((j) => j.offsets.length >= 2);
if (multiTz !== undefined) { picks.push(multiTz); shown.add(multiTz.shipmentId); }
const multiJuris = journeysSorted.find((j) => j.jurisdictions.length >= 2 && !shown.has(j.shipmentId));
if (multiJuris !== undefined) { picks.push(multiJuris); shown.add(multiJuris.shipmentId); }
const deliveredJourney = journeysSorted.find((j) => j.delivered && !shown.has(j.shipmentId));
if (deliveredJourney !== undefined) { picks.push(deliveredJourney); shown.add(deliveredJourney.shipmentId); }
for (const j of picks) {
  printJourney(j);
  console.log('');
}

const tzCrossingJourneys = [...state.journeys.values()].filter((j) => j.offsets.length >= 2).length;
const jurisChangeJourneys = [...state.journeys.values()].filter((j) => j.jurisdictions.length >= 2).length;
console.log(`Journeys crossing >=2 timezones: ${tzCrossingJourneys}`);
console.log(`Journeys changing jurisdiction mid-path: ${jurisChangeJourneys}`);

// ── (d) Location-driven redaction comparison ──────────────────────────────────
function printRedaction(label: string, rec: EnrichedShipment): void {
  console.log(`  [${label}] ${rec.shipmentId}  jurisdiction=${rec.jurisdiction}  consent=${rec.consentStatus}`);
  console.log(`    Name:    ${rec.redactedSample.recipientName}`);
  console.log(`    Email:   ${rec.redactedSample.recipientEmail}`);
  console.log(`    Phone:   ${rec.redactedSample.recipientPhone}`);
  console.log(`    Coords:  ${fmtCoord(rec.lat, rec.lng)}  ${rec.coordsCoarsened ? '(COARSENED to grid centroid)' : '(precise)'}`);
}

const strictRecord = processedRecords.find(
  (r) => r.coordsCoarsened && (r.jurisdiction === 'GDPR' || r.jurisdiction === 'UK-GDPR' || r.jurisdiction === 'LGPD'),
) ?? processedRecords.find((r) => r.coordsCoarsened);
const baselineRecord = processedRecords.find(
  (r) => !r.coordsCoarsened && r.jurisdiction === 'baseline' && r.consentStatus === 'valid',
) ?? processedRecords.find((r) => !r.coordsCoarsened);

console.log('\n=== (d) Location-Driven Redaction (strict vs baseline) ===\n');
if (strictRecord !== undefined) printRedaction('strict', strictRecord);
if (baselineRecord !== undefined) {
  console.log('');
  printRedaction('baseline', baselineRecord);
}

console.log(`\nDone. ${state.insights.size} continent(s), ${state.journeys.size} journey(s). No Date.now. No Math.random.\n`);
// #endregion run-cartographer
