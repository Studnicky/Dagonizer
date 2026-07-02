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
 * In-process (default, works with tsx):
 *   npx tsx examples/the-cartographer/runCartographer.ts [--events N] [--recorded]
 *
 * Worker-thread path (CARTO_WORKERS=1 or --workers flag):
 *   Each canonical-event enrichment body runs inside a WorkerThreadContainer
 *   (real worker threads). The worker registry must be compiled to JS first:
 *     tsc -p examples/the-cartographer/tsconfig.workers.json
 *   Then run as plain Node.js:
 *     node examples/the-cartographer/dist/runCartographer.js --workers [--events N]
 *   Or with the npm script (once added to package.json):
 *     pnpm cartographer:workers
 *
 * Container vs in-process: the `process-events` scatter binds container: 'cpu'
 * in cartographerWorkersDAG (workers mode) vs no container in cartographerDAG
 * (in-process mode). Same state, same nodes, same sub-DAGs — only the dispatch
 * strategy differs. The worker registry (workers/eventPipelineRegistry.ts)
 * reconstructs the event-pipeline bundle inside each thread.
 */

// #region run-cartographer
import { CartographerState } from './CartographerState.ts';
import type { JourneyInsights, RegionInsights } from './CartographerState.ts';
import type { CartographerServices } from './CartographerServices.ts';
import { cartographerBundle, cartographerResumeBundle, cartographerWorkersBundle } from './dag.ts';
import { gdprComplianceBundle } from './embedded-dags/GdprComplianceDAG.ts';
import { GeoSourceResolveDAG } from './embedded-dags/GeoSourceResolveDAG.ts';
import { ingestSourceBundle } from './embedded-dags/IngestSourceDAG.ts';
import { orderEnrichmentBundle } from './embedded-dags/OrderEnrichmentDAG.ts';
import type { EnrichedShipment } from './entities/EnrichedShipment.ts';
import type { ConsoleLogger } from './logger/ConsoleLogger.ts';
import { ObservedCartographer } from './ObservedCartographer.ts';
import type { DagonizerOptionsType } from '@studnicky/dagonizer';
import { GeoResolvers } from './services/GeoResolvers.ts';
import { ErrorRollup, type ErrorRollupType } from './errors/ErrorRollup.ts';

import { DAGError } from '@studnicky/dagonizer/errors';
import { StreamChannel, StreamCursor } from '@studnicky/dagonizer/channels';
import { EventStreamSource } from './services/EventStreamSource.ts';

// ── Parse CLI args ────────────────────────────────────────────────────────────
let eventCount = 200;
let forceRecorded = false;
let useWorkers = process.env['CARTO_WORKERS'] === '1';
let useStreaming = process.env['CARTO_STREAM'] === '1';
let streamCount = 0;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--events' && args[i + 1] !== undefined) {
    const parsed = parseInt(args[i + 1] ?? '200', 10);
    if (!isNaN(parsed) && parsed > 0) eventCount = parsed;
  } else if (args[i] === '--recorded') {
    forceRecorded = true;
  } else if (args[i] === '--workers') {
    useWorkers = true;
  } else if (args[i] === '--stream') {
    useStreaming = true;
  } else if (args[i] === '--stream-count' && args[i + 1] !== undefined) {
    const parsed = parseInt(args[i + 1] ?? '0', 10);
    if (!isNaN(parsed) && parsed > 0) streamCount = parsed;
    i++;
  } else if (/^\d+$/.test(args[i] ?? '')) {
    const parsed = parseInt(args[i] ?? '200', 10);
    if (!isNaN(parsed) && parsed > 0) eventCount = parsed;
  }
}

// ── CLI utilities ─────────────────────────────────────────────────────────────

// #region aborting-cartographer
/**
 * AbortingCartographer: ObservedCartographer subclass for the resume scenario.
 *
 * Fires an AbortController after N scatter item completions (detected by
 * watching for `aggregate-event` nodes inside the `process-stream` scatter body).
 * Injection via constructor keeps the abort logic out of the main dispatcher.
 */
class AbortingCartographer extends ObservedCartographer {
  readonly #controller: AbortController;
  readonly #threshold: number;
  #count: number;

  constructor(options: DagonizerOptionsType, controller: AbortController, threshold: number) {
    super(options);
    this.#controller = controller;
    this.#threshold = threshold;
    this.#count = 0;
  }

  protected override onNodeEnd(
    nodeName: string,
    output: string | null,
    state: CartographerState,
    placementPath: readonly string[],
  ): void {
    super.onNodeEnd(nodeName, output, state, placementPath);
    // Count completions of aggregate-event inside the process-stream scatter.
    // aggregate-event is the last enrichment node before the scatter body terminal.
    if (nodeName === 'aggregate-event' && placementPath.includes('process-stream')) {
      if (++this.#count >= this.#threshold) {
        this.#controller.abort();
      }
    }
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }
}
// #endregion aborting-cartographer

