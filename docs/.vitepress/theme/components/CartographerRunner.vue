<script setup lang="ts">
/**
 * CartographerRunner: orchestrator for the in-browser Cartographer demo.
 *
 * Two-column iridis-style layout (parity with ArchivistRunner):
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ <single-column on narrow; two-column at ≥720px container width>      │
 *   ├───────────────────────────────────┬────────────────────────────────────┤
 *   │ LEFT COL                          │ RIGHT COL                          │
 *   │ tabs: Stream | Insights | Compare  │ tabs: DAG | Config | Trace         │
 *   │ (live feed + % bar)                │                                    │
 *   │ [pinned Run bar]                   │                                    │
 *   └───────────────────────────────────┴────────────────────────────────────┘
 *
 * No LLM — purely deterministic data orchestration. Subclasses ObservedDag
 * (generic Dagonizer subclass) and reuses DagGraph (animated cytoscape host).
 * SSR-safe: all browser-only work is guarded to onMounted / click handlers.
 */

import { computed, nextTick, onMounted, ref } from 'vue';

import { CartographerState } from '../../../../examples/the-cartographer/CartographerState.ts';
import type { JourneyInsights, RegionInsights } from '../../../../examples/the-cartographer/CartographerState.ts';
import type { CartographerServices } from '../../../../examples/the-cartographer/CartographerServices.ts';
import { cartographerWorkersDAG, CartographerWorkersDag, eventPipelineBundle } from '../../../../examples/the-cartographer/dag.ts';
import { ingestSourceBundle } from '../../../../examples/the-cartographer/embedded-dags/IngestSourceDAG.ts';
import { GeoSourceResolveDAG } from '../../../../examples/the-cartographer/embedded-dags/GeoSourceResolveDAG.ts';
import { gdprComplianceBundle } from '../../../../examples/the-cartographer/embedded-dags/GdprComplianceDAG.ts';
import { orderEnrichmentBundle } from '../../../../examples/the-cartographer/embedded-dags/OrderEnrichmentDAG.ts';
import { GeoResolvers } from '../../../../examples/the-cartographer/services/GeoResolvers.ts';
import type { EnrichedShipment } from '../../../../examples/the-cartographer/entities/EnrichedShipment.ts';
import type { CanonicalEventVariant } from '../../../../examples/the-cartographer/entities/CanonicalEvent.ts';
import type { FormatMix } from '../../../../examples/the-cartographer/services.ts';

import { ObservedDag } from '../../../../examples/the-archivist/ObservedDag.ts';
import { ConsoleLogger } from '../../../../examples/the-archivist/logger/ConsoleLogger.ts';
import { WebWorkerContainer } from '@studnicky/dagonizer-executor-web';
import type { WebWorkerLikeInterface } from '@studnicky/dagonizer-executor-web';
import DagGraph from './DagGraph.vue';
import PanesTabs from './PanesTabs.vue';
import AboxAccordion from './AboxAccordion.vue';
import type { AboxEntity } from './AboxAccordion.vue';
import Spinner from './Spinner.vue';

// ── Web-worker container ───────────────────────────────────────────────────────
// Runs the CPU-heavy stream-event scatter body (decode → route → per-type
// pipelines) off the main thread. `spawnWorker` is the consumer seam Vite needs
// to chunk the worker entry; the entry statically injects its registry so no
// dynamic import runs in the worker.
class CartographerWorkerContainer extends WebWorkerContainer {
  protected override spawnWorker(): WebWorkerLikeInterface {
    return new Worker(
      new URL('./cartographerWorkerEntry.ts', import.meta.url),
      { 'type': 'module' },
    ) as unknown as WebWorkerLikeInterface;
  }
}

// ── Types ────────────────────────────────────────────────────────────────────
type TraceEvent =
  | { readonly variant: 'start'; readonly node: string; readonly ts: number }
  | { readonly variant: 'end';   readonly node: string; readonly ts: number; readonly output: string | null }
  | { readonly variant: 'error'; readonly node: string; readonly ts: number; readonly message: string };

