/**
 * record-geo-fixtures: capture REAL IP-geolocation responses for the SEEDED
 * gateway-IP set into data/geo-fixtures.json so the RecordedIpGeolocator replays
 * them offline.
 *
 * GPS reverse-geocode is OFFLINE (country-coder) — deterministic across
 * environments, no fixture needed. Only the IP modality is a live API call, so
 * this script records that modality only.
 *
 * The generator is seeded → the set of gateway IPs is FIXED across runs. This
 * script:
 *   1. generates the events (default N=200, or --events N),
 *   2. collects the unique gateway IPs,
 *   3. calls freeipapi.com (the LIVE IP transport) for each, paced politely,
 *   4. writes the fixture with `_recorded: true`.
 *
 * Run online: npx tsx examples/the-cartographer/record-geo-fixtures.ts [--events N]
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { GeoCandidate } from './entities/GeoCandidate.ts';
import { ShipmentEvents } from './services.ts';
import { LiveIpGeolocator } from './services/LiveIpGeolocator.ts';

// #region record-geo-fixtures
let eventCount = 200;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--events' && argv[i + 1] !== undefined) {
    const parsed = parseInt(argv[i + 1] ?? '200', 10);
    if (!isNaN(parsed) && parsed > 0) eventCount = parsed;
  }
}

const scans = ShipmentEvents.buildRawScans(eventCount);

// Unique gateway IPs (the only live-API modality left to record).
const ips = new Set<string>();
for (const scan of scans) {
  if (scan.ipAddress.length > 0) ips.add(scan.ipAddress);
}

console.log(`Recording IP-geolocation fixtures for ${ips.size} unique IPs (N=${eventCount})...`);

const ipGeolocator = new LiveIpGeolocator();
const ac = new AbortController();

const ipGeolocate: Record<string, GeoCandidate> = {};

// freeipapi.com free tier rate-limits rapid bursts, so pace the calls
// sequentially with a short delay (only a handful of unique gateway IPs).
const ipList = [...ips];
let ipDone = 0;
for (const ip of ipList) {
  ipGeolocate[ip] = await ipGeolocator.lookup(ip, ac.signal);
  ipDone++;
  const r = ipGeolocate[ip];
  console.log(`  ip-geolocated ${ipDone}/${ipList.length}: ${ip} → ${r.resolved ? `${r.country}/${r.locality}` : 'unresolved'}`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

const fixture = {
  '_recorded': true,
  '_note': `IP-geolocation fixtures only (freeipapi.com) for the seeded N=${eventCount} gateway-IP set. GPS reverse-geocode is offline country-coder — no fixture entries needed for that modality.`,
  'ipGeolocate': ipGeolocate,
};

const outPath = join(dirname(fileURLToPath(import.meta.url)), 'data', 'geo-fixtures.json');
writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
console.log(`\nWrote ${Object.keys(ipGeolocate).length} ip-geolocate fixtures to ${outPath}`);
// #endregion record-geo-fixtures