// #region cartographer-resumable-scenario
/** Fixed event count for the interrupted+resume run pair. */
const RESUME_EVENT_COUNT = 40;
/**
 * Number of scatter item completions (aggregate-event inside process-stream)
 * after which the interrupted run aborts. cartographerResumeDAG has no reservoir,
 * so items are dispatched one-at-a-time (ScatterWorkerPool path) and the abort
 * signal fires between pulls — giving a non-zero StreamCursor value.
 */
const ABORT_AFTER_ITEMS = 8;

/**
 * InsightsFingerprint: deterministic canonical digest of a regional insights Map.
 *
 * Sorts entries by region → country → hub and emits all numeric fields of each
 * RegionInsights plus the string keys. JSON.stringify over the sorted plain array
 * gives a stable string suitable for equality comparison.
 */
class InsightsFingerprint {
  private constructor() { /* static-only */ }

  static of(insights: Map<string, RegionInsights>): string {
    const rows = [...insights.values()].sort((a, b) => {
      const byRegion = a.region.localeCompare(b.region);
      if (byRegion !== 0) return byRegion;
      const byCountry = a.country.localeCompare(b.country);
      if (byCountry !== 0) return byCountry;
      return a.hub.localeCompare(b.hub);
    });
    const normalized = rows.map((r) => ({
      'region':                 r.region,
      'country':                r.country,
      'hub':                    r.hub,
      'deliveries':             r.deliveries,
      'exceptions':             r.exceptions,
      'onTimeCount':            r.onTimeCount,
      'lateCount':              r.lateCount,
      'totalSubtotalUsdMinor':  r.totalSubtotalUsdMinor,
      'totalShippingUsdMinor':  r.totalShippingUsdMinor,
      'totalDistanceKm':        r.totalDistanceKm,
      'totalDelayHours':        r.totalDelayHours,
      'consentValid':           r.consentValid,
      'consentMissing':         r.consentMissing,
      'consentExpired':         r.consentExpired,
      'sizeTierEnvelope':       r.sizeTierEnvelope,
      'sizeTierSmall':          r.sizeTierSmall,
      'sizeTierMedium':         r.sizeTierMedium,
      'sizeTierLarge':          r.sizeTierLarge,
      'sizeTierFreight':        r.sizeTierFreight,
      'shipmentCount':          r.shipmentCount,
    }));
    return JSON.stringify(normalized);
  }
}

/**
 * CartographerResumableScenario: self-contained abort→cursor→resume verification.
 *
 * Uses `cartographerResumeDAG` (no reservoir) so abort fires mid-scatter, leaving
 * acked items in the checkpoint and un-pulled items un-acked.
 *
 *   Baseline — Full streaming pass over all RESUME_EVENT_COUNT items (no abort).
 *              Produces the reference InsightsFingerprint.
 *   Step A   — Interrupted run: abort after ABORT_AFTER_ITEMS aggregate-event
 *              completions; read durable cursor from checkpoint.
 *   Step B   — Resume: restore from firstState.snapshot() (carries accumulator +
 *              checkpoint) and supply the remainder via StreamChannel.resumable.
 *              Assert cursor > 0 and resumeResult.cursor === null (completed).
 *   Proof    — Compare InsightsFingerprint of resumed state to baseline fingerprint.
 *              Equal → exactly-once; unequal → throw with full diff.
 */
class CartographerResumableScenario {
  private constructor() { /* static-only */ }

