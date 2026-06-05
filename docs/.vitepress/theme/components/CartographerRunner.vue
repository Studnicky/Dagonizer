<script setup lang="ts">
/**
 * CartographerRunner: orchestrator for the in-browser Cartographer demo.
 *
 * Two-column iridis-style layout (parity with ArchivistRunner):
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ <single-column on narrow; two-column at ≥720px container width>      │
 *   ├──────────────────────────┬───────────────────────────────────────────┤
 *   │ LEFT COL                 │ RIGHT COL                                 │
 *   │ tabs: Stream | Insights  │ tabs: DAG | Before/After | Trace          │
 *   │ (live feed + % bar)      │                                           │
 *   │ [pinned Run bar]         │                                           │
 *   └──────────────────────────┴───────────────────────────────────────────┘
 *
 * No LLM — purely deterministic data orchestration. Reuses ObservedDagonizer
 * (generic subclass) and DagGraph (animated cytoscape host) from the Archivist.
 * SSR-safe: all browser-only work is guarded to onMounted / click handlers.
 */

import { computed, nextTick, onMounted, ref } from 'vue';

import { CartographerState } from '../../../../examples/the-cartographer/CartographerState.ts';
import type { JourneyInsights, RegionInsights } from '../../../../examples/the-cartographer/CartographerState.ts';
import type { CartographerServices } from '../../../../examples/the-cartographer/CartographerServices.ts';
import { cartographerDAG, cartographerBundle, eventPipelineDAG } from '../../../../examples/the-cartographer/dag.ts';
import { canonicalizeDAG, canonicalizeBundle } from '../../../../examples/the-cartographer/embedded-dags/CanonicalizeDAG.ts';
import { ingestSourceDAG, ingestSourceBundle } from '../../../../examples/the-cartographer/embedded-dags/IngestSourceDAG.ts';
import { ingestJsonDAG, ingestJsonBundle } from '../../../../examples/the-cartographer/embedded-dags/IngestJsonDAG.ts';
import { ingestCsvDAG, ingestCsvBundle } from '../../../../examples/the-cartographer/embedded-dags/IngestCsvDAG.ts';
import { ingestNdjsonGzDAG, ingestNdjsonGzBundle } from '../../../../examples/the-cartographer/embedded-dags/IngestNdjsonGzDAG.ts';
import { geoResolveDAG, geoResolveBundle } from '../../../../examples/the-cartographer/embedded-dags/GeoResolveDAG.ts';
import { gdprComplianceDAG, gdprComplianceBundle } from '../../../../examples/the-cartographer/embedded-dags/GdprComplianceDAG.ts';
import { orderEnrichmentDAG, orderEnrichmentBundle } from '../../../../examples/the-cartographer/embedded-dags/OrderEnrichmentDAG.ts';
import { GeoResolvers } from '../../../../examples/the-cartographer/services/GeoResolvers.ts';
import type { EnrichedShipment } from '../../../../examples/the-cartographer/entities/EnrichedShipment.ts';

import { ObservedDagonizer } from './ObservedDagonizer.ts';
import DagGraph from './DagGraph.vue';
import PanesTabs from './PanesTabs.vue';

// ── Types ────────────────────────────────────────────────────────────────────
type TraceEvent =
  | { readonly kind: 'start'; readonly node: string; readonly ts: number }
  | { readonly kind: 'end';   readonly node: string; readonly ts: number; readonly output: string | undefined }
  | { readonly kind: 'error'; readonly node: string; readonly ts: number; readonly message: string };

/** One line in the live stream feed (one gathered record per line). */
interface StreamLine {
  readonly shipmentId: string;
  readonly scanSeq: number;
  readonly eventType: string;
  readonly continent: string;
  readonly redacted: boolean;
}

// ── State ────────────────────────────────────────────────────────────────────
const isRunning = ref(false);
const isDone = ref(false);
const errorMessage = ref<string | null>(null);
const trace = ref<TraceEvent[]>([]);

/** Live streaming feed: one entry per gathered EnrichedShipment record. */
const streamFeed = ref<StreamLine[]>([]);

/** 0–100 progress percentage, driven by records/total. */
const progressPct = ref(0);

/** Total canonical events (set once merge-events fires). */
let totalEvents = 0;

/** Ref for auto-scroll of the stream feed container. */
const feedContainerRef = ref<HTMLElement | null>(null);

// Finished state snapshot (set after execution completes).
const records = ref<EnrichedShipment[]>([]);
const insightsMap = ref<Map<string, RegionInsights>>(new Map());
const journeysMap = ref<Map<string, JourneyInsights>>(new Map());

const dagGraph = ref<InstanceType<typeof DagGraph> | null>(null);

// The DAG embedded-DAG registry: maps each sub-DAG key (used in the event-pipeline's
// embeddedDAG calls) to its DAG object so DagGraph can expand them.
const embeddedDagRegistry = new Map([
  ['ingest-source',    ingestSourceDAG],
  ['ingest-json',      ingestJsonDAG],
  ['ingest-csv',       ingestCsvDAG],
  ['ingest-ndjson-gz', ingestNdjsonGzDAG],
  ['event-pipeline',   eventPipelineDAG],
  ['geo-resolve',      geoResolveDAG],
  ['canonicalize',     canonicalizeDAG],
  ['order-enrichment', orderEnrichmentDAG],
  ['gdpr-compliance',  gdprComplianceDAG],
]);

// ── Abort control ────────────────────────────────────────────────────────────
let activeAbortController: AbortController | null = null;

function cancel(): void {
  if (!isRunning.value) return;
  activeAbortController?.abort(new Error('cancelled by visitor'));
}

// ── Computed display values ──────────────────────────────────────────────────

/** Routing savings tallied from all gathered records. */
const savings = computed(() => {
  const rs = records.value;
  const n = rs.length;
  if (n === 0) {
    return { n: 0, geoRan: 0, geoSkipped: 0, ipRan: 0, ipSkipped: 0, redactionRan: 0, redactionSkipped: 0 };
  }
  let geoRan = 0; let geoSkipped = 0; let ipRan = 0; let ipSkipped = 0;
  let redactionRan = 0; let redactionSkipped = 0;
  for (const r of rs) {
    if (r.routing.geoLookupRun)      geoRan++;
    if (r.routing.geoLookupSkipped)  geoSkipped++;
    if (r.routing.ipGeolocateRun)    ipRan++;
    if (r.routing.ipGeolocateSkipped) ipSkipped++;
    if (r.routing.redactionRun)      redactionRan++;
    if (r.routing.redactionSkipped)  redactionSkipped++;
  }
  return { n, geoRan, geoSkipped, ipRan, ipSkipped, redactionRan, redactionSkipped };
});