/** One line in the live stream feed (one gathered record per line). */
interface StreamLine {
  readonly shipmentId: string;
  readonly scanSeq: number;
  readonly status: string;
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
/** Pre-stream canonical events captured in onFlowEnd (the before payloads). */
const canonicalEvents = ref<CanonicalEventVariant[]>([]);
const insightsMap = ref<Map<string, RegionInsights>>(new Map());
const journeysMap = ref<Map<string, JourneyInsights>>(new Map());

const dagGraph = ref<InstanceType<typeof DagGraph> | null>(null);

// Every sub-DAG the cartographer DAG embeds, keyed by name, derived from the
// scatter-body bundle so it never drifts. Lets the graph expand the full
// topology (process-stream → stream-event → 5 per-type pipelines → geo-pipeline
// → leaves) and animate inner nodes as the worker relay reports them.
//
// geo-source-resolve and its inner resolve-one-signal scatter body are built
// per-call by GeoSourceResolveDAG.build (they carry injected transports), so
// they are NOT in eventPipelineBundle.dags. Build them once here with the
// recorded transports purely to register their topology, so the graph expands
// the full per-concept geo resolution (route-signal → resolve-coords / -address
// / -ip / -code / -phone / -locale / -none) instead of one collapsed node.
const geoDocServices = GeoResolvers.recorded();
const geoDocBundle = GeoSourceResolveDAG.build(
  geoDocServices.ipGeolocator,
  geoDocServices.addressGeocoder,
);
const embeddedDagRegistry = new Map(
  [...eventPipelineBundle.dags, ...geoDocBundle.dags].map((d) => [d.name, d] as const),
);

// ── Feed configuration ───────────────────────────────────────────────────────

/**
 * Per-payload-type row (mutable UI state). The visitor controls each type's
 * SHARE of the total; the absolute count is apportioned from the global total
 * at run time. Streaming is the only execution mode.
 */
interface TypeRow {
  eventType: CanonicalEventVariant['eventType'];
  pct: number;
}

/**
 * Default wire-format spread applied to every payload type. Format is an
 * internal axis — the panel exposes total + type spread only — but the
 * generator still emits mixed JSON / CSV / gzip-NDJSON / YAML so the streaming
 * decoder is exercised across every wire format.
 */
const DEFAULT_FORMAT_MIX: FormatMix = [
  { format: 'json',   compression: 'none', weight: 3 },
  { format: 'csv',    compression: 'none', weight: 2 },
  { format: 'ndjson', compression: 'gzip', weight: 2 },
  { format: 'yaml',   compression: 'none', weight: 1 },
];

const typeRows = ref<TypeRow[]>([
  { eventType: 'position-ping',         pct: 40 },
  { eventType: 'facility-scan',         pct: 25 },
  { eventType: 'sensor-reading',        pct: 20 },
  { eventType: 'customs-event',         pct: 10 },
  { eventType: 'delivery-confirmation', pct: 5  },
]);

/** Total events to stream this run; clamped to [1, 1,000,000] at run time. */
const totalEventsInput = ref(100000);

/** Worker pool size; clamped to [1, 32] at run time. */
const poolSizeInput = ref(
  typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0
    ? Math.max(2, navigator.hardwareConcurrency - 2)
    : 4,
);

/** Reservoir capacity (events per worker dispatch batch); clamped to [1, 10000] at run time. */
const batchCapacityInput = ref(1000);

/** Sum of the per-type shares — normalises the spread into absolute counts. */
const sumPct = computed(() =>
  typeRows.value.reduce((s, r) => s + Math.max(0, r.pct), 0),
);

/** The clamped total events the next run will stream. */
const clampedTotal = computed(() => {
  const v = Math.floor(totalEventsInput.value);
  return Math.min(1_000_000, Math.max(1, Number.isNaN(v) ? 1 : v));
});

/** The clamped worker pool size for the next run. */
const clampedPoolSize = computed(() => {
  const v = Math.floor(poolSizeInput.value);
  return Math.min(32, Math.max(1, Number.isNaN(v) ? 1 : v));
});

/** The clamped reservoir capacity (batch size) for the next run. */
const clampedBatchCapacity = computed(() => {
  const v = Math.floor(batchCapacityInput.value);
  return Math.min(10_000, Math.max(1, Number.isNaN(v) ? 1 : v));
});

/**
 * Per-type absolute counts apportioned from the total by share, using the
 * largest-remainder method so the counts sum exactly to the total.
 */
const derivedCounts = computed<number[]>(() => {
  const total = clampedTotal.value;
  const denom = sumPct.value;
  if (denom <= 0) return typeRows.value.map(() => 0);
  const exact = typeRows.value.map((r) => (total * Math.max(0, r.pct)) / denom);
  const counts = exact.map((x) => Math.floor(x));
  let remainder = total - counts.reduce((s, x) => s + x, 0);
  const byFraction = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < byFraction.length && remainder > 0; k++) {
    const entry = byFraction[k];
    if (entry === undefined) break;
    counts[entry.i] = (counts[entry.i] ?? 0) + 1;
    remainder--;
  }
  return counts;
});