  /** Register cartographerResumeBundle bundles onto a fresh ObservedCartographer. */
  static #buildResumeDispatcher(services: CartographerServices): ObservedCartographer {
    const d = new ObservedCartographer({});
    d.registerBundle(GeoSourceResolveDAG.build(services.ipGeolocator, services.addressGeocoder));
    d.registerBundle(orderEnrichmentBundle);
    d.registerBundle(gdprComplianceBundle);
    d.registerBundle(ingestSourceBundle);
    d.registerBundle(cartographerResumeBundle);
    return d;
  }

  static async run(
    _dispatcher: ObservedCartographer,
    services: CartographerServices,
    logger: ConsoleLogger,
    _eventCount: number,
  ): Promise<void> {
    logger.info('CartographerResumableScenario', 'run', `Starting streamed-resume verification (${RESUME_EVENT_COUNT} events, abort after ${ABORT_AFTER_ITEMS})`);

    // ── Baseline: full streaming pass (no abort) ─────────────────────────────
    // Runs the same producer + same event count through the same DAG without
    // interruption. Produces the reference accumulator for the exactly-once proof.
    const baselineDispatcher = CartographerResumableScenario.#buildResumeDispatcher(services);
    const baselineState = new CartographerState();
    baselineState.useStreamingSource = true;
    baselineState.eventCount = RESUME_EVENT_COUNT;
    baselineState.streamCount = RESUME_EVENT_COUNT;
    baselineState.sources = StreamChannel.resumable(
      EventStreamSource.resumableProducer(baselineState.eventConfig, RESUME_EVENT_COUNT),
      0,
    );
    await baselineDispatcher.execute('cartographer-resume', baselineState);
    const baselineFingerprint = InsightsFingerprint.of(baselineState.insights);
    logger.info('CartographerResumableScenario', 'baseline', `Baseline streamed run folded ${baselineState.insights.size} region(s).`);

    // ── Step A: Interrupted run ──────────────────────────────────────────────
    // AbortingCartographer fires abort after ABORT_AFTER_ITEMS aggregate-event
    // completions inside process-stream. cartographerResumeDAG has no reservoir,
    // so the ScatterWorkerPool checks abort between item pulls — giving cursor > 0.
    const interruptAc = new AbortController();
    const abortingDispatcher = new AbortingCartographer({}, interruptAc, ABORT_AFTER_ITEMS);
    abortingDispatcher.registerBundle(GeoSourceResolveDAG.build(services.ipGeolocator, services.addressGeocoder));
    abortingDispatcher.registerBundle(orderEnrichmentBundle);
    abortingDispatcher.registerBundle(gdprComplianceBundle);
    abortingDispatcher.registerBundle(ingestSourceBundle);
    abortingDispatcher.registerBundle(cartographerResumeBundle);

    const firstState = new CartographerState();
    firstState.useStreamingSource = true;
    firstState.eventCount = RESUME_EVENT_COUNT;
    firstState.streamCount = RESUME_EVENT_COUNT;

    let interruptedCursor: string | null = null;
    try {
      const interruptedResult = await abortingDispatcher.execute(
        'cartographer-resume', firstState, { 'signal': interruptAc.signal },
      );
      interruptedCursor = interruptedResult.cursor;
    } catch (err) {
      if (!(err instanceof DAGError && err.code === 'EXECUTION_ERROR')) throw err;
    }

    // Read the durable stream cursor from the interrupted checkpoint.
    const cursor = StreamCursor.resumeAfter(firstState, 'process-stream');
    logger.info(
      'CartographerResumableScenario', 'interrupted',
      `Interrupted after ${ABORT_AFTER_ITEMS} items. execution cursor='${String(interruptedCursor)}' stream cursor=${cursor}`,
    );

    process.stdout.write(`ASSERT cursor > 0: ${cursor > 0 ? 'PASS' : 'FAIL'} (cursor=${cursor})\n`);
    if (cursor === 0) {
      throw new Error('CartographerResumableScenario: cursor is 0 — checkpoint not preserved after abort');
    }

    // ── Step B: Resume ───────────────────────────────────────────────────────
    // Restore from the interrupted snapshot — this is the faithful cross-process
    // restart path: the partial insights accumulator AND the SCATTER_PROGRESS_KEY
    // checkpoint are both carried by CartographerState.restore(firstState.snapshot()).
    // Acked items (below the watermark) already contributed to state.insights and
    // are NOT replayed by the engine; the accumulator carry ensures their folds
    // survive. Un-acked items in the durable inbox are replayed by the engine.
    const resumeDispatcher = CartographerResumableScenario.#buildResumeDispatcher(services);

    const resumeState = CartographerState.restore(firstState.snapshot());
    resumeState.useStreamingSource = true;
    resumeState.eventCount = RESUME_EVENT_COUNT;
    resumeState.streamCount = RESUME_EVENT_COUNT;
    // Supply the remainder: producer skips [0, cursor) items already consumed.
    // On resume the engine skips the pre-phase and enters process-stream directly;
    // sources must be wired here rather than relying on the seed node.
    resumeState.sources = StreamChannel.resumable(
      EventStreamSource.resumableProducer(resumeState.eventConfig, RESUME_EVENT_COUNT),
      cursor,
    );

    const resumeResult = await resumeDispatcher.resume('cartographer-resume', resumeState, 'process-stream');

    logger.info(
      'CartographerResumableScenario', 'resume',
      `Resume complete. cursor=${String(resumeResult.cursor)} (expected null)`,
    );

    process.stdout.write(`ASSERT resume completed: ${resumeResult.cursor === null ? 'PASS' : 'FAIL'} (cursor=${String(resumeResult.cursor)})\n`);
    if (resumeResult.cursor !== null) {
      throw new Error(`CartographerResumableScenario: resume did not complete (cursor='${String(resumeResult.cursor)}')`);
    }

    // ── Exactly-once proof: compare resumed fingerprint to baseline ───────────
    // The fingerprint encodes ALL numeric fields for every region, sorted
    // deterministically. Equal → every acked fold was carried (not lost, not
    // double-counted); unequal → the accumulator carry is broken.
    const resumeFingerprint = InsightsFingerprint.of(resumeState.insights);
    const exactlyOnce = resumeFingerprint === baselineFingerprint;
    process.stdout.write(`ASSERT exactly-once (resume insights == baseline insights): ${exactlyOnce ? 'PASS' : 'FAIL'}\n`);
    if (!exactlyOnce) {
      throw new Error(
        `CartographerResumableScenario: exactly-once violated — resumed insights differ from baseline.\n` +
        `  baseline: ${baselineFingerprint}\n` +
        `  resumed:  ${resumeFingerprint}`,
      );
    }

    // ── Shipment-count cross-check ────────────────────────────────────────────
    // Grand total of shipmentCount across all regions must be identical between
    // the resumed run and the baseline (gross undercount / double-count guard).
    let baselineTotal = 0;
    for (const r of baselineState.insights.values()) baselineTotal += r.shipmentCount;
    let resumeTotal = 0;
    for (const r of resumeState.insights.values()) resumeTotal += r.shipmentCount;
    const countMatch = resumeTotal === baselineTotal;
    process.stdout.write(`ASSERT shipment-count (resume=${resumeTotal} == baseline=${baselineTotal}): ${countMatch ? 'PASS' : 'FAIL'}\n`);
    if (!countMatch) {
      throw new Error(
        `CartographerResumableScenario: shipment-count mismatch — resumed total (${resumeTotal}) != baseline (${baselineTotal})`,
      );
    }

    process.stdout.write('Streamed resume: COMPLETE. Exactly-once verified.\n');
  }
}
// #endregion cartographer-resumable-scenario