/**
 * Primary before/after record: one that ran BOTH geo-resolve AND redaction so all
 * transformation stages have data to show.
 */
const primarySample = computed<EnrichedShipment | null>(() => {
  return (
    records.value.find(
      (r) => r.routing.geoLookupRun && r.redactionApplied && r.continent !== 'Unmapped',
    ) ??
    records.value.find((r) => r.routing.geoLookupRun && r.continent !== 'Unmapped') ??
    records.value.find((r) => r.redactionApplied) ??
    records.value[0] ??
    null
  );
});

/**
 * Secondary "skipped" record: one that SKIPPED geo or redaction, to make branching tangible.
 */
const skippedSample = computed<EnrichedShipment | null>(() => {
  return (
    records.value.find(
      (r) =>
        r !== primarySample.value &&
        (r.routing.geoLookupSkipped || r.routing.redactionSkipped),
    ) ?? null
  );
});

/** Continent insights as a sorted array for display. */
const continentRows = computed<RegionInsights[]>(() => {
  const rows = [...insightsMap.value.values()];
  rows.sort((a, b) => b.shipmentCount - a.shipmentCount);
  return rows;
});

/** A few sample journeys for display (first 3 with ≥2 scans). */
const sampleJourneys = computed<JourneyInsights[]>(() => {
  const jlist = [...journeysMap.value.values()].filter((j) => j.scanCount >= 2);
  jlist.sort((a, b) => b.scanCount - a.scanCount);
  return jlist.slice(0, 3);
});

/** Flow-state hint displayed in the left column header. */
const flowHint = computed<string>(() => {
  if (isRunning.value) {
    return progressPct.value > 0
      ? `streaming ${String(progressPct.value)}%`
      : 'streaming…';
  }
  if (isDone.value) return `${String(records.value.length)} events processed`;
  return 'ready';
});

// ── Tabs ─────────────────────────────────────────────────────────────────────
const leftTabs = computed(() => [
  {
    'key': 'stream',
    'label': 'Stream',
    'badge': isRunning.value ? 'live' : (streamFeed.value.length > 0 ? String(streamFeed.value.length) : ''),
    'tone': (isRunning.value ? 'live' : 'default') as 'live' | 'default',
  },
  {
    'key': 'insights',
    'label': 'Insights',
    'badge': isDone.value && continentRows.value.length > 0 ? String(continentRows.value.length) : '',
    'tone': 'accent' as const,
  },
]);