/** Maximum number of feed lines held in DOM at any time (virtualization). */
const MAX_VISIBLE_FEED = 200;

/** True total of records appended across the entire run (never trimmed). */
const processedCount = ref(0);

function clampTypePct(row: TypeRow): void {
  const v = Math.floor(row.pct);
  row.pct = Number.isNaN(v) ? 0 : Math.max(0, Math.min(100, v));
}

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
 * ABox entities: pairs each EnrichedShipment (after) with its CanonicalEvent
 * (before) by matching shipmentId + scanSeq. The before payload is optional —
 * when no match is found the accordion still renders the after payload only.
 */
const aboxEntities = computed<AboxEntity[]>(() => {
  // Build a lookup map keyed by "shipmentId::scanSeq" for O(1) pairing.
  const beforeMap = new Map<string, CanonicalEventVariant>();
  for (const ev of canonicalEvents.value) {
    const key = `${ev.shipmentId}::${ev.body.scanSeq}`;
    // If duplicates exist, prefer the one whose epochMs matches (first wins).
    if (!beforeMap.has(key)) {
      beforeMap.set(key, ev);
    }
  }

  return records.value.map<AboxEntity>((after) => {
    const key = `${after.shipmentId}::${after.scanSeq}`;
    const before = beforeMap.get(key);
    const label = `${after.shipmentId} · scan ${after.scanSeq} · ${after.status} · ${after.continent}`;
    return { 'id': key, label, before, after };
  });
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
    'badge': isRunning.value ? 'live' : (processedCount.value > 0 ? String(processedCount.value) : ''),
    'tone': (isRunning.value ? 'live' : 'default') as 'live' | 'default',
  },
  {
    'key': 'insights',
    'label': 'Insights',
    'badge': isDone.value && continentRows.value.length > 0 ? String(continentRows.value.length) : '',
    'tone': 'accent' as const,
  },
  {
    'key': 'compare',
    'label': 'Compare',
    'badge': isDone.value ? String(records.value.length) : '',
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
    'key': 'config',
    'label': 'Config',
    'badge': String(clampedTotal.value),
    'tone': 'default' as const,
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

// ── Browser observer (class extension) ───────────────────────────────────────
// CartographerBrowserObserver subclasses ObservedDag<CartographerState> to add
// Vue-reactive DOM updates on top of the base leveled logging. The buffer/RAF
// throttling below bounds DOM mutations to at most one per animation frame,
// essential for 1,000,000-event scatter runs.
const _cartographerLogger = new ConsoleLogger();

class CartographerBrowserObserver extends ObservedDag<CartographerState> {
  protected override onNodeStart(
    nodeName: string,
    state: CartographerState,
    placementPath: readonly string[],
  ): void {
    super.onNodeStart(nodeName, state, placementPath);
    const fullId = [...placementPath, nodeName].join('/');
    frameActiveNodes.add(fullId);
    // Trace records top-level node events only; inner per-clone activity is
    // conveyed through the progress bar, feed, and throttled graph lighting.
    if (placementPath.length === 0) {
      traceBuffer.push({ 'variant': 'start', 'node': fullId, 'ts': Date.now() });
    }
    scheduleFlush();
  }

  protected override onNodeEnd(
    nodeName: string,
    output: string | null,
    state: CartographerState,
    placementPath: readonly string[],
  ): void {
    super.onNodeEnd(nodeName, output, state, placementPath);
    const fullId = [...placementPath, nodeName].join('/');
    latestRunState = state;
    frameActiveNodes.delete(fullId);
    frameCompletedNodes.add(fullId);
    if (output !== null) frameTraversedEdges.add(`${fullId}|${output}`);
    if (placementPath.length === 0) {
      traceBuffer.push({ 'variant': 'end', 'node': fullId, 'ts': Date.now(), output });
    }
    scheduleFlush();
  }

  protected override onError(
    nodeName: string,
    error: Error,
    state: CartographerState,
    placementPath: readonly string[],
  ): void {
    super.onError(nodeName, error, state, placementPath);
    const fullId = [...placementPath, nodeName].join('/');
    frameErroredNode = fullId;
    traceBuffer.push({ 'variant': 'error', 'node': fullId, 'ts': Date.now(), 'message': error.message !== '' ? error.message : String(error) });
    scheduleFlush();
  }

  protected override onFlowEnd(
    dagName: string,
    state: CartographerState,
    result: import('@studnicky/dagonizer').ExecutionResultType<CartographerState>,
  ): void {
    super.onFlowEnd(dagName, state, result);
    // Final synchronous flush — capture the terminal state exactly.
    latestRunState = state;
    records.value = [...state.sampleRecords];
    // The streaming flow decodes inline; there is no materialised
    // canonical-event array. The Compare accordion's pre-stream source
    // panel is wired in the separate UI follow-up.
    canonicalEvents.value = [];
    insightsMap.value = new Map(state.insights);
    journeysMap.value = new Map(state.journeys);
    trace.value = traceBuffer.slice(-MAX_TRACE);
    applyLiveState(state);
    progressPct.value = 100;
  }
}

// ── Live-update throttling (survives 1,000,000-event runs) ───────────────────
// The streaming scatter fires onNodeStart/onNodeEnd for every inner node of
// every clone — N events × M sub-DAG nodes is millions of observer calls.
// Mutating a reactive ref on each call is O(n²) and freezes the tab. The
// observer instead writes plain buffers and schedules a single
// requestAnimationFrame flush, so the DOM updates at most once per frame
// regardless of event throughput. Node-id and edge sets are bounded by the
// static sub-DAG (~dozens), never by event count.
const MAX_TRACE = 60;

let latestRunState: CartographerState | null = null;
let traceBuffer: TraceEvent[] = [];
const frameActiveNodes = new Set<string>();
const frameCompletedNodes = new Set<string>();
const frameTraversedEdges = new Set<string>();
let frameErroredNode: string | null = null;
let flushScheduled = false;
let flushHandle = 0;

/** Exact processed-event count from the bounded region rollup. */
function exactProcessed(state: CartographerState): number {
  let sum = 0;
  for (const region of state.insights.values()) sum += region.shipmentCount;
  return sum;
}

/** Push progress, feed, and processed-count from a state snapshot. */
function applyLiveState(state: CartographerState): void {
  const processed = exactProcessed(state);
  processedCount.value = processed;
  if (totalEvents > 0) {
    progressPct.value = Math.min(100, Math.round((processed / totalEvents) * 100));
  }
  streamFeed.value = state.sampleRecords.slice(-MAX_VISIBLE_FEED).map((rec) => ({
    shipmentId: rec.shipmentId,
    scanSeq:    rec.scanSeq,
    status:     rec.status,
    continent:  rec.continent,
    redacted:   rec.redactionApplied,
  }));
}

/** Apply all buffered observer state to the DOM. Runs at most once per frame. */
function flushLiveState(): void {
  flushScheduled = false;
  for (const id of frameCompletedNodes) dagGraph.value?.setCompleted(id);
  frameCompletedNodes.clear();
  for (const id of frameActiveNodes) dagGraph.value?.setActive(id);
  frameActiveNodes.clear();
  for (const edge of frameTraversedEdges) {
    const sep = edge.lastIndexOf('|');
    dagGraph.value?.markEdgeTraversed(edge.slice(0, sep), edge.slice(sep + 1));
  }
  frameTraversedEdges.clear();
  if (frameErroredNode !== null) { dagGraph.value?.setErrored(frameErroredNode); frameErroredNode = null; }

  trace.value = traceBuffer.slice(-MAX_TRACE);
  if (latestRunState !== null) {
    applyLiveState(latestRunState);
    void nextTick(scrollFeedToBottom);
  }
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  flushHandle = requestAnimationFrame(flushLiveState);
}

/** Reset throttle buffers between runs. */
function resetLiveBuffers(): void {
  if (flushHandle !== 0) cancelAnimationFrame(flushHandle);
  flushHandle = 0;
  flushScheduled = false;
  latestRunState = null;
  traceBuffer = [];
  frameActiveNodes.clear();
  frameCompletedNodes.clear();
  frameTraversedEdges.clear();
  frameErroredNode = null;
}

// ── Run ───────────────────────────────────────────────────────────────────────
async function run(): Promise<void> {
  if (isRunning.value) return;

  isRunning.value = true;
  isDone.value = false;
  errorMessage.value = null;
  trace.value = [];
  records.value = [];
  canonicalEvents.value = [];
  insightsMap.value = new Map();
  journeysMap.value = new Map();
  streamFeed.value = [];
  processedCount.value = 0;
  progressPct.value = 0;
  totalEvents = clampedTotal.value;
  resetLiveBuffers();

  await dagGraph.value?.reset();

  let dispatcher: CartographerBrowserObserver | null = null;

  try {
    // Offline recorded geo on both sides: the worker registry builds its own
    // recorded services record; the main thread (seed + summarize + gather) needs
    // no network. Deterministic and infeasible-to-network-at-1M.
    const services: CartographerServices = GeoResolvers.recorded();

    // One worker pool drives the scatter fanout off the main thread. Pool size
    // and reservoir capacity are visitor-controlled via the Config panel.
    // The scatter binds container 'cpu' (cartographerWorkersDAG), so the body
    // runs in these workers.
    const container = new CartographerWorkerContainer({
      'registryModule':  new URL('./cartographerWorkerEntry.ts', import.meta.url).href,
      'registryVersion': '1.0.0',
      'servicesConfig':  { 'useRecordedIp': true },
      'poolSize':        clampedPoolSize.value,
    });

    dispatcher = new CartographerBrowserObserver(_cartographerLogger, { 'containers': { 'cpu': container } });

    // Bundle registration order: sub-DAGs first so their names resolve.
    dispatcher.registerBundle(GeoSourceResolveDAG.build(services.ipGeolocator, services.addressGeocoder));
    dispatcher.registerBundle(orderEnrichmentBundle);
    dispatcher.registerBundle(gdprComplianceBundle);
    dispatcher.registerBundle(ingestSourceBundle);
    dispatcher.registerBundle(CartographerWorkersDag.bundle(clampedBatchCapacity.value));

    const state = new CartographerState();

    // Apportion the total across payload types by share. Streaming is the only
    // execution mode — the generative streamer yields events lazily so memory
    // stays flat regardless of total.
    const counts = derivedCounts.value;
    state.eventConfig = typeRows.value.map((r, i) => ({
      'eventType':  r.eventType,
      'count':      counts[i] ?? 0,
      'formatMix':  DEFAULT_FORMAT_MIX,
    }));

    state.useStreamingSource = true;
    state.streamCount = clampedTotal.value;
    state.eventCount = clampedTotal.value;

    activeAbortController = new AbortController();

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
    await dispatcher?.destroy();
    activeAbortController = null;
    isRunning.value = false;
    isDone.value = true;
  }
}

function reset(): void {
  if (isRunning.value) return;
  records.value = [];
  canonicalEvents.value = [];
  insightsMap.value = new Map();
  journeysMap.value = new Map();
  trace.value = [];
  streamFeed.value = [];
  processedCount.value = 0;
  progressPct.value = 0;
  totalEvents = 0;
  resetLiveBuffers();
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

      <!-- LEFT: Stream | Insights | Compare + pinned Run bar -->
      <div class="cr-col cr-col--left">
        <div class="cr-col-head">
          <span class="cr-label">Cartographer</span>
          <span class="cr-hint">{{ flowHint }}</span>
        </div>

        <!-- Tab host: Stream, Insights, and Compare -->
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
                  <span class="cr-stream-type">{{ line.status }}</span>
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
                      <td>{{ row.region }}</td>
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

          <!-- Compare tab: ABox accordion list — one entity per processed event -->
          <template #compare>
            <div class="cr-panels-pane">

              <template v-if="!isDone">
                <p class="cr-placeholder">Run the pipeline to see the before / after transformations.</p>
              </template>

              <template v-else-if="aboxEntities.length > 0">
                <p class="cr-ba-intro">
                  {{ aboxEntities.length }} ABox entities — click a row to inspect its
                  pre-stream (CanonicalEvent) and post-stream (EnrichedShipment) payloads side by side.
                </p>
                <div class="cr-ba-list">
                  <AboxAccordion :entities="aboxEntities" />
                </div>
              </template>

              <template v-else>
                <p class="cr-placeholder">No records found in this run.</p>
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
                <Spinner />
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

      <!-- RIGHT: DAG | Config | Trace -->
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
                :dag="cartographerWorkersDAG"
                :embedded-d-a-gs="embeddedDagRegistry"
                :expand-all="true"
                aria-label="Cartographer DAG live execution"
              />
            </div>
          </template>

          <!-- Config tab: total events + payload-type spread (always streaming) -->
          <template #config>
            <div class="cr-left-pane cr-config-pane">

              <!-- Total events -->
              <div class="cr-config-section">
                <div class="cr-section-head">Total events</div>
                <div class="cr-stream-count-row">
                  <input
                    id="cartographer-total-events"
                    name="cartographer-total-events"
                    type="number"
                    min="1"
                    max="1000000"
                    class="cr-count-input cr-count-input--wide"
                    v-model.number="totalEventsInput"
                  />
                  <button type="button" class="cr-btn cr-btn--quickpick" @click="totalEventsInput = 1000">1k</button>
                  <button type="button" class="cr-btn cr-btn--quickpick" @click="totalEventsInput = 10000">10k</button>
                  <button type="button" class="cr-btn cr-btn--quickpick" @click="totalEventsInput = 100000">100k</button>
                  <button type="button" class="cr-btn cr-btn--quickpick" @click="totalEventsInput = 1000000">1M</button>
                </div>
              </div>

              <!-- Payload-type spread -->
              <div class="cr-config-section">
                <div class="cr-section-head">Payload type spread</div>
                <table class="cr-table cr-table--compact cr-feed-table">
                  <thead>
                    <tr>
                      <th>Payload type</th>
                      <th>Share %</th>
                      <th>≈ events</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, i) in typeRows" :key="row.eventType">
                      <td class="cr-feed-fmt mono">{{ row.eventType }}</td>
                      <td>
                        <input
                          :id="`cartographer-type-pct-${row.eventType}`"
                          :name="`cartographer-type-pct-${row.eventType}`"
                          type="number"
                          min="0"
                          max="100"
                          class="cr-count-input"
                          v-model.number="row.pct"
                          @change="clampTypePct(row)"
                        />
                      </td>
                      <td class="cr-feed-fmt mono">{{ (derivedCounts[i] ?? 0).toLocaleString() }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- Execution knobs -->
              <div class="cr-config-section">
                <div class="cr-section-head">Execution</div>
                <table class="cr-table cr-table--compact cr-feed-table">
                  <tbody>
                    <tr>
                      <td>Worker pool size</td>
                      <td>
                        <input
                          id="cartographer-pool-size"
                          name="cartographer-pool-size"
                          type="number"
                          min="1"
                          max="32"
                          class="cr-count-input"
                          v-model.number="poolSizeInput"
                        />
                      </td>
                      <td class="cr-feed-fmt">threads (1–32)</td>
                    </tr>
                    <tr>
                      <td>Batch size</td>
                      <td>
                        <input
                          id="cartographer-batch-capacity"
                          name="cartographer-batch-capacity"
                          type="number"
                          min="1"
                          max="10000"
                          class="cr-count-input"
                          v-model.number="batchCapacityInput"
                        />
                      </td>
                      <td class="cr-feed-fmt">events per worker dispatch (1–10 000)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- Summary line -->
              <div class="cr-config-summary">
                Always streaming: <span class="cr-config-count">{{ clampedTotal.toLocaleString() }}</span>
                events across {{ typeRows.filter(r => r.pct > 0).length }} payload type(s),
                {{ clampedPoolSize }} worker{{ clampedPoolSize !== 1 ? 's' : '' }},
                batch size {{ clampedBatchCapacity.toLocaleString() }}
              </div>

              <div class="cr-config-note">
                The generative streamer yields events lazily — heap stays flat regardless of total.
                The live feed is virtualized to the most recent {{ MAX_VISIBLE_FEED }} lines and the
                DAG/trace updates are frame-throttled, so a 1,000,000-event run does not freeze the
                tab. The Stream badge shows the true processed count.
              </div>

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
                :class="['cr-trace-row', `cr-trace-row--${entry.variant}`]"
              >
                <span class="cr-trace-variant">{{ entry.variant }}</span>
                <span class="cr-trace-node mono">{{ entry.node }}</span>
                <template v-if="entry.variant === 'end' && entry.output !== null">
                  <span class="cr-trace-output">→ {{ entry.output }}</span>
                </template>
                <template v-else-if="entry.variant === 'error'">
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
  flex-shrink: 0;
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

/* ── Config pane ────────────────────────────────────────────────────────── */
.cr-config-pane {
  gap: 1rem;
}

.cr-config-section {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.cr-preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.cr-btn--preset {
  padding: 0.28rem 0.65rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  background: transparent;
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
  font-family: var(--vp-font-family-mono);
}

.cr-btn--preset:hover {
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
  background: rgba(34, 232, 255, 0.07);
}

.cr-feed-table {
  table-layout: fixed;
  width: 100%;
}

.cr-feed-fmt {
  width: 6rem;
  color: var(--dagonizer-brand);
  font-size: 0.78rem;
}

.cr-btn--compression {
  padding: 0.18rem 0.5rem;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background: transparent;
  color: var(--vp-c-text-3);
  border: 1px solid var(--vp-c-divider);
  border-radius: 3px;
  cursor: pointer;
  font-family: var(--vp-font-family-mono);
  transition: border-color 0.1s ease, color 0.1s ease, background 0.1s ease;
}

.cr-btn--compression-active {
  border-color: var(--dagonizer-brand3);
  color: var(--dagonizer-brand3);
  background: rgba(212, 166, 73, 0.1);
}

.cr-btn--compression:hover {
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
}

.cr-count-input {
  width: 5rem;
  padding: 0.2rem 0.4rem;
  font-size: 0.78rem;
  font-family: var(--vp-font-family-mono);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  appearance: textfield;
}

.cr-count-input:focus {
  outline: none;
  border-color: var(--dagonizer-brand);
}

.cr-count-input--wide {
  width: 8rem;
}

.cr-toggle-label {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  cursor: pointer;
  user-select: none;
}

.cr-toggle-check {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  accent-color: var(--dagonizer-brand);
  cursor: pointer;
}

.cr-toggle-text {
  font-size: 0.82rem;
  color: var(--vp-c-text-1);
  line-height: 1.45;
}

.cr-stream-count-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.cr-btn--quickpick {
  padding: 0.2rem 0.55rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: transparent;
  color: var(--vp-c-text-3);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  cursor: pointer;
  font-family: var(--vp-font-family-mono);
  transition: border-color 0.1s ease, color 0.1s ease;
}

.cr-btn--quickpick:hover {
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
}

.cr-config-summary {
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  padding: 0.45rem 0.6rem;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 5px;
}

.cr-config-count {
  color: var(--dagonizer-brand);
  font-weight: 700;
}

.cr-config-note {
  font-size: 0.76rem;
  color: var(--vp-c-text-3);
  line-height: 1.55;
  padding: 0.5rem 0.65rem;
  border-left: 2px solid var(--dagonizer-brand);
  background: rgba(34, 232, 255, 0.04);
  border-radius: 0 4px 4px 0;
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

.cr-btn-glyph {
  position: relative;
  z-index: 1;
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

/* ── Panels pane (Compare tab) ──────────────────────────────────────── */
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

.cr-trace-row--start  .cr-trace-variant { color: var(--dagonizer-brand); }
.cr-trace-row--end    .cr-trace-variant { color: var(--dagonizer-brand2); }
.cr-trace-row--error  .cr-trace-variant { color: #e06060; }

.cr-trace-variant {
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

/* ── Compare record header ─────────────────────────────────────────────── */
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

/* ── Compare accordion intro line ──────────────────────────────────────── */
.cr-ba-intro {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  line-height: 1.5;
}

/* ── Scrollable accordion host within the panels pane ───────────────────── */
.cr-ba-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  scrollbar-width: thin;
  scrollbar-color: var(--vp-c-divider) transparent;
}
</style>