class CartographerCli {
  static async networkReachable(): Promise<boolean> {
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

  static fmtCoord(lat: number, lng: number): string {
    const ns = `${Math.abs(lat).toFixed(2)}${lat >= 0 ? 'N' : 'S'}`;
    const ew = `${Math.abs(lng).toFixed(2)}${lng >= 0 ? 'E' : 'W'}`;
    return `${ns} ${ew}`;
  }

  static printJourney(logger: ConsoleLogger, j: JourneyInsights): void {
    const km = Math.round(j.pathKm).toLocaleString('en-US');
    const elapsedH = Math.floor(j.elapsedHours);
    const elapsedM = Math.round((j.elapsedHours - elapsedH) * 60);
    logger.result(`${j.shipmentId}  (${j.scanCount} scans, ${j.timezones.length} timezone(s))`);
    for (const s of j.scans) {
      const time = s.localIso.slice(11, 16);
      const cum = `+${Math.round(s.legKm).toLocaleString('en-US')} km`;
      logger.result(
        `  ${time} ${s.utcOffset.padEnd(7)} ${s.status.padEnd(16)} ` +
        `${s.hub.slice(0, 18).padEnd(19)} ${CartographerCli.fmtCoord(s.lat, s.lng).padEnd(20)} ${cum}`,
      );
    }
    const tzCrossings = Math.max(0, j.offsets.length - 1);
    const jurisLabel = j.jurisdictions.length > 1 ? `${j.jurisdictions.join('→')}` : j.jurisdictions[0] ?? 'baseline';
    const otLabel = j.delivered ? (j.onTime ? 'on-time' : `late ${j.delayHours}h`) : `in transit (${j.lastStatus})`;
    logger.result(`  journey: ${km} km · ${elapsedH}h${String(elapsedM).padStart(2, '0')}m elapsed · ${tzCrossings} tz crossing(s) · jurisdiction ${jurisLabel} · ${otLabel}`);
  }

  /**
   * Error-analysis section: total captured-exception count and a table of
   * `source · variant · count · sample-message`, ordered by descending count so the
   * dominant error source is first. This is the DAG-flow error collection made
   * visible — every captured exception folded by the gather is reported here.
   */
  static printErrorAnalysis(logger: ConsoleLogger, rollup: ErrorRollupType): void {
    logger.result('=== (e) Error Analysis — captured exceptions folded through the DAG ===\n');
    if (rollup.total === 0) {
      logger.result('  No exceptions captured this run. (A clean run — zero swallowed faults.)\n');
      return;
    }
    logger.result(`  Total captured exceptions: ${rollup.total.toLocaleString('en-US')}\n`);

    const COL_SOURCE  = 18;
    const COL_VARIANT = 14;
    const COL_COUNT   = 8;
    const hdr =
      'Source'.padEnd(COL_SOURCE) +
      'Variant'.padEnd(COL_VARIANT) +
      'Count'.padStart(COL_COUNT) +
      '  Sample message';
    logger.result(`  ${hdr}`);
    logger.result(`  ${'-'.repeat(hdr.length + 24)}`);
    for (const group of ErrorRollup.ranked(rollup)) {
      const sample = group.samples[0] ?? '';
      logger.result(
        `  ${group.source.slice(0, COL_SOURCE - 1).padEnd(COL_SOURCE)}` +
        `${group.variant.slice(0, COL_VARIANT - 1).padEnd(COL_VARIANT)}` +
        `${String(group.count).padStart(COL_COUNT)}  ${sample}`,
      );
    }
    logger.result('');
  }

  static printRedaction(logger: ConsoleLogger, label: string, rec: EnrichedShipment): void {
    logger.result(`  [${label}] ${rec.shipmentId}  jurisdiction=${rec.jurisdiction}  consent=${rec.consentStatus}`);
    logger.result(`    Name:    ${rec.redactedSample.recipientName}`);
    logger.result(`    Email:   ${rec.redactedSample.recipientEmail}`);
    logger.result(`    Phone:   ${rec.redactedSample.recipientPhone}`);
    logger.result(`    Coords:  ${CartographerCli.fmtCoord(rec.lat, rec.lng)}  ${rec.coordsCoarsened ? '(COARSENED to grid centroid)' : '(precise)'}`);
  }
}

// ── Geo backend selection: LIVE IP if a network is reachable, else RECORDED ────
// GPS reverse-geocode is ALWAYS offline (the `@rapideditor/country-coder` boundary
// dataset — deterministic, no network) — only the IP modality is a live API call.
// `useLive` selects the live freeipapi.com IP geolocator when reachable; otherwise
// (and with `--recorded`) the recorded IP fixture replays for a deterministic,
// offline run. The probe targets freeipapi (the only live modality).

const useLive = !forceRecorded && (await CartographerCli.networkReachable());
const services: CartographerServices = useLive ? GeoResolvers.live() : GeoResolvers.recorded();

// ── Worker container (only when --workers / CARTO_WORKERS=1) ─────────────────
// WorkerThreadContainer is only imported when the worker path is active. In
// tsx mode (in-process default) this branch is never reached.
//
// The registry module URL is resolved relative to this compiled file's location
// (examples/the-cartographer/dist/runCartographer.js) so the path resolves to
// examples/the-cartographer/dist/workers/eventPipelineRegistry.js — the compiled
// output of workers/eventPipelineRegistry.ts.
//
// Workers receive servicesConfig.useRecordedIp so they select the same IP backend
// as the parent (recorded when offline/--recorded, live when the parent is live).
let workerContainer: { destroy(): Promise<void> } | null = null;

// ── Dispatcher ────────────────────────────────────────────────────────────────
// ObservedCartographer subclasses Dagonizer and wires every lifecycle hook to
// its internal ConsoleLogger — the sanctioned class-extension observability
// demonstration. Progress / status / diagnostic lines flow through the hooks;
// the final tabular report is routed through `dispatcher.logger.result(...)`.
let dispatcher: ObservedCartographer;

if (useWorkers) {
  // Dynamic import keeps WorkerThreadContainer out of the tsx bundle; workers
  // are only instantiated when the compiled path is active.
  const { WorkerThreadContainer } = await import('@studnicky/dagonizer-executor-node');
  const registryUrl = new URL('./workers/eventPipelineRegistry.js', import.meta.url).href;
  const container = new WorkerThreadContainer({
    'registryModule':  registryUrl,
    'registryVersion': '1.0.0',
    'servicesConfig':  { 'useRecordedIp': !useLive },
    'poolSize':        4,
  });
  workerContainer = container;

  // Workers mode: the cartographerWorkersDAG has container: 'cpu' on process-events.
  // The parent dispatcher still needs all bundles registered so the DAG validator
  // can resolve sub-DAG references (geo-resolve, canonicalize, etc. inside
  // event-pipeline). The nodes and sub-DAG bodies are only EXECUTED inside the
  // worker threads (the registry module reconstructs them per-worker); registering
  // them on the parent satisfies the validator without running them here.
  dispatcher = new ObservedCartographer({
    'containers': { 'cpu': container },
  });
  // Sub-DAG bundles (needed for DAG validator; execution stays in the workers).
  dispatcher.registerBundle(GeoSourceResolveDAG.build(services.ipGeolocator, services.addressGeocoder));
  dispatcher.registerBundle(orderEnrichmentBundle);
  dispatcher.registerBundle(gdprComplianceBundle);
  // ingestSourceBundle owns all unique ingest nodes + all format sub-DAGs.
  dispatcher.registerBundle(ingestSourceBundle);
  // Top-level DAG (cartographerWorkersDAG has container: 'cpu' on process-events).
  dispatcher.registerBundle(cartographerWorkersBundle);
} else {
  dispatcher = new ObservedCartographer({});
  dispatcher.registerBundle(GeoSourceResolveDAG.build(services.ipGeolocator, services.addressGeocoder));
  dispatcher.registerBundle(orderEnrichmentBundle);
  dispatcher.registerBundle(gdprComplianceBundle);
  // ingestSourceBundle owns all unique ingest nodes + all format sub-DAGs.
  dispatcher.registerBundle(ingestSourceBundle);
  dispatcher.registerBundle(cartographerBundle);
}

// The example's own logger, owned by the subclass. Display (the tabular report)
// goes through `logger.result(...)`; diagnostics flow from the hook overrides.
const logger = dispatcher.logger;

const state = new CartographerState();
state.eventCount = eventCount;
state.useStreamingSource = useStreaming;
state.streamCount = streamCount;

const executionMode = useWorkers
  ? 'WORKER THREADS (container: cpu, pool=4)'
  : useStreaming
    ? `IN-PROCESS + STREAMING SOURCE${streamCount > 0 ? ` (count=${streamCount})` : ''}`
    : 'IN-PROCESS (no container)';

// Run-configuration banner: status diagnostics → leveled info on the logger.
logger.info('runCartographer', 'banner', `${String(eventCount)} journeys -> multi-format sources -> fan-in -> streaming enrichment (concurrency=16)`);
logger.info('runCartographer', 'banner', `execution mode: ${executionMode}`);
logger.info('runCartographer', 'banner', `geo backend: offline country-coder reverse-geocode + ${useLive ? 'LIVE freeipapi.com IP geolocation' : 'RECORDED IP fixture replay (offline)'}`);

// ── Execute ───────────────────────────────────────────────────────────────────
const ac = new AbortController();
process.once('SIGINT', () => {
  logger.warn('runCartographer', 'onSigint', 'aborting pipeline');
  ac.abort();
});

let stageCount = 0;
let peakHeap = process.memoryUsage().heapUsed;
try {
  const execution = dispatcher.execute('cartographer', state, { 'signal': ac.signal });
  for await (const stage of execution) {
    const cur = process.memoryUsage().heapUsed;
    if (cur > peakHeap) peakHeap = cur;
    if (!stage.skipped) {
      stageCount++;
      // Periodic progress heartbeat — leveled diagnostic, not raw stdout.
      // Per-node detail flows from the subclass hooks (onNodeStart/onNodeEnd).
      if (stageCount % 80 === 0) {
        logger.trace('runCartographer', 'progress', `${String(stageCount)} stages executed`);
      }
    }
  }
  await execution;
} catch (err) {
  if (err instanceof DAGError && err.code === 'EXECUTION_ERROR') {
    logger.fatal('runCartographer', 'execute', `execution failed: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
logger.debug('runCartographer', 'execute', `pipeline drained: ${String(stageCount)} stages executed`);

// Bounded sample of enriched scans (cap 200). state.records is always empty
// in the streaming path (and in the insights-fold non-streaming path). All
// per-scan display sections iterate this sample — honest and memory-bounded.
const sampleProcessed = state.sampleRecords.filter((r) => r.shipmentId.length > 0);

// Total scans folded: exact sum from the insights accumulator (all scans,
// not sampled). The insights fold counts every event regardless of scatter
// concurrency, so this is authoritative.
let totalScans = 0;
for (const r of state.insights.values()) totalScans += r.shipmentCount;

// ── (0) Streaming source summary ──────────────────────────────────────────────
// The streaming topology decodes mixed formats inline per scan; there is no
// separate ingestion fan-in stage. Report what the accumulators know.
logger.result('=== (0) Streaming source — mixed formats decoded inline per scan ===\n');

// Per-event-type lane distribution derived from the bounded sample.
const byEventType = new Map<string, number>();
for (const r of sampleProcessed) {
  // The routing path encodes the event-type lane (e.g. "facility-scan/…").
  // Extract the first segment as a human-readable lane label.
  const lane = r.routing.path.split('/')[0] ?? r.routing.path;
  byEventType.set(lane, (byEventType.get(lane) ?? 0) + 1);
}

// Per-format distribution from the bounded sample routing path (the path
// encodes the lane name, not the wire format; use sampleRecords directly
// as a representative distribution indicator).
const distinctFormats = new Set<string>();
if (Array.isArray(state.sources)) {
  for (const item of state.sources) {
    distinctFormats.add(item.format);
  }
}
// Fall back to eventConfig format mix labels when sources is exhausted.
if (distinctFormats.size === 0) {
  for (const cfg of state.eventConfig) {
    for (const mix of cfg.formatMix) distinctFormats.add(mix.format);
  }
}

logger.result(`  Total scans folded (exact, from insights accumulator): ${totalScans.toLocaleString()}`);
logger.result(`  Continents resolved: ${state.insights.size}`);
logger.result(`  Wire formats in feed: ${distinctFormats.size > 0 ? [...distinctFormats].sort().join(', ') : 'mixed (json, csv, ndjson, yaml)'}`);
logger.result(`\n  Event-type lane distribution (from a representative sample of ${sampleProcessed.length} scans):`);
for (const lane of [...byEventType.keys()].sort()) {
  logger.result(`    ${lane.padEnd(28)} ${String(byEventType.get(lane) ?? 0).padStart(5)}`);
}
logger.result('');

// ── (e) Error analysis — the DAG-flow error collection made visible ───────────
// The geo transports and ingest parsers capture every caught exception into a
// GeoErrorRecord on state.errors; the insights-fold gather folds them into
// state.errorRollup (bounded, grouped by source+variant). Print the distribution.
CartographerCli.printErrorAnalysis(logger, state.errorRollup);

// ── (a) Normalization sample — a multi-zone, multi-scan journey ───────────────
// Prefer a journey that crosses >=2 timezones to show differing local offsets.
const multiZoneJourney =
  [...state.journeys.values()].find((j) => j.scanCount >= 3 && j.offsets.length >= 2)
  ?? [...state.journeys.values()].find((j) => j.scanCount >= 2 && j.offsets.length >= 2)
  ?? [...state.journeys.values()].find((j) => j.scanCount >= 2);

logger.result('=== (a) Normalization Sample — one journey, per-scan LOCAL time ===\n');
if (multiZoneJourney !== undefined) {
  logger.result(`${multiZoneJourney.shipmentId}  (${multiZoneJourney.scanCount} scans, ${multiZoneJourney.timezones.length} timezone(s), offsets: ${multiZoneJourney.offsets.join(', ')})`);
  for (const s of multiZoneJourney.scans) {
    const time = s.localIso.slice(11, 16);
    logger.result(
      `  seq ${s.scanSeq}  ${time} ${s.utcOffset.padEnd(7)} ${s.status.padEnd(16)} ` +
      `${s.hub.slice(0, 18).padEnd(19)} ${CartographerCli.fmtCoord(s.lat, s.lng).padEnd(20)} [${s.jurisdiction}]`,
    );
  }
}

// ── (b) Per-continent insights table ─────────────────────────────────────────
// Rolled up to the macro continent the real geo API resolved (~6–8 rows), plus a
// single maritime bucket — the precise locality/country stays on each journey scan.
logger.result('\n=== (b) Per-Continent Insights ===\n');

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
logger.result(hdr);
logger.result('-'.repeat(hdr.length));

const sortedRegions = [...state.insights.values()].sort((a, b) => a.region.localeCompare(b.region));
for (const r of sortedRegions) {
  const total = r.onTimeCount + r.lateCount;
  const onTimePct = total > 0 ? Math.round((r.onTimeCount / total) * 100) : 0;
  const revUsd  = (r.totalSubtotalUsdMinor / 100).toFixed(0);
  const shipUsd = (r.totalShippingUsdMinor / 100).toFixed(0);
  const distKm  = r.totalDistanceKm > 0 ? Math.round(r.totalDistanceKm / r.shipmentCount).toString() : '0';
  logger.result(
    r.region.slice(0, COL_REGION - 1).padEnd(COL_REGION) +
    String(r.shipmentCount).padStart(COL_COUNT) +
    String(r.exceptions).padStart(COL_EXC) +
    `${onTimePct}%`.padStart(COL_ONTIME) +
    `$${revUsd}`.padStart(COL_REV) +
    `$${shipUsd}`.padStart(COL_SHIP) +
    `${distKm}`.padStart(COL_DIST),
  );
}
logger.result(`\nTotal scans folded: ${totalScans.toLocaleString()} · Journeys sampled: ${state.journeys.size}`);

// ── (b2) SOURCE-MODEL ROUTING VIEW (the thesis made tangible — §B0.7c) ──────────
// Each clone records its own RAN/SKIPPED decisions on the enriched record; the
// gather appends each to sampleRecords (bounded FIFO, cap 200). The totals here
// are computed over that representative sample — honest because the sample is a
// cross-section of all event types and routing paths.
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
// Source-model tally
let modelCoords = 0, modelLocale = 0, modelCode = 0, modelIp = 0, modelNone = 0;
let coordsPlusIp = 0, fallbackFired = 0;
let ipgeoRun = 0, ipgeoSkip = 0;
let actualNodes = 0, naiveNodes = 0;
const pathCounts = new Map<string, number>();
for (const r of sampleProcessed) {
  const rt = r.routing;
  if (rt.geoLookupRun) geoRun++;
  if (rt.geoLookupSkipped) geoSkip++;
  if (rt.ipGeolocateRun) ipgeoRun++;
  if (rt.ipGeolocateSkipped) ipgeoSkip++;
  if (rt.redactionRun) redRun++;
  if (rt.redactionSkipped) redSkip++;
  if (rt.pricingSkipped) priceSkip++;
  if (rt.etaSkipped) etaSkip++;
  if (rt.coldChainRun) coldRun++;
  if (rt.customsDwellRun) customsRun++;
  // Source-model tally
  if (rt.geoSourceModel === 'coords') modelCoords++;
  else if (rt.geoSourceModel === 'locale') modelLocale++;
  else if (rt.geoSourceModel === 'code') modelCode++;
  else if (rt.geoSourceModel === 'ip') modelIp++;
  else modelNone++;
  if (rt.geoModalities.includes('ip') && (rt.geoModalities.includes('coords') || rt.geoModalities.includes('geohash'))) coordsPlusIp++;
  if (rt.geoFallbackUsed) fallbackFired++;
  pathCounts.set(rt.path, (pathCounts.get(rt.path) ?? 0) + 1);

  naiveNodes += GEO_CHAIN_NODES + ORDER_ENRICH_NODES + REDACTION_NODES;
  actualNodes += rt.geoLookupRun ? GEO_CHAIN_NODES : GEO_SKIP_ADAPTER;
  if (rt.pricingRun) actualNodes += ORDER_ENRICH_NODES;
  actualNodes += rt.redactionRun ? REDACTION_NODES : REDACTION_SKIP_ADAPTER;
}
const sampleTotal = sampleProcessed.length;
class Percent {
  private constructor() { /* static-only */ }
  static of(n: number, base: number): string { return base > 0 ? `${Math.round((n / base) * 100)}%` : '0%'; }
}
const skippedNodes = naiveNodes - actualNodes;
const redactionPassesAvoided = redSkip;
const pricingEtaAvoided = priceSkip * ORDER_ENRICH_NODES;

logger.result('\n=== (b2) Source-Model Routing — from a bounded sample of recent scans ===\n');
logger.result(`  Sample size: ${sampleTotal} scans (representative bounded FIFO, cap 200)\n`);
logger.result(`  HEADLINE: deterministic routing skipped ${skippedNodes.toLocaleString('en-US')} node-executions in sample ` +
  `(~${Percent.of(skippedNodes, naiveNodes)} of the ${naiveNodes.toLocaleString('en-US')} always-run maximum).\n`);
logger.result('  Geo source-model distribution (from classify-geo-source):');
logger.result(`    • coords (lat/lng present):       ${String(modelCoords).padStart(5)}`);
logger.result(`    • code  (ISO-2 country code):     ${String(modelCode).padStart(5)}`);
logger.result(`    • locale (BCP-47 tag):            ${String(modelLocale).padStart(5)}`);
logger.result(`    • ip   (gateway IP only):         ${String(modelIp).padStart(5)}`);
logger.result(`    • none (no signal):               ${String(modelNone).padStart(5)}`);
logger.result('');
logger.result(`  coords+IP enriched (dual modality): ${coordsPlusIp}`);
logger.result(`  CoordTimezone fallback fired:        ${fallbackFired}`);
logger.result('');
logger.result(`  geo-lookup:  RAN ${geoRun}  ·  SKIPPED ${geoSkip} (${Percent.of(geoSkip, sampleTotal)} — source already resolved → geo sub-DAG avoided)`);
logger.result(`  ip-geolocate (freeipapi.com): RAN ${ipgeoRun}  ·  SKIPPED ${ipgeoSkip}`);
logger.result(`  redaction:   RAN ${redRun}  ·  SKIPPED ${redSkip} (${Percent.of(redSkip, sampleTotal)} — no PII / not required → redaction sub-DAG bypassed)`);
logger.result(`  pricing+eta: RAN ${sampleTotal - priceSkip}  ·  SKIPPED ${priceSkip} (${Percent.of(priceSkip, sampleTotal)} — non-order event types carry no basket/delivery)`);
logger.result(`  per-event-type lanes: ${[...pathCounts.entries()].sort().map(([p, n]) => `${p}=${n}`).join('  ')}`);
logger.result(`  cold-chain-check RAN ${coldRun} (sensor lane only) · customs-dwell RAN ${customsRun} (customs lane only)`);
logger.result('\n  Compute avoided in sample:');
logger.result(`    • ${redactionPassesAvoided.toLocaleString('en-US')} redaction passes avoided`);
logger.result(`    • ${pricingEtaAvoided.toLocaleString('en-US')} pricing/shipping/ETA node-executions avoided — don't price a position ping.`);

// ── (c) Per-journey summaries (a few) ─────────────────────────────────────────
logger.result('\n=== (c) Per-Journey Summaries ===\n');
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
  CartographerCli.printJourney(logger, j);
  logger.result('');
}

const tzCrossingJourneys = [...state.journeys.values()].filter((j) => j.offsets.length >= 2).length;
const jurisChangeJourneys = [...state.journeys.values()].filter((j) => j.jurisdictions.length >= 2).length;
logger.result(`Journeys crossing >=2 timezones: ${tzCrossingJourneys}`);
logger.result(`Journeys changing jurisdiction mid-path: ${jurisChangeJourneys}`);

// ── (d) Location-driven redaction comparison ──────────────────────────────────
// Drawn from the bounded sample (cap 200) — sufficient to find representative
// strict-jurisdiction and baseline records.
const strictRecord = sampleProcessed.find(
  (r) => r.coordsCoarsened && (r.jurisdiction === 'GDPR' || r.jurisdiction === 'UK-GDPR' || r.jurisdiction === 'LGPD'),
) ?? sampleProcessed.find((r) => r.coordsCoarsened);
const baselineRecord = sampleProcessed.find(
  (r) => !r.coordsCoarsened && r.jurisdiction === 'baseline' && r.consentStatus === 'valid',
) ?? sampleProcessed.find((r) => !r.coordsCoarsened);

logger.result('\n=== (d) Location-Driven Redaction (strict vs baseline) ===\n');
if (strictRecord !== undefined) CartographerCli.printRedaction(logger, 'strict', strictRecord);
if (baselineRecord !== undefined) {
  logger.result('');
  CartographerCli.printRedaction(logger, 'baseline', baselineRecord);
}

logger.result(`\nDone. ${state.insights.size} continent(s), ${state.journeys.size} journey(s). No Date.now. No Math.random.`);
logger.result(`Peak heap: ${Math.round(peakHeap / 1048576)} MB · scans folded: ${totalScans.toLocaleString()} · journeys sampled: ${state.journeys.size} · sampleRecords: ${state.sampleRecords.length}`);
logger.result(`Execution mode: ${executionMode}\n`);

// ── Streamed resume verification (--stream only) ──────────────────────────────
// Runs the three-phase abort→cursor→resume scenario to verify exactly-once
// delivery across a genuine interrupt. Only runs when --stream is passed so it
// does not add latency to the default in-process array path.
if (useStreaming) {
  await CartographerResumableScenario.run(dispatcher, services, logger, eventCount);
}

// Release the worker pool so the process exits cleanly.
if (workerContainer !== null) {
  await workerContainer.destroy();
}
// #endregion run-cartographer