const rightTabs = computed(() => [
  {
    'key': 'dag',
    'label': 'DAG',
    'badge': isRunning.value ? 'live' : '',
    'tone': (isRunning.value ? 'live' : 'default') as 'live' | 'default',
  },
  {
    'key': 'before-after',
    'label': 'Before / After',
    'badge': isDone.value ? String(records.value.length) : '',
    'tone': 'accent' as const,
  },
  {
    'key': 'trace',
    'label': 'Trace',
    'badge': String(trace.value.length > 0 ? trace.value.length : ''),
    'tone': (isRunning.value ? 'live' : 'default') as 'live' | 'default',
  },
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function usdFromMinor(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

function pct(part: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

/** Scroll the stream feed to the bottom so newest entries are visible. */
function scrollFeedToBottom(): void {
  if (feedContainerRef.value !== null) {
    feedContainerRef.value.scrollTop = feedContainerRef.value.scrollHeight;
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────
async function run(): Promise<void> {
  if (isRunning.value) return;

  isRunning.value = true;
  isDone.value = false;
  errorMessage.value = null;
  trace.value = [];
  records.value = [];
  insightsMap.value = new Map();
  journeysMap.value = new Map();
  streamFeed.value = [];
  progressPct.value = 0;
  totalEvents = 0;

  await dagGraph.value?.reset();

  const services: CartographerServices = GeoResolvers.live();

  /** Count of records seen on the previous onNodeEnd call — detect growth. */
  let prevRecordCount = 0;

  const observer = {
    onNodeStart(nodeName: string, _state: CartographerState, placementPath: readonly string[] = []) {
      const fullId = [...placementPath, nodeName].join('/');
      trace.value = [...trace.value, { 'kind': 'start', 'node': fullId, 'ts': Date.now() }];
      dagGraph.value?.setActive(fullId);
    },
    onNodeEnd(nodeName: string, output: string | undefined, state: CartographerState, placementPath: readonly string[] = []) {
      const fullId = [...placementPath, nodeName].join('/');
      trace.value = [...trace.value, { 'kind': 'end', 'node': fullId, output, 'ts': Date.now() }];
      dagGraph.value?.setCompleted(fullId);
      if (output !== undefined) dagGraph.value?.markEdgeTraversed(fullId, output);

      // Capture total once the ingest fan-in merge-events node fires.
      // At that point canonicalEvents is fully populated.
      if (nodeName === 'merge-events' && state.canonicalEvents.length > 0) {
        totalEvents = state.canonicalEvents.length;
      }

      // Detect new gathered records (scatter appends to state.records).
      const currentCount = state.records.length;
      if (currentCount > prevRecordCount) {
        const newRecords = state.records.slice(prevRecordCount, currentCount);
        for (const rec of newRecords) {
          streamFeed.value = [...streamFeed.value, {
            'shipmentId':  rec.shipmentId,
            'scanSeq':     rec.scanSeq,
            'eventType':   rec.eventType,
            'continent':   rec.continent,
            'redacted':    rec.redactionApplied,
          }];
        }
        prevRecordCount = currentCount;

        // Update progress percentage.
        if (totalEvents > 0) {
          progressPct.value = Math.min(100, Math.round((currentCount / totalEvents) * 100));
        }

        // Auto-scroll feed on next tick (after DOM update).
        void nextTick(scrollFeedToBottom);
      }
    },
    onError(nodeName: string, error: Error, _state: CartographerState, placementPath: readonly string[] = []) {
      const fullId = [...placementPath, nodeName].join('/');
      trace.value = [...trace.value, { 'kind': 'error', 'node': fullId, 'ts': Date.now(), 'message': error.message !== '' ? error.message : String(error) }];
      dagGraph.value?.setErrored(fullId);
    },
    onFlowEnd(_dagName: string, state: CartographerState) {
      records.value = [...state.records];
      insightsMap.value = new Map(state.insights);
      journeysMap.value = new Map(state.journeys);
      progressPct.value = 100;
    },
  };

  const dispatcher = new ObservedDagonizer<CartographerState, CartographerServices>({
    services,
    'observer': observer,
  });

  // Bundle registration order: sub-DAGs first so their names resolve.
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
  state.eventCount = 16; // browser-friendly: small N so the demo completes quickly

  activeAbortController = new AbortController();

  try {
    const execution = dispatcher.execute('cartographer', state, { 'signal': activeAbortController.signal });
    for await (const stage of execution) {
      // Each yielded stage lights up a node via the observer hooks above.
      // Consume silently; the observer drives the UI.
      void stage;
    }
    await execution;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    await dispatcher.destroy();
    activeAbortController = null;
    isRunning.value = false;
    isDone.value = true;
  }
}

function reset(): void {
  if (isRunning.value) return;
  records.value = [];
  insightsMap.value = new Map();
  journeysMap.value = new Map();
  trace.value = [];
  streamFeed.value = [];
  progressPct.value = 0;
  totalEvents = 0;
  isDone.value = false;
  errorMessage.value = null;
  void dagGraph.value?.reset();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
// SSR guard: browser-only initialisation goes here.
onMounted(() => {
  // No auto-run: the visitor clicks Run to start.
});
</script>

<template>
  <div :class="['cartographer-runner', { 'is-running': isRunning }]">

    <!-- Error banner -->
    <div v-if="errorMessage" class="cr-error-banner" role="alert">
      <strong>Run failed:</strong> {{ errorMessage }}
    </div>

    <!-- Main layout -->
    <div class="cr-grid">

      <!-- LEFT: Stream | Insights + pinned Run bar -->
      <div class="cr-col cr-col--left">
        <div class="cr-col-head">
          <span class="cr-label">Cartographer</span>
          <span class="cr-hint">{{ flowHint }}</span>
        </div>

        <!-- Tab host: Stream and Insights -->
        <PanesTabs :tabs="leftTabs" default-key="stream" class="cr-tabs cr-tabs--left">

          <!-- Stream tab: live record feed + progress bar -->
          <template #stream>
            <div class="cr-stream-pane">
              <!-- Progress bar -->
              <div class="cr-progress-wrap" :aria-label="`Pipeline progress: ${progressPct}%`">
                <div
                  class="cr-progress-bar"
                  :class="{ 'cr-progress-bar--done': isDone && progressPct >= 100, 'cr-progress-bar--running': isRunning }"
                  :style="{ width: `${progressPct}%` }"
                ></div>
              </div>

              <!-- Live feed -->
              <div
                v-if="streamFeed.length === 0"
                class="cr-stream-empty"
              >
                <template v-if="isRunning">ingesting sources…</template>
                <template v-else>Run the pipeline to see live event stream.</template>
              </div>
              <div ref="feedContainerRef" v-else class="cr-stream-feed">
                <div
                  v-for="(line, idx) in streamFeed"
                  :key="idx"
                  class="cr-stream-row"
                >
                  <span class="cr-stream-id mono">{{ line.shipmentId }}</span>
                  <span class="cr-stream-sep">·</span>
                  <span class="cr-stream-scan mono">scan {{ line.scanSeq }}</span>
                  <span class="cr-stream-sep">·</span>
                  <span class="cr-stream-type">{{ line.eventType }}</span>
                  <span class="cr-stream-sep">·</span>
                  <span class="cr-stream-continent">{{ line.continent }}</span>
                  <template v-if="line.redacted">
                    <span class="cr-stream-sep">·</span>
                    <span class="cr-stream-redacted">redacted</span>
                  </template>
                </div>
              </div>
            </div>
          </template>

          <!-- Insights tab: routing savings + continent + journey cards -->
          <template #insights>
            <div class="cr-left-pane">
              <p class="cr-intro">
                A deterministic multi-source ETL pipeline: CSV facility scans, JSON position
                pings, and gzip NDJSON sensor readings fan into one canonical model, then every
                event routes through only the nodes it needs — geo-resolution skipped when the
                source pre-resolved location, GDPR redaction skipped when PII is absent or not
                required. The branching is visible live in the DAG pane.
              </p>

              <template v-if="isDone && savings.n > 0">
                <h5 class="cr-section-head">Routing savings</h5>
                <table class="cr-table cr-table--compact">
                  <thead>
                    <tr><th>Branch</th><th>RAN</th><th>SKIPPED</th><th>Skip %</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Geo lookup (sub-DAG)</td>
                      <td>{{ savings.geoRan }}</td>
                      <td>{{ savings.geoSkipped }}</td>
                      <td>{{ pct(savings.geoSkipped, savings.n) }}</td>
                    </tr>
                    <tr>
                      <td>IP geolocation (freeipapi)</td>
                      <td>{{ savings.ipRan }}</td>
                      <td>{{ savings.ipSkipped }}</td>
                      <td>{{ pct(savings.ipSkipped, savings.n) }}</td>
                    </tr>
                    <tr>
                      <td>GDPR redaction sub-DAG</td>
                      <td>{{ savings.redactionRan }}</td>
                      <td>{{ savings.redactionSkipped }}</td>
                      <td>{{ pct(savings.redactionSkipped, savings.n) }}</td>
                    </tr>
                  </tbody>
                </table>
              </template>

              <template v-if="isDone && continentRows.length > 0">
                <h5 class="cr-section-head">Continent insights</h5>
                <table class="cr-table">
                  <thead>
                    <tr>
                      <th>Continent</th>
                      <th>Scans</th>
                      <th>On-time %</th>
                      <th>Revenue (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in continentRows" :key="row.region">
                      <td>{{ row.region || row.continent }}</td>
                      <td>{{ row.shipmentCount }}</td>
                      <td>{{ row.shipmentCount > 0 ? pct(row.onTimeCount, row.shipmentCount) : '—' }}</td>
                      <td>{{ usdFromMinor(row.totalSubtotalUsdMinor) }}</td>
                    </tr>
                  </tbody>
                </table>
              </template>

              <template v-if="isDone && sampleJourneys.length > 0">
                <h5 class="cr-section-head">Sample journeys</h5>
                <div v-for="j in sampleJourneys" :key="j.shipmentId" class="cr-journey-card">
                  <div class="cr-journey-head">
                    <span class="cr-journey-id">{{ j.shipmentId }}</span>
                    <span :class="['cr-journey-badge', j.delivered ? (j.onTime ? 'badge--ok' : 'badge--late') : 'badge--exception']">
                      {{ j.delivered ? (j.onTime ? 'on-time' : `${j.delayHours}h late`) : 'exception' }}
                    </span>
                  </div>
                  <div class="cr-journey-meta">
                    {{ j.scanCount }} scans · {{ j.pathKm.toFixed(0) }} km ·
                    {{ j.timezones.length }} tz · {{ j.jurisdictions.join(', ') }}
                  </div>
                </div>
              </template>

              <template v-if="!isDone">
                <p class="cr-placeholder">Run the pipeline to see continent insights and journey data.</p>
              </template>
            </div>
          </template>

        </PanesTabs>

        <!-- Pinned Run bar: mirrors SendForm pattern, always at the bottom of the left col -->
        <footer class="cr-run-bar">
          <div class="cr-run-row">
            <div class="cr-run-status-text">
              <template v-if="isRunning">
                <span class="cr-run-status cr-run-status--live">streaming {{ progressPct > 0 ? `${progressPct}%` : '…' }}</span>
              </template>
              <template v-else-if="isDone">
                <span class="cr-run-status cr-run-status--done">{{ records.length }} events</span>
              </template>
            </div>
            <div class="cr-run-actions">
              <button
                v-if="isDone && !isRunning"
                type="button"
                class="cr-btn cr-btn--reset"
                @click="reset"
              >reset</button>
              <button
                v-if="isRunning"
                type="button"
                class="cr-btn cr-btn--cancel"
                @click="cancel"
              >
                <span class="cr-btn-spinner" aria-hidden="true"></span>
                <span class="cr-btn-glyph">✕</span>
              </button>
              <button
                v-else
                type="button"
                :class="['cr-btn', 'cr-btn--run']"
                @click="run"
              >Run</button>
            </div>
          </div>
        </footer>

      </div>

      <!-- RIGHT: DAG | Before/After | Trace -->
      <div class="cr-col cr-col--right">
        <div class="cr-col-head">
          <span class="cr-label">Graph</span>
          <span class="cr-hint">{{ trace.length }} events</span>
        </div>
        <PanesTabs :tabs="rightTabs" default-key="dag" class="cr-tabs cr-tabs--right">

          <!-- DAG tab: live execution graph -->
          <template #dag>
            <div class="graph-pane">
              <DagGraph
                ref="dagGraph"
                :dag="cartographerDAG"
                :embedded-d-a-gs="embeddedDagRegistry"
                :expand-all="true"
                aria-label="Cartographer DAG live execution"
              />
            </div>
          </template>

          <!-- Before / After tab: 6-stage transformation walkthrough + routing tables -->
          <template #before-after>
            <div class="cr-panels-pane">

              <template v-if="!isDone">
                <p class="cr-placeholder">Run the pipeline to see the before / after transformations.</p>
              </template>

              <template v-else-if="primarySample">
                <!-- ── Record header ────────────────────────────────────── -->
                <div class="cr-ba-header">
                  <span class="cr-ba-header-id">{{ primarySample.shipmentId }}</span>
                  <span class="cr-ba-header-meta">scan #{{ primarySample.scanSeq }} · {{ primarySample.eventType }} · {{ primarySample.serviceTier }} / {{ primarySample.sizeTier }}</span>
                </div>

                <!-- ── Stage 1: Normalize ─────────────────────────────── -->
                <h5 class="cr-section-head">1 — normalize</h5>
                <div class="cr-stage-grid">
                  <div class="cr-sg-row">
                    <span class="cr-sg-label">Timestamp</span>
                    <span class="cr-sg-before mono">raw string</span>
                    <span class="cr-sg-arrow">→</span>
                    <span class="cr-sg-after mono">{{ primarySample.epochMs }}ms · {{ primarySample.localIso || '—' }} ({{ primarySample.utcOffset || 'UTC' }})</span>
                  </div>
                  <div class="cr-sg-row">
                    <span class="cr-sg-label">Carrier</span>
                    <span class="cr-sg-before mono">alias string</span>
                    <span class="cr-sg-arrow">→</span>
                    <span class="cr-sg-after mono">canonical ID + name</span>
                  </div>
                  <div class="cr-sg-row">
                    <span class="cr-sg-label">Country</span>
                    <span class="cr-sg-before mono">free-text</span>
                    <span class="cr-sg-arrow">→</span>
                    <span class="cr-sg-after mono">ISO-3: {{ primarySample.country }}</span>
                  </div>
                  <div class="cr-sg-row">
                    <span class="cr-sg-label">Weight</span>
                    <span class="cr-sg-before mono">lb / kg / oz</span>
                    <span class="cr-sg-arrow">→</span>
                    <span class="cr-sg-after mono">grams (normalised)</span>
                  </div>
                </div>

                <!-- ── Stage 2: Geo-resolve ───────────────────────────── -->
                <h5 class="cr-section-head">2 — geo-resolve</h5>
                <template v-if="primarySample.routing.geoLookupRun">
                  <div class="cr-stage-grid">
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Coordinates</span>
                      <span class="cr-sg-before mono">{{ primarySample.lat.toFixed(4) }}, {{ primarySample.lng.toFixed(4) }}</span>
                      <span class="cr-sg-arrow">→</span>
                      <span class="cr-sg-after mono">{{ primarySample.continent }} / {{ primarySample.country }} / {{ primarySample.region || '—' }}</span>
                    </div>
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Hub</span>
                      <span class="cr-sg-before mono">—</span>
                      <span class="cr-sg-arrow">→</span>
                      <span class="cr-sg-after mono">{{ primarySample.hub || '—' }}</span>
                    </div>
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Jurisdiction</span>
                      <span class="cr-sg-before mono">unknown</span>
                      <span class="cr-sg-arrow">→</span>
                      <span class="cr-sg-after mono">{{ primarySample.jurisdiction }}</span>
                    </div>
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Modalities</span>
                      <span class="cr-sg-before mono">—</span>
                      <span class="cr-sg-arrow">→</span>
                      <span class="cr-sg-after mono">{{ primarySample.routing.geoModalities.join(' + ') || 'offline-gps' }}</span>
                    </div>
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Confidence</span>
                      <span class="cr-sg-before mono">—</span>
                      <span class="cr-sg-arrow">→</span>
                      <span class="cr-sg-after mono">{{ (primarySample.routing.geoConfidence * 100).toFixed(0) }}%</span>
                    </div>
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Reverse-geocode</span>
                      <span class="cr-sg-before mono">—</span>
                      <span class="cr-sg-arrow">→</span>
                      <span :class="['cr-sg-after', primarySample.routing.reverseGeocodeRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                        {{ primarySample.routing.reverseGeocodeRun ? 'ran' : 'skipped' }}
                      </span>
                    </div>
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">IP-geolocate</span>
                      <span class="cr-sg-before mono">—</span>
                      <span class="cr-sg-arrow">→</span>
                      <span :class="['cr-sg-after', primarySample.routing.ipGeolocateRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                        {{ primarySample.routing.ipGeolocateRun ? 'ran' : 'skipped' }}
                      </span>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <p class="cr-placeholder cr-placeholder--inline">Geo-resolve skipped — source pre-resolved location.</p>
                </template>

                <!-- ── Stage 3: Classify ──────────────────────────────── -->
                <h5 class="cr-section-head">3 — classify</h5>
                <div class="cr-stage-grid">
                  <div class="cr-sg-row">
                    <span class="cr-sg-label">Status → eventType</span>
                    <span class="cr-sg-before mono">raw status</span>
                    <span class="cr-sg-arrow">→</span>
                    <span class="cr-sg-after mono">{{ primarySample.eventType }}</span>
                  </div>
                  <div class="cr-sg-row">
                    <span class="cr-sg-label">Service tier</span>
                    <span class="cr-sg-before mono">weight + dist</span>
                    <span class="cr-sg-arrow">→</span>
                    <span class="cr-sg-after mono">{{ primarySample.serviceTier }}</span>
                  </div>
                  <div class="cr-sg-row">
                    <span class="cr-sg-label">Size tier</span>
                    <span class="cr-sg-before mono">weight grams</span>
                    <span class="cr-sg-arrow">→</span>
                    <span class="cr-sg-after mono">{{ primarySample.sizeTier }}</span>
                  </div>
                </div>

                <!-- ── Stage 4: Pricing ───────────────────────────────── -->
                <h5 class="cr-section-head">4 — pricing</h5>
                <template v-if="primarySample.routing.pricingRun">
                  <div class="cr-stage-grid">
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Basket → subtotal</span>
                      <span class="cr-sg-before mono">line items</span>
                      <span class="cr-sg-arrow">→</span>
                      <span class="cr-sg-after mono">{{ usdFromMinor(primarySample.subtotalUsdMinor) }} USD</span>
                    </div>
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Currency</span>
                      <span class="cr-sg-before mono">local</span>
                      <span class="cr-sg-arrow">→</span>
                      <span class="cr-sg-after mono">USD (FX-normalised)</span>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <p class="cr-placeholder cr-placeholder--inline">Pricing skipped for this event kind.</p>
                </template>

                <!-- ── Stage 5: Shipping + ETA ───────────────────────── -->
                <h5 class="cr-section-head">5 — shipping + eta</h5>
                <template v-if="primarySample.routing.etaRun">
                  <div class="cr-stage-grid">
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Distance</span>
                      <span class="cr-sg-before mono">leg coords</span>
                      <span class="cr-sg-arrow">→</span>
                      <span class="cr-sg-after mono">{{ primarySample.distanceKm.toFixed(1) }} km</span>
                    </div>
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Shipping cost</span>
                      <span class="cr-sg-before mono">distance × tier rate</span>
                      <span class="cr-sg-arrow">→</span>
                      <span class="cr-sg-after mono">{{ usdFromMinor(primarySample.shippingUsdMinor) }} USD</span>
                    </div>
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Transit</span>
                      <span class="cr-sg-before mono">haversine</span>
                      <span class="cr-sg-arrow">→</span>
                      <span class="cr-sg-after mono">{{ primarySample.transitHours.toFixed(1) }}h</span>
                    </div>
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">On-time / delay</span>
                      <span class="cr-sg-before mono">promised ETA</span>
                      <span class="cr-sg-arrow">→</span>
                      <span :class="['cr-sg-after', primarySample.onTime ? 'cr-tag--ran' : 'cr-tag--skipped']">
                        {{ primarySample.onTime ? 'on-time' : `${primarySample.delayHours.toFixed(1)}h late` }}
                      </span>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <p class="cr-placeholder cr-placeholder--inline">ETA skipped for this event kind.</p>
                </template>

                <!-- ── Stage 6: GDPR redaction ───────────────────────── -->
                <h5 class="cr-section-head">6 — gdpr redaction</h5>
                <template v-if="primarySample.redactionApplied">
                  <div class="cr-stage-grid">
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Name</span>
                      <span class="cr-sg-before mono">raw PII</span>
                      <span class="cr-sg-arrow">→</span>
                      <span class="cr-sg-after mono">{{ primarySample.redactedSample.recipientName || '[redacted]' }}</span>
                    </div>
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Email</span>
                      <span class="cr-sg-before mono">raw PII</span>
                      <span class="cr-sg-arrow">→</span>
                      <span class="cr-sg-after mono">{{ primarySample.redactedSample.recipientEmail || '[redacted]' }}</span>
                    </div>
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Phone</span>
                      <span class="cr-sg-before mono">raw PII</span>
                      <span class="cr-sg-arrow">→</span>
                      <span class="cr-sg-after mono">{{ primarySample.redactedSample.recipientPhone || '[redacted]' }}</span>
                    </div>
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Jurisdiction</span>
                      <span class="cr-sg-before mono">derived</span>
                      <span class="cr-sg-arrow">→</span>
                      <span class="cr-sg-after mono">{{ primarySample.jurisdiction }}</span>
                    </div>
                    <div class="cr-sg-row">
                      <span class="cr-sg-label">Coords coarsened</span>
                      <span class="cr-sg-before mono">exact lat/lng</span>
                      <span class="cr-sg-arrow">→</span>
                      <span :class="['cr-sg-after', primarySample.coordsCoarsened ? 'cr-tag--ran' : 'cr-tag--skipped']">
                        {{ primarySample.coordsCoarsened ? 'yes — grid centroid' : 'no — kept exact' }}
                      </span>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <p class="cr-placeholder cr-placeholder--inline">Redaction skipped — consent valid or PII absent.</p>
                </template>

                <!-- ── Pipeline routing for this record ─────────────── -->
                <h5 class="cr-section-head">pipeline routing — this record</h5>
                <div class="cr-routing-grid">
                  <div class="cr-routing-row">
                    <span class="cr-routing-label">Lane</span>
                    <span class="cr-routing-val mono">{{ primarySample.routing.path }}</span>
                  </div>
                  <div class="cr-routing-row">
                    <span class="cr-routing-label">Geo-resolve</span>
                    <span :class="['cr-routing-val', primarySample.routing.geoLookupRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                      {{ primarySample.routing.geoLookupRun ? 'ran' : 'skipped' }}
                    </span>
                  </div>
                  <div class="cr-routing-row">
                    <span class="cr-routing-label">IP-geolocate</span>
                    <span :class="['cr-routing-val', primarySample.routing.ipGeolocateRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                      {{ primarySample.routing.ipGeolocateRun ? 'ran' : 'skipped' }}
                    </span>
                  </div>
                  <div class="cr-routing-row">
                    <span class="cr-routing-label">Redaction</span>
                    <span :class="['cr-routing-val', primarySample.routing.redactionRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                      {{ primarySample.routing.redactionRun ? 'ran' : 'skipped' }}
                    </span>
                  </div>
                  <div class="cr-routing-row">
                    <span class="cr-routing-label">Pricing</span>
                    <span :class="['cr-routing-val', primarySample.routing.pricingRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                      {{ primarySample.routing.pricingRun ? 'ran' : 'skipped' }}
                    </span>
                  </div>
                  <div class="cr-routing-row">
                    <span class="cr-routing-label">ETA</span>
                    <span :class="['cr-routing-val', primarySample.routing.etaRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                      {{ primarySample.routing.etaRun ? 'ran' : 'skipped' }}
                    </span>
                  </div>
                  <div class="cr-routing-row">
                    <span class="cr-routing-label">Cold chain</span>
                    <span :class="['cr-routing-val', primarySample.routing.coldChainRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                      {{ primarySample.routing.coldChainRun ? 'ran' : 'skipped' }}
                    </span>
                  </div>
                  <div class="cr-routing-row">
                    <span class="cr-routing-label">Customs dwell</span>
                    <span :class="['cr-routing-val', primarySample.routing.customsDwellRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                      {{ primarySample.routing.customsDwellRun ? 'ran' : 'skipped' }}
                    </span>
                  </div>
                </div>

                <!-- ── Second example: skipped branches ─────────────── -->
                <template v-if="skippedSample">
                  <div class="cr-ba-header cr-ba-header--secondary">
                    <span class="cr-ba-header-id">{{ skippedSample.shipmentId }}</span>
                    <span class="cr-ba-header-meta">scan #{{ skippedSample.scanSeq }} — branching contrast</span>
                  </div>
                  <div class="cr-routing-grid">
                    <div class="cr-routing-row">
                      <span class="cr-routing-label">Lane</span>
                      <span class="cr-routing-val mono">{{ skippedSample.routing.path }}</span>
                    </div>
                    <div class="cr-routing-row">
                      <span class="cr-routing-label">Geo-resolve</span>
                      <span :class="['cr-routing-val', skippedSample.routing.geoLookupRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                        {{ skippedSample.routing.geoLookupRun ? 'ran' : 'skipped' }}
                      </span>
                    </div>
                    <div class="cr-routing-row">
                      <span class="cr-routing-label">IP-geolocate</span>
                      <span :class="['cr-routing-val', skippedSample.routing.ipGeolocateRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                        {{ skippedSample.routing.ipGeolocateRun ? 'ran' : 'skipped' }}
                      </span>
                    </div>
                    <div class="cr-routing-row">
                      <span class="cr-routing-label">Redaction</span>
                      <span :class="['cr-routing-val', skippedSample.routing.redactionRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                        {{ skippedSample.routing.redactionRun ? 'ran' : 'skipped' }}
                      </span>
                    </div>
                    <div class="cr-routing-row">
                      <span class="cr-routing-label">Pricing</span>
                      <span :class="['cr-routing-val', skippedSample.routing.pricingRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                        {{ skippedSample.routing.pricingRun ? 'ran' : 'skipped' }}
                      </span>
                    </div>
                    <div class="cr-routing-row">
                      <span class="cr-routing-label">ETA</span>
                      <span :class="['cr-routing-val', skippedSample.routing.etaRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                        {{ skippedSample.routing.etaRun ? 'ran' : 'skipped' }}
                      </span>
                    </div>
                    <div class="cr-routing-row">
                      <span class="cr-routing-label">Cold chain</span>
                      <span :class="['cr-routing-val', skippedSample.routing.coldChainRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                        {{ skippedSample.routing.coldChainRun ? 'ran' : 'skipped' }}
                      </span>
                    </div>
                    <div class="cr-routing-row">
                      <span class="cr-routing-label">Customs dwell</span>
                      <span :class="['cr-routing-val', skippedSample.routing.customsDwellRun ? 'cr-tag--ran' : 'cr-tag--skipped']">
                        {{ skippedSample.routing.customsDwellRun ? 'ran' : 'skipped' }}
                      </span>
                    </div>
                  </div>
                </template>

              </template>

              <template v-else-if="isDone">
                <p class="cr-placeholder">No qualifying records found in this run.</p>
              </template>

            </div>
          </template>

          <!-- Trace tab: node lifecycle stream -->
          <template #trace>
            <div class="cr-trace-pane">
              <div v-if="trace.length === 0" class="cr-placeholder">
                No trace entries yet. Start a run to see node events.
              </div>
              <div
                v-for="(entry, idx) in trace"
                :key="idx"
                :class="['cr-trace-row', `cr-trace-row--${entry.kind}`]"
              >
                <span class="cr-trace-kind">{{ entry.kind }}</span>
                <span class="cr-trace-node mono">{{ entry.node }}</span>
                <template v-if="entry.kind === 'end' && entry.output !== undefined">
                  <span class="cr-trace-output">→ {{ entry.output }}</span>
                </template>
                <template v-else-if="entry.kind === 'error'">
                  <span class="cr-trace-error">{{ entry.message }}</span>
                </template>
              </div>
            </div>
          </template>

        </PanesTabs>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ── Container ─────────────────────────────────────────────────────────── */
.cartographer-runner {
  container-type: inline-size;
  container-name: cartographer;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 1rem;
  background: var(--vp-c-bg-alt);
  font-family: var(--vp-font-family-base);
  width: 100%;
}

/* ── Error banner ──────────────────────────────────────────────────────── */
.cr-error-banner {
  margin-bottom: 0.85rem;
  padding: 0.65rem 0.9rem;
  border: 1px solid var(--dagonizer-brand3);
  border-radius: 6px;
  background: rgba(212, 166, 73, 0.08);
  font-size: 0.85rem;
  color: var(--vp-c-text-1);
}

/* ── Two-column grid: iridis pattern ──────────────────────────────────── */
.cr-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
}

@container cartographer (min-width: 720px) {
  .cr-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.55fr);
  }
}

/* ── Column ────────────────────────────────────────────────────────────── */
.cr-col {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

/* ── Column head ─────────────────────────────────────────────────────── */
.cr-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 1.75rem;
}

.cr-label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.cr-hint {
  font-size: 0.7rem;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}

/* ── Tabs ──────────────────────────────────────────────────────────────── */
.cr-tabs {
  flex: 1 1 auto;
  min-height: 440px;
  max-height: min(800px, calc(100vh - 260px));
  overflow: hidden;
}

.cr-tabs--left {
  /* Left column shrinks slightly for the pinned run bar. */
  min-height: 400px;
}

.cr-tabs--right {
  min-height: 520px;
  max-height: min(860px, calc(100vh - 200px));
}

/* ── Stream pane ───────────────────────────────────────────────────────── */
.cr-stream-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* ── Progress bar ──────────────────────────────────────────────────────── */
.cr-progress-wrap {
  flex-shrink: 0;
  height: 3px;
  background: var(--vp-c-divider);
  overflow: hidden;
}

.cr-progress-bar {
  height: 100%;
  background: var(--dagonizer-brand);
  transition: width 0.3s ease;
  min-width: 0;
}

.cr-progress-bar--running {
  animation: progress-shimmer 1.6s linear infinite;
}

.cr-progress-bar--done {
  background: var(--dagonizer-brand2);
  transition: none;
}

@keyframes progress-shimmer {
  0%   { filter: brightness(1);    }
  50%  { filter: brightness(1.35); }
  100% { filter: brightness(1);    }
}

/* ── Stream empty state ─────────────────────────────────────────────────── */
.cr-stream-empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.82rem;
  color: var(--vp-c-text-3);
  padding: 1.5rem 0.75rem;
}

/* ── Stream feed (scrollable list, newest at bottom) ────────────────────── */
.cr-stream-feed {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0.45rem 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  scrollbar-width: thin;
  scrollbar-color: var(--vp-c-divider) transparent;
}

.cr-stream-row {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  font-size: 0.74rem;
  line-height: 1.7;
  padding: 0.2rem 0;
  border-bottom: 1px solid transparent;
  flex-wrap: nowrap;
  overflow: hidden;
}

.cr-stream-id {
  flex-shrink: 0;
  color: var(--dagonizer-brand);
  font-size: 0.72rem;
}

.cr-stream-sep {
  flex-shrink: 0;
  color: var(--vp-c-text-3);
  font-size: 0.68rem;
}

.cr-stream-scan {
  flex-shrink: 0;
  color: var(--vp-c-text-3);
  font-size: 0.7rem;
}

.cr-stream-type {
  flex-shrink: 0;
  color: var(--vp-c-text-2);
  font-size: 0.72rem;
}

.cr-stream-continent {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--vp-c-text-3);
  font-size: 0.7rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cr-stream-redacted {
  flex-shrink: 0;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--dagonizer-brand3);
  padding: 0.05rem 0.3rem;
  border-radius: 3px;
  background: rgba(212, 166, 73, 0.12);
}

/* ── Left pane: insights ───────────────────────────────────────────────── */
.cr-left-pane {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  height: 100%;
  padding: 0.75rem;
  overflow-y: auto;
}

.cr-intro {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.55;
  color: var(--vp-c-text-1);
}

.cr-section-head {
  margin: 0.5rem 0 0.3rem;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

/* ── Pinned Run bar (mirrors SendForm) ─────────────────────────────────── */
.cr-run-bar {
  flex-shrink: 0;
  padding: 0.6rem 0.75rem;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
}

.cr-run-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.cr-run-status-text {
  flex: 1 1 auto;
  min-width: 0;
}

.cr-run-status {
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  padding: 0.2rem 0.55rem;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.cr-run-status--live {
  background: rgba(34, 232, 255, 0.14);
  color: var(--dagonizer-brand);
  animation: status-pulse 1.6s ease-in-out infinite;
}

.cr-run-status--done {
  background: rgba(34, 232, 255, 0.10);
  color: var(--dagonizer-brand2);
}

@keyframes status-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.65; }
}

.cr-run-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */
.cr-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.45rem 1.1rem;
  border-radius: 5px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.83rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease, filter 0.12s ease;
}

.cr-btn--run {
  background: var(--dagonizer-brand);
  color: #000;
  border-color: var(--dagonizer-brand);
  min-width: 72px;
}

.cr-btn--run:hover {
  background: var(--dagonizer-brand2);
  border-color: var(--dagonizer-brand2);
}

.cr-btn--cancel {
  position: relative;
  overflow: hidden;
  background: #c0392b;
  color: #fff;
  border-color: #c0392b;
  min-width: 72px;
}

.cr-btn--cancel:hover { filter: brightness(1.1); }

.cr-btn--reset {
  background: transparent;
  color: var(--vp-c-text-3);
  border-color: var(--vp-c-divider);
  font-size: 0.72rem;
  padding: 0.3rem 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.cr-btn--reset:hover {
  border-color: var(--dagonizer-brand3);
  color: var(--dagonizer-brand3);
}

.cr-btn-spinner {
  position: absolute;
  inset: 6px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.18);
  border-top-color: rgba(255, 255, 255, 0.9);
  animation: btn-spin 0.9s linear infinite;
  pointer-events: none;
}

.cr-btn-glyph {
  position: relative;
  z-index: 1;
}

@keyframes btn-spin {
  to { transform: rotate(360deg); }
}

/* ── Tables ────────────────────────────────────────────────────────────── */
/* Reset VitePress's global `.vp-doc table` styling that bleeds into this
   embedded component: `.vp-doc table { display: block; overflow-x: auto;
   margin: 20px 0 }`, the `tr:nth-child(2n)` zebra, and full `th/td` borders.
   Without restoring `display: table` the table layout breaks and wrapped
   headers clip. */
.cr-table {
  display: table;
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  margin: 0;
  overflow: visible;
}

.cr-table tr {
  background: transparent;
  border: none;
}

.cr-table th,
.cr-table td {
  border: none;
  border-bottom: 1px solid var(--vp-c-divider);
  padding: 0.34rem 0.5rem;
  text-align: left;
  line-height: 1.45;
  vertical-align: bottom;
  background: transparent;
  color: var(--vp-c-text-1);
}

.cr-table th {
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.cr-table--compact td,
.cr-table--compact th {
  padding: 0.26rem 0.5rem;
}

/* ── Panels pane (Before/After tab) ──────────────────────────────────── */
.cr-panels-pane {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.75rem;
  height: 100%;
  overflow-y: auto;
}

.cr-placeholder {
  font-size: 0.82rem;
  color: var(--vp-c-text-3);
  margin: 0.5rem 0;
}

/* ── Journey cards ──────────────────────────────────────────────────────── */
.cr-journey-card {
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.cr-journey-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.cr-journey-id {
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
  color: var(--vp-c-text-1);
}

.cr-journey-badge {
  padding: 0.12rem 0.4rem;
  border-radius: 3px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.badge--ok  { background: rgba(34, 232, 255, 0.15); color: var(--dagonizer-brand); }
.badge--late { background: rgba(212, 166, 73, 0.15); color: var(--dagonizer-brand3); }
.badge--exception { background: rgba(180, 70, 70, 0.15); color: #e06060; }

.cr-journey-meta {
  font-size: 0.76rem;
  color: var(--vp-c-text-3);
}

/* ── Shared graph pane ─────────────────────────────────────────────────── */
.graph-pane {
  position: relative;
  width: 100%;
  height: 640px;
}

.cartographer-runner.is-running .graph-pane {
  box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 28px -6px var(--dagonizer-brand);
  animation: dag-pulse 1.8s ease-in-out infinite;
  border-radius: 8px;
}

@keyframes dag-pulse {
  0%, 100% { box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 28px -8px var(--dagonizer-brand); }
  50%       { box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 36px -2px var(--dagonizer-brand); }
}

/* ── Trace pane ──────────────────────────────────────────────────────────── */
.cr-trace-pane {
  height: 100%;
  overflow-y: auto;
  padding: 0.5rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.cr-trace-row {
  display: flex;
  gap: 0.45rem;
  align-items: baseline;
  font-size: 0.76rem;
  padding: 0.1rem 0;
  border-bottom: 1px solid transparent;
}

.cr-trace-row--start  .cr-trace-kind { color: var(--dagonizer-brand); }
.cr-trace-row--end    .cr-trace-kind { color: var(--dagonizer-brand2); }
.cr-trace-row--error  .cr-trace-kind { color: #e06060; }

.cr-trace-kind {
  flex: 0 0 36px;
  font-size: 0.67rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.cr-trace-node {
  flex: 1 1 auto;
  color: var(--vp-c-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cr-trace-output {
  flex-shrink: 0;
  color: var(--dagonizer-brand2);
  font-size: 0.72rem;
}

.cr-trace-error {
  flex-shrink: 0;
  color: #e06060;
  font-size: 0.72rem;
}

.mono {
  font-family: var(--vp-font-family-mono);
}

/* ── Before/After record header ─────────────────────────────────────────── */
.cr-ba-header {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.45rem 0.6rem;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  margin-bottom: 0.1rem;
}

.cr-ba-header--secondary {
  border-color: var(--dagonizer-brand3);
  background: rgba(212, 166, 73, 0.05);
}

.cr-ba-header-id {
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--dagonizer-brand);
}

.cr-ba-header-meta {
  font-size: 0.72rem;
  color: var(--vp-c-text-3);
}

/* ── Stage transform grid ─────────────────────────────────────────────────── */
.cr-stage-grid {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0.35rem 0.65rem;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  margin-bottom: 0.1rem;
}

.cr-sg-row {
  display: grid;
  grid-template-columns: 120px 1fr 18px 1fr;
  gap: 0.3rem;
  align-items: baseline;
  font-size: 0.78rem;
  padding: 0.18rem 0;
  border-bottom: 1px solid var(--vp-c-divider);
}

.cr-sg-row:last-child {
  border-bottom: none;
}

.cr-sg-label {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cr-sg-before {
  color: var(--vp-c-text-3);
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cr-sg-arrow {
  color: var(--vp-c-text-3);
  font-size: 0.8rem;
  text-align: center;
  flex-shrink: 0;
}

.cr-sg-after {
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  color: var(--dagonizer-brand);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Routing decision grid ───────────────────────────────────────────────── */
.cr-routing-grid {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0.35rem 0.65rem;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  margin-bottom: 0.1rem;
}

.cr-routing-row {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
  font-size: 0.78rem;
  padding: 0.18rem 0;
  border-bottom: 1px solid var(--vp-c-divider);
}

.cr-routing-row:last-child {
  border-bottom: none;
}

.cr-routing-label {
  flex: 0 0 110px;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-3);
}

.cr-routing-val {
  flex: 1 1 auto;
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  color: var(--vp-c-text-1);
}

/* ── Ran / Skipped tags ──────────────────────────────────────────────────── */
.cr-tag--ran {
  color: var(--dagonizer-brand);
  font-weight: 600;
}

.cr-tag--skipped {
  color: var(--vp-c-text-3);
}

/* ── Inline placeholder (within a section) ──────────────────────────────── */
.cr-placeholder--inline {
  font-size: 0.78rem;
  color: var(--vp-c-text-3);
  padding: 0.25rem 0.65rem;
  margin: 0 0 0.1rem;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
}
</style>
