/**
 * CartographerState: the mutable clipboard threaded through every node.
 *
 * Top-level (cartographer DAG):
 *   - `sourceFeed`      – producer-local stream opened by one feed node
 *   - `canonicalEvents` – open-gather result consumed by process-stream
 *   - `sources`         – source-intake helper output used by compatibility flows
 *   - `eventCount`  – display/run scale hint for host tooling
 *   - `records`     – gathered from scatter clones via the 'append' gather strategy
 *   - `insights`    – fixed-size regional aggregate produced by summarizeInsights
 *
 * Clone (shipment-pipeline sub-DAG, one per event):
 *   - `raw`              – the RawShipmentEvent parsed from scatter metadata
 *   - `normalized`       – canonical form produced by the normalize node
 *   - `currentEvent`     – ShipmentEvent-shaped view used by geo and GDPR nodes
 *   - `geoContext`       – result of geo-grid + geo-context nodes
 *   - `pricedOrder`      – basket pricing with FX normalisation
 *   - `shippingQuote`    – haversine distance + carrier rate
 *   - `deliveryEstimate` – transit time, ETA, on-time flag
 *   - `gdprResult`       – result of the gdpr-compliance embedded DAG
 *   - `enriched`         – compact EnrichedShipment written by aggregate-event;
 *                          the parent gather appends this to state.records
 *
 * Checkpoint/resume: snapshotData/restoreData round-trip durable state only.
 * Durable: eventCount, eventConfig, useStreamingSource, streamCount,
 * ingestBuckets, canonicalEvents, records, sampleRecords, enriched, insights,
 * journeyAccumulators, errorRollup.
 * Per-event scratch (sourceFeed, currentSource, decodedText, parsedRecords,
 * mappedRecords, ingestedEvents, canonical, canonicalVariant, raw, normalized,
 * currentEvent, geoContext, pricedOrder, shippingQuote, deliveryEstimate, legKm,
 * coldChainBreach, customsDwellHours,
 * ipCandidate, routing, gdprResult, resolvedGeo) is never serialized; workers
 * recompute it from the source-payload metadata on each dispatch.
 * AsyncIterable feed fields are not checkpointable. Resume restores
 * canonicalEvents and relies on the scatter checkpoint for exactly-once
 * process-stream continuation.
 * The scatter durable-inbox handles exactly-once delivery; un-acked items are
 * reprocessed from the inbox, not re-read from source.
 */

import { CanonicalEventVariantBuilder } from './entities/CanonicalEvent.ts';
import type { CanonicalEventVariant } from './entities/CanonicalEvent.ts';
import type { PositionPingEvent } from './entities/events/PositionPingEvent.ts';
import type { FacilityScanEvent } from './entities/events/FacilityScanEvent.ts';
import type { SensorReadingEvent } from './entities/events/SensorReadingEvent.ts';
import type { CustomsEvent } from './entities/events/CustomsEvent.ts';
import type { DeliveryConfirmationEvent } from './entities/events/DeliveryConfirmationEvent.ts';
import type { GeoCandidate } from './entities/GeoCandidate.ts';
import type { ResolvedGeo } from './entities/ResolvedGeo.ts';
import { type GeoSignal, DEFAULT_GEO_SIGNAL } from './entities/GeoSignal.ts';
import { type GeoResolution, DEFAULT_GEO_RESOLUTION } from './entities/GeoResolution.ts';
import type { GeoSignalDescriptor } from './entities/GeoSignalDescriptor.ts';
import type { DeliveryEstimate } from './entities/DeliveryEstimate.ts';
import type { EnrichedShipment } from './entities/EnrichedShipment.ts';
import type { GdprResult } from './entities/GdprResult.ts';
import type { GeoContext } from './entities/GeoContext.ts';
import type { NormalizedShipment } from './entities/NormalizedShipment.ts';
import type { PricedOrder } from './entities/PricedOrder.ts';
import type { RawShipmentEvent } from './entities/RawShipmentEvent.ts';
import type { ShipmentEvent } from './entities/ShipmentEvent.ts';
import type { ShippingQuote } from './entities/ShippingQuote.ts';
import type { SourcePayload } from './entities/SourcePayload.ts';
import type { EventTypeConfig } from './services.ts';
import type { GeoErrorRecordType } from './errors/GeoErrorRecord.ts';
import { ErrorRollup, type ErrorGroupType, type ErrorRollupType } from './errors/ErrorRollup.ts';
import type { JourneyAccumulator } from './core/InsightsFoldGather.ts';

import { NodeStateBase } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/types';

/** Per-region aggregated insights (fixed-size accumulator). */
export interface RegionInsights {
  readonly region: string;
  readonly country: string;
  readonly hub: string;
  deliveries: number;
  exceptions: number;
  onTimeCount: number;
  lateCount: number;
  totalSubtotalUsdMinor: number;
  totalShippingUsdMinor: number;
  totalDistanceKm: number;
  totalDelayHours: number;
  consentValid: number;
  consentMissing: number;
  consentExpired: number;
  sizeTierEnvelope: number;
  sizeTierSmall: number;
  sizeTierMedium: number;
  sizeTierLarge: number;
  sizeTierFreight: number;
  shipmentCount: number;
}

/** One scan within a reconstructed journey (ordered by epoch). */
export interface JourneyScan {
  readonly scanSeq: number;
  readonly epochMs: number;
  readonly localIso: string;
  readonly utcOffset: string;
  readonly timezone: string;
  readonly jurisdiction: string;
  readonly status: string;
  readonly hub: string;
  readonly region: string;
  readonly country: string;
  readonly lat: number;
  readonly lng: number;
  readonly legKm: number;
  readonly disruptionReason: string;
}

/** Per-journey aggregate (grouped by shipmentId, ordered by epoch). */
export interface JourneyInsights {
  readonly shipmentId: string;
  scans: JourneyScan[];
  scanCount: number;
  pathKm: number;
  firstEpochMs: number;
  lastEpochMs: number;
  elapsedHours: number;
  timezones: string[];
  offsets: string[];
  jurisdictions: string[];
  statusProgression: string[];
  lastStatus: string;
  lastHub: string;
  delivered: boolean;
  onTime: boolean;
  delayHours: number;
  subtotalUsdMinor: number;
  shippingUsdMinor: number;
}

// #region cartographer-state
export class CartographerState extends NodeStateBase {
  /** Number of synthetic journeys to generate; part of the checkpoint/resume serialized state. */
  eventCount: number = 200;

  /**
   * Per-event-type feed configuration driving buildTypedFeed / streamTyped. Each
   * entry generates entry.count typed scans of its eventType, encoded across the
   * formats in its formatMix.
   */
  eventConfig: EventTypeConfig = [
    { 'eventType': 'position-ping',         'count': 6, 'formatMix': [{ 'format': 'json',   'compression': 'none', 'weight': 2 }, { 'format': 'yaml', 'compression': 'gzip', 'weight': 1 }] },
    { 'eventType': 'facility-scan',         'count': 5, 'formatMix': [{ 'format': 'csv',    'compression': 'none', 'weight': 2 }, { 'format': 'json', 'compression': 'gzip', 'weight': 1 }] },
    { 'eventType': 'sensor-reading',        'count': 4, 'formatMix': [{ 'format': 'ndjson', 'compression': 'gzip', 'weight': 2 }, { 'format': 'ndjson', 'compression': 'none', 'weight': 1 }] },
    { 'eventType': 'customs-event',         'count': 3, 'formatMix': [{ 'format': 'json',   'compression': 'none', 'weight': 2 }, { 'format': 'csv',  'compression': 'none', 'weight': 1 }] },
    { 'eventType': 'delivery-confirmation', 'count': 3, 'formatMix': [{ 'format': 'json',   'compression': 'none', 'weight': 2 }, { 'format': 'csv',  'compression': 'gzip', 'weight': 1 }] },
  ];

  /**
   * When true, host tooling reports the Cartographer run as streaming. The feed
   * DAGs always open lazy producer streams; this flag remains a UI/CLI display
   * knob.
   */
  useStreamingSource: boolean = false;

  /**
   * Override for the total source-payload count. When > 0, producer feed nodes
   * scale eventConfig before opening their per-type streams.
   */
  streamCount: number = 0;

  /**
   * Reserved stream-channel capacity knob for compatibility source helpers.
   * The current producer feed DAGs use pull-based AsyncIterable streams.
   */
  streamChannelCapacity: number = 0;

  /**
   * Producer-local source stream emitted by one concrete feed node. The owning
   * producer feed DAG scatters this stream through ingest-source, then emits the
   * resulting canonicalEvents array to the top-level open gather.
   */
  sourceFeed: SourcePayload[] | AsyncIterable<SourcePayload> = [];

  /**
   * Compatibility source stream assembled by SourceIntakeGather. Each item is a
   * `{ sourceId, format, mappingKey, eventType, payload }` — a different on-the-wire
   * encoding (JSON / CSV / gzip NDJSON) of a typed scan from the event feed.
   *
   * Snapshot/restore serialises the array path only. The current Cartographer
   * DAG reads canonicalEvents after the producer feed DAGs converge.
   */
  sources: SourcePayload[] | AsyncIterable<SourcePayload> = [];

  /**
   * Ingestion fan-in buckets: the `append` gather of the ingestion scatter
   * appends each source clone's `ingestedEvents` array as one element here, so
   * this is one bucket per source. The `merge-events` node flattens it into the
   * unified `canonicalEvents` collection.
   */
  ingestBuckets: CanonicalEventVariant[][] = [];

  /**
   * The unified canonical event collection. Every source's decoded events are
   * flattened into this one array (from `ingestBuckets`); the enrichment scatter
   * then reads it.
   */
  canonicalEvents: CanonicalEventVariant[] = [];

  // ── Per-source ingest slots (used inside a source's ingest sub-DAG clone) ──
  /** The source payload currently being ingested from the producer feed scatter. */
  currentSource: SourcePayload = {
    'sourceId':     '',
    'format':       'json',
    'compression':  'none',
    'mappingKey':   'json-position',
    'eventType':    'position-ping',
    'payload':      '',
  };

  /** Decompressed/raw text of the current source (after `decompress`). */
  decodedText: string = '';

  /** Records parsed from the decoded text (after parse-csv/json/ndjson). */
  parsedRecords: Array<Record<string, unknown>> = [];

  /** Records with source field names mapped to canonical fields (after map-fields). */
  mappedRecords: Array<Record<string, unknown>> = [];

  /** Canonical events validated from this source (after coerce-types + validate-event). */
  ingestedEvents: CanonicalEventVariant[] = [];

  /** The single canonical event (geo/consent mirror) under enrichment in a scatter clone; set/updated by parseVariant. */
  canonical: CanonicalEventVariant = CanonicalEventVariantBuilder.from({});

  /** The discriminated per-type variant under enrichment (typed path; set by parseVariant). The old fat path uses `canonical`. */
  canonicalVariant: CanonicalEventVariant = CanonicalEventVariantBuilder.from({});

  /** Enriched shipment records gathered from scatter clones. */
  records: EnrichedShipment[] = [];

  /**
   * Bounded FIFO sample of enriched scans (cap 200) produced by the
   * insights-fold gather strategy. The gather writes to this field
   * incrementally as scatter clones complete; memory does not grow
   * with event count. In the streaming path state.records stays empty;
   * this field holds the representative sample the UI consumes.
   */
  sampleRecords: EnrichedShipment[] = [];

  /** Fixed-size regional insights aggregate produced by summarizeInsights. */
  insights: Map<string, RegionInsights> = new Map();

  /** Per-journey aggregate (grouped by shipmentId) produced by summarizeInsights. */
  journeys: Map<string, JourneyInsights> = new Map();

  /**
   * In-progress per-journey accumulator map, maintained by the insights-fold gather strategy.
   * Part of durable checkpoint state so accumulations survive process restart on resume.
   */
  journeyAccumulators: Map<string, JourneyAccumulator> = new Map();

  /**
   * Parent-side bounded rollup of captured exceptions, folded by the
   * insights-fold gather from each clone's `state.capturedErrors`. Errors flow
   * scatter→gather as first-class data; the run prints this distribution for
   * analysis. Reset per execution by the gather's `initial`.
   */
  errorRollup: ErrorRollupType = ErrorRollup.empty();

  /** Raw scan from scatter metadata (set by parseEvent). */
  raw: RawShipmentEvent = {
    'shipmentId':          '',
    'scanSeq':             0,
    'rawTimestamp':        '',
    'rawDispatchAt':       '',
    'rawStatus':           '',
    'carrier':             '',
    'ipAddress':           '',
    'localeTag':           '',
    'countryCode':         '',
    'latitude':            0,
    'longitude':           0,
    'legFromLat':          0,
    'legFromLng':          0,
    'originLat':           0,
    'originLng':           0,
    'destLat':             0,
    'destLng':             0,
    'weight':              0,
    'weightUnit':          'kg',
    'recipientName':       '',
    'recipientEmail':      '',
    'recipientPhone':      '',
    'recipientAddress':    '',
    'recipientCountry':    '',
    'marketingConsent':    false,
    'rawPromisedDeliveryAt': '',
    'lineItems':           [{ 'productId': '', 'quantity': 1 }],
    'facilityId':          '',
    'lawfulBasis':         'contract',
    'specialCategory':     'none',
    'disruptionReason':    '',
  };

  /** Normalised canonical form (set by normalize node). */
  normalized: NormalizedShipment = {
    'shipmentId':       '',
    'scanSeq':          0,
    'epochMs':          0,
    'dispatchEpochMs':  0,
    'isoTimestamp':     '',
    'localIso':         '',
    'utcOffset':        '',
    'carrierId':        '',
    'carrierName':      '',
    'countryIso3':      'UNK',
    'weightGrams':      0,
    'status':           'SCAN',
    'serviceTier':      'standard',
    'sizeTier':         'small',
    'lineItems':        [{ 'productId': '', 'quantity': 1 }],
    'facilityId':       '',
    'latitude':         0,
    'longitude':        0,
    'legFromLat':       0,
    'legFromLng':       0,
    'originLat':        0,
    'originLng':        0,
    'destLat':          0,
    'destLng':          0,
    'recipientName':    '',
    'recipientEmail':   '',
    'recipientPhone':   '',
    'recipientAddress': '',
    'recipientCountry': '',
    'marketingConsent': false,
    'promisedEpochMs':  0,
    'disruptionHours':  0,
    'disruptionReason': '',
  };

  /**
   * ShipmentEvent-shaped current event used by geo and GDPR nodes.
   * Populated from normalized by the classify node.
   */
  currentEvent: ShipmentEvent = {
    'shipmentId':        '',
    'timestamp':         '',
    'eventType':         'SCAN',
    'latitude':          0,
    'longitude':         0,
    'carrier':           '',
    'facilityId':        '',
    'recipientName':     '',
    'recipientEmail':    '',
    'recipientPhone':    '',
    'recipientAddress':  '',
    'recipientCountry':  '',
    'marketingConsent':  false,
    'promisedDeliveryAt': '',
  };

  /** Geo-enrichment result for the current scan (incl. timezone + jurisdiction). */
  geoContext: GeoContext = {
    'gridZone':     '',
    'country':      '',
    'continent':    'Unmapped',
    'countries':    [],
    'region':       '',
    'hub':          '',
    'status':       'unmapped',
    'waterBodies':  [],
    'timezone':     'UTC',
    'jurisdiction': 'baseline',
  };

  /** Basket pricing result (set by enrich-pricing node). */
  pricedOrder: PricedOrder = {
    'lines':            [],
    'subtotalMinor':    0,
    'currency':         'USD',
    'subtotalUsdMinor': 0,
    'fxRate':           1.0,
  };

  /** Shipping cost + distance (set by enrich-shipping node). */
  shippingQuote: ShippingQuote = {
    'distanceKm':   0,
    'costUsdMinor': 0,
    'breakdown': {
      'baseMinor':      0,
      'perKmMinor':     0,
      'perKgMinor':     0,
      'tierMultiplier': 1.0,
    },
  };

  /** ETA calculation (set by enrich-eta node). */
  deliveryEstimate: DeliveryEstimate = {
    'transitHours':    0,
    'etaEpochMs':      0,
    'etaIso':          '',
    'promisedEpochMs': 0,
    'onTime':          false,
    'delayHours':      0,
  };

  /** Leg distance (legFrom → this scan) in km, set by enrich-leg node. */
  legKm: number = 0;

  /** Cold-chain breach flag (sensor lane only; set by cold-chain-check). */
  coldChainBreach: boolean = false;

  /** Customs clearance dwell hours (customs lane only; set by customs-dwell). */
  customsDwellHours: number = 0;

  /**
   * This scan's conditional-routing decisions (the branching headline). Each
   * routing node records what RAN vs was SKIPPED here; aggregate-event copies it
   * onto the enriched record so the parent's summarize totals the savings (no
   * shared mutable counters across scatter clones).
   */
  routing: EnrichedShipment['routing'] = CartographerState.defaultRouting();

  /**
   * Ephemeral per-clone accumulator of captured exceptions (like ipCandidate:
   * non-serialized, recomputed each dispatch). The geo / ingest nodes append a
   * `GeoErrorRecordType` here whenever their transport reports a captured error;
   * the gather folds these into the parent's `errorRollup`. The node still
   * routes its normal output — the error rides alongside as data.
   *
   * Named `capturedErrors` (not `errors`) to stay distinct from the framework
   * `NodeStateInterface.errors` channel — these are the example's own captured
   * geo/ingest faults, a different concern.
   */
  capturedErrors: readonly GeoErrorRecordType[] = [];

  /** IP-modality candidate from ip-geolocate (unresolved when that node skipped). */
  ipCandidate: GeoCandidate = CartographerState.unresolvedCandidate('ip');

  /** The fused multi-modal location (set by fuse-source-geo). */
  resolvedGeo: ResolvedGeo = {
    'country':      '',
    'countryName':  '',
    'continent':    'Unmapped',
    'region':       '',
    'locality':     '',
    'locale':       '',
    'lat':          0,
    'lng':          0,
    'status':       'land',
    'jurisdiction': 'baseline',
    'confidence':   0,
    'modalities':   [],
    'provenance':   [],
  };

  /** Source-model routing signal built by classify-geo-source (which path to take). */
  geoSignal: GeoSignal = { ...DEFAULT_GEO_SIGNAL };

  /** Resolved geo from the selected source-model path (set by the source-resolve nodes). */
  geoResolution: GeoResolution = { ...DEFAULT_GEO_RESOLUTION };

  /** Scored geo signals for the scatter-gather resolution path (Wave 1+). */
  geoSignals: GeoSignalDescriptor[] = [];

  /** Current best candidate resolution (Wave 1+). */
  candidate: GeoResolution = { ...DEFAULT_GEO_RESOLUTION };

  /** All scored resolution candidates (Wave 1+). */
  geoCandidates: GeoResolution[] = [];

  /** GDPR processing result for the current scan (location + consent driven). */
  gdprResult: GdprResult = {
    'personalDataFields':  [],
    'sensitiveDataFields': [],
    'consentStatus':       'missing',
    'lawfulBasis':         'contract',
    'jurisdiction':        'baseline',
    'strictness':          'light',
    'complianceScore':     0,
    'retention': { 'retainUntil': '', 'autoDelete': false },
    'redactionApplied':    false,
    'marketingAnalyticsEligible': false,
    'coordsCoarsened':     false,
  };

  /** Compact enriched per-scan record written by aggregate-event; parent gather appends it. */
  enriched: EnrichedShipment = {
    'shipmentId':       '',
    'scanSeq':          0,
    'epochMs':          0,
    'localIso':         '',
    'utcOffset':        '',
    'timezone':         'UTC',
    'jurisdiction':     'baseline',
    'continent':        'Unmapped',
    'region':           '',
    'country':          '',
    'hub':              '',
    'geoStatus':        'unmapped',
    'lat':              0,
    'lng':              0,
    'coordsCoarsened':  false,
    'legKm':            0,
    'status':           'SCAN',
    'serviceTier':      'standard',
    'sizeTier':         'small',
    'onTime':           false,
    'exception':        false,
    'consentStatus':    'missing',
    'disruptionReason': '',
    'subtotalUsdMinor': 0,
    'currency':         'USD',
    'shippingUsdMinor': 0,
    'distanceKm':       0,
    'transitHours':     0,
    'delayHours':       0,
    'redactionApplied': false,
    'redactedSample': { 'recipientName': '', 'recipientEmail': '', 'recipientPhone': '' },
    'routing': CartographerState.defaultRouting(),
  };

  // #region clone
  override clone(): this {
    const copy = super.clone(); // new Constructor() + _metadata copy from base
    copy.eventCount = this.eventCount;
    copy.eventConfig = this.eventConfig.map((e) => ({ 'eventType': e.eventType, 'count': e.count, 'formatMix': e.formatMix.map((m) => ({ ...m })) }));
    if (Array.isArray(this.sources)) {
      copy.sources = this.sources.map((s) => ({ ...s }));
    } else {
      // AsyncIterable — shared by reference
      copy.sources = this.sources;
    }
    if (Array.isArray(this.sourceFeed)) {
      copy.sourceFeed = this.sourceFeed.map((s) => ({ ...s }));
    } else {
      copy.sourceFeed = this.sourceFeed;
    }
    copy.useStreamingSource = this.useStreamingSource;
    copy.streamCount = this.streamCount;
    copy.streamChannelCapacity = this.streamChannelCapacity;
    // Parent-level accumulators: reset to defaults in child clones.
    //
    // ingestBuckets, canonicalEvents, records, sampleRecords, insights, and
    // journeys are scatter-gather accumulators written by the parent DAG's
    // gather strategy (InsightsFoldGather) or by post-scatter summary nodes.
    // Scatter body clones (event-pipeline-typed, ingestion) never read these
    // fields — they only read the item placed on metadata by the engine. Copying them
    // into clones would send up to 200 EnrichedShipment JSON objects per clone
    // over the worker channel (60 KB × 16,000 in-flight clones = ~960 MB at
    // concurrencyLimit=16 / capacity=1000), producing the O(peak-concurrency)
    // heap spike. Resetting to defaults eliminates that overhead with no loss
    // of correctness: the child never reads them, and the parent retains its
    // own live copies.
    copy.ingestBuckets          = [];
    copy.canonicalEvents        = [];
    copy.records                = [];
    copy.sampleRecords          = [];
    copy.insights               = new Map();
    copy.journeys               = new Map();
    copy.journeyAccumulators    = new Map();
    copy.errorRollup            = ErrorRollup.empty();

    copy.currentSource  = { ...this.currentSource };
    copy.decodedText    = this.decodedText;
    copy.parsedRecords  = this.parsedRecords.map((r) => ({ ...r }));
    copy.mappedRecords  = this.mappedRecords.map((r) => ({ ...r }));
    copy.ingestedEvents = this.ingestedEvents.map((e) => CartographerState.cloneVariant(e));
    copy.canonical        = CartographerState.cloneVariant(this.canonical);
    copy.canonicalVariant = CartographerState.cloneVariant(this.canonicalVariant);

    copy.raw = {
      ...this.raw,
      'lineItems': this.raw.lineItems.map((li) => ({ ...li })),
    };

    copy.normalized = {
      ...this.normalized,
      'lineItems': this.normalized.lineItems.map((li) => ({ ...li })),
    };

    copy.currentEvent = { ...this.currentEvent };

    copy.geoContext = {
      ...this.geoContext,
      'countries':   [...this.geoContext.countries],
      'waterBodies': [...this.geoContext.waterBodies],
    };

    copy.pricedOrder = {
      ...this.pricedOrder,
      'lines': this.pricedOrder.lines.map((l) => ({ ...l })),
    };

    copy.shippingQuote = {
      ...this.shippingQuote,
      'breakdown': { ...this.shippingQuote.breakdown },
    };

    copy.deliveryEstimate = { ...this.deliveryEstimate };

    copy.legKm = this.legKm;
    copy.coldChainBreach = this.coldChainBreach;
    copy.customsDwellHours = this.customsDwellHours;

    copy.capturedErrors = this.capturedErrors.map((e) => ({ ...e }));
    copy.ipCandidate  = { ...this.ipCandidate };
    copy.resolvedGeo  = { ...this.resolvedGeo, 'modalities': [...this.resolvedGeo.modalities], 'provenance': [...this.resolvedGeo.provenance] };
    copy.geoSignal    = { ...this.geoSignal };
    copy.geoResolution = { ...this.geoResolution };
    copy.geoSignals    = this.geoSignals.map((s) => ({ ...s }));
    copy.candidate     = { ...this.candidate };
    copy.geoCandidates = this.geoCandidates.map((c) => ({ ...c }));

    copy.routing = { ...this.routing, 'geoModalities': [...this.routing.geoModalities] };

    copy.gdprResult = {
      ...this.gdprResult,
      'personalDataFields':  [...this.gdprResult.personalDataFields],
      'sensitiveDataFields': [...this.gdprResult.sensitiveDataFields],
      'retention': { ...this.gdprResult.retention },
    };

    copy.enriched = {
      ...this.enriched,
      'redactedSample': { ...this.enriched.redactedSample },
    };

    return copy;
  }
  // #endregion clone

  // #region snapshot-restore
  protected override snapshotData(): JsonObjectType {
    return {
      'eventCount': this.eventCount,
      'eventConfig': this.eventConfig.map((e) => ({ 'eventType': e.eventType, 'count': e.count, 'formatMix': e.formatMix.map((m) => ({ 'format': m.format, 'compression': m.compression, 'weight': m.weight })) })),
      // AsyncIterable sources are not checkpointable. Snapshot as an empty array
      // so restoreData leaves the compatibility source stream empty.
      'sources':    Array.isArray(this.sources)
        ? this.sources.map((s) => CartographerState.sourceToJson(s))
        : [],
      'useStreamingSource': this.useStreamingSource,
      'streamCount': this.streamCount,
      'streamChannelCapacity': this.streamChannelCapacity,
      'ingestBuckets': this.ingestBuckets.map((bucket) => bucket.map((e) => CartographerState.variantToJson(e))),
      'canonicalEvents': this.canonicalEvents.map((e) => CartographerState.variantToJson(e)),
      'records':      this.records.map((r) => CartographerState.enrichedToJson(r)),
      'sampleRecords': this.sampleRecords.map((r) => CartographerState.enrichedToJson(r)),
      'enriched': CartographerState.enrichedToJson(this.enriched),
      'insights': [...this.insights.entries()].map(([key, r]) => ({
        'key': key,
        'region': r.region, 'country': r.country, 'hub': r.hub,
        'deliveries': r.deliveries, 'exceptions': r.exceptions,
        'onTimeCount': r.onTimeCount, 'lateCount': r.lateCount,
        'totalSubtotalUsdMinor': r.totalSubtotalUsdMinor,
        'totalShippingUsdMinor': r.totalShippingUsdMinor,
        'totalDistanceKm': r.totalDistanceKm,
        'totalDelayHours': r.totalDelayHours,
        'consentValid': r.consentValid, 'consentMissing': r.consentMissing, 'consentExpired': r.consentExpired,
        'sizeTierEnvelope': r.sizeTierEnvelope, 'sizeTierSmall': r.sizeTierSmall,
        'sizeTierMedium': r.sizeTierMedium, 'sizeTierLarge': r.sizeTierLarge, 'sizeTierFreight': r.sizeTierFreight,
        'shipmentCount': r.shipmentCount,
      })),
      'journeyAccumulators': [...this.journeyAccumulators.entries()].map(([id, acc]) => ({
        'id': id,
        'scans': acc.scans.map((s) => ({
          'scanSeq': s.scanSeq, 'epochMs': s.epochMs, 'localIso': s.localIso,
          'utcOffset': s.utcOffset, 'timezone': s.timezone, 'jurisdiction': s.jurisdiction,
          'status': s.status, 'hub': s.hub, 'region': s.region, 'country': s.country,
          'lat': s.lat, 'lng': s.lng, 'legKm': s.legKm, 'disruptionReason': s.disruptionReason,
        })),
        'scanCount': acc.scanCount, 'pathKm': acc.pathKm,
        'minEpoch': acc.minEpoch, 'maxEpoch': acc.maxEpoch,
        'offsets': [...acc.offsets], 'timezones': [...acc.timezones], 'jurisdictions': [...acc.jurisdictions],
        'statusProgression': [...acc.statusProgression],
        'delivered': acc.delivered, 'etaCaptured': acc.etaCaptured, 'onTime': acc.onTime,
        'delayHours': acc.delayHours, 'subtotalUsdMinor': acc.subtotalUsdMinor, 'shippingUsdMinor': acc.shippingUsdMinor,
      })),
      'errorRollup': {
        'total': this.errorRollup.total,
        'groups': [...this.errorRollup.groups.entries()].map(([key, g]) => ({
          'key': key,
          'source': g.source, 'variant': g.variant, 'count': g.count,
          'samples': [...g.samples], 'sampleInput': g.sampleInput,
        })),
      },
    };
  }

  protected override restoreData(snap: JsonObjectType): void {
    if (typeof snap['eventCount'] === 'number') this.eventCount = snap['eventCount'];
    if (typeof snap['useStreamingSource'] === 'boolean') this.useStreamingSource = snap['useStreamingSource'];
    if (typeof snap['streamCount'] === 'number') this.streamCount = snap['streamCount'];
    if (typeof snap['streamChannelCapacity'] === 'number') this.streamChannelCapacity = snap['streamChannelCapacity'];
    if (Array.isArray(snap['sources'])) {
      this.sources = snap['sources'].map((s) => CartographerState.sourceFromJson(CartographerState.asObject(s) ?? {}));
    }
    if (Array.isArray(snap['ingestBuckets'])) {
      this.ingestBuckets = snap['ingestBuckets'].map((bucket) =>
        Array.isArray(bucket)
          ? bucket.map((e) => CartographerState.variantFromJson(CartographerState.asObject(e) ?? {}))
          : [],
      );
    }
    if (Array.isArray(snap['canonicalEvents'])) {
      this.canonicalEvents = snap['canonicalEvents'].map((e) => CartographerState.variantFromJson(CartographerState.asObject(e) ?? {}));
    }
    if (Array.isArray(snap['eventConfig'])) {
      const loadedEvtCfg: EventTypeConfig = snap['eventConfig']
        .map((e) => CartographerState.asObject(e))
        .filter((e): e is JsonObjectType => e !== null)
        .map((e) => {
          const mixRaw = Array.isArray(e['formatMix']) ? e['formatMix'] : [];
          const formatMix = mixRaw
            .map((m) => CartographerState.asObject(m))
            .filter((m): m is JsonObjectType => m !== null)
            .map((m): { readonly format: 'csv' | 'json' | 'ndjson' | 'yaml'; readonly compression: 'none' | 'gzip'; readonly weight: number } => ({
              'format':      CartographerState.sourceFormat(m['format']),
              'compression': m['compression'] === 'gzip' ? 'gzip' : 'none',
              'weight':      CartographerState.num(m['weight'], 1),
            }));
          return {
            'eventType': CartographerState.canonicalEventType(e['eventType']),
            'count':     CartographerState.num(e['count']),
            'formatMix': formatMix,
          };
        });
      if (loadedEvtCfg.length > 0) this.eventConfig = loadedEvtCfg;
    }
    if (Array.isArray(snap['records'])) {
      this.records = snap['records'].map((r) => CartographerState.enrichedFromJson(CartographerState.asObject(r) ?? {}));
    }
    if (Array.isArray(snap['sampleRecords'])) {
      this.sampleRecords = snap['sampleRecords'].map((r) => CartographerState.enrichedFromJson(CartographerState.asObject(r) ?? {}));
    }
    const enObj = CartographerState.asObject(snap['enriched']);
    if (enObj !== null) this.enriched = CartographerState.enrichedFromJson(enObj);
    if (Array.isArray(snap['insights'])) {
      this.insights = new Map(
        snap['insights']
          .map((e) => CartographerState.asObject(e))
          .filter((e): e is JsonObjectType => e !== null)
          .map((e): [string, RegionInsights] => [
            CartographerState.str(e['key']),
            {
              'region': CartographerState.str(e['region']),
              'country': CartographerState.str(e['country']),
              'hub': CartographerState.str(e['hub']),
              'deliveries': CartographerState.num(e['deliveries']),
              'exceptions': CartographerState.num(e['exceptions']),
              'onTimeCount': CartographerState.num(e['onTimeCount']),
              'lateCount': CartographerState.num(e['lateCount']),
              'totalSubtotalUsdMinor': CartographerState.num(e['totalSubtotalUsdMinor']),
              'totalShippingUsdMinor': CartographerState.num(e['totalShippingUsdMinor']),
              'totalDistanceKm': CartographerState.num(e['totalDistanceKm']),
              'totalDelayHours': CartographerState.num(e['totalDelayHours']),
              'consentValid': CartographerState.num(e['consentValid']),
              'consentMissing': CartographerState.num(e['consentMissing']),
              'consentExpired': CartographerState.num(e['consentExpired']),
              'sizeTierEnvelope': CartographerState.num(e['sizeTierEnvelope']),
              'sizeTierSmall': CartographerState.num(e['sizeTierSmall']),
              'sizeTierMedium': CartographerState.num(e['sizeTierMedium']),
              'sizeTierLarge': CartographerState.num(e['sizeTierLarge']),
              'sizeTierFreight': CartographerState.num(e['sizeTierFreight']),
              'shipmentCount': CartographerState.num(e['shipmentCount']),
            },
          ])
      );
    }
    if (Array.isArray(snap['journeyAccumulators'])) {
      this.journeyAccumulators = new Map(
        snap['journeyAccumulators']
          .map((e) => CartographerState.asObject(e))
          .filter((e): e is JsonObjectType => e !== null)
          .map((e): [string, JourneyAccumulator] => [
            CartographerState.str(e['id']),
            {
              'scans': Array.isArray(e['scans'])
                ? e['scans']
                    .map((s) => CartographerState.asObject(s))
                    .filter((s): s is JsonObjectType => s !== null)
                    .map((s): JourneyScan => ({
                      'scanSeq': CartographerState.num(s['scanSeq']),
                      'epochMs': CartographerState.num(s['epochMs']),
                      'localIso': CartographerState.str(s['localIso']),
                      'utcOffset': CartographerState.str(s['utcOffset']),
                      'timezone': CartographerState.str(s['timezone']),
                      'jurisdiction': CartographerState.str(s['jurisdiction']),
                      'status': CartographerState.str(s['status']),
                      'hub': CartographerState.str(s['hub']),
                      'region': CartographerState.str(s['region']),
                      'country': CartographerState.str(s['country']),
                      'lat': CartographerState.num(s['lat']),
                      'lng': CartographerState.num(s['lng']),
                      'legKm': CartographerState.num(s['legKm']),
                      'disruptionReason': CartographerState.str(s['disruptionReason']),
                    }))
                : [],
              'scanCount': CartographerState.num(e['scanCount']),
              'pathKm': CartographerState.num(e['pathKm']),
              'minEpoch': CartographerState.num(e['minEpoch']),
              'maxEpoch': CartographerState.num(e['maxEpoch']),
              'offsets': CartographerState.strArr(e['offsets']),
              'timezones': CartographerState.strArr(e['timezones']),
              'jurisdictions': CartographerState.strArr(e['jurisdictions']),
              'statusProgression': CartographerState.strArr(e['statusProgression']),
              'delivered': CartographerState.bool(e['delivered']),
              'etaCaptured': CartographerState.bool(e['etaCaptured']),
              'onTime': CartographerState.bool(e['onTime']),
              'delayHours': CartographerState.num(e['delayHours']),
              'subtotalUsdMinor': CartographerState.num(e['subtotalUsdMinor']),
              'shippingUsdMinor': CartographerState.num(e['shippingUsdMinor']),
            },
          ])
      );
    }
    const rollupRaw = CartographerState.asObject(snap['errorRollup']);
    if (rollupRaw !== null) {
      const groupsRaw = Array.isArray(rollupRaw['groups']) ? rollupRaw['groups'] : [];
      const groups = new Map<string, ErrorGroupType>(
        groupsRaw
          .map((g) => CartographerState.asObject(g))
          .filter((g): g is JsonObjectType => g !== null)
          .map((g): [string, ErrorGroupType] => [
            CartographerState.str(g['key']),
            {
              'source': CartographerState.str(g['source']),
              'variant': CartographerState.str(g['variant']),
              'count': CartographerState.num(g['count']),
              'samples': CartographerState.strArr(g['samples']),
              'sampleInput': CartographerState.str(g['sampleInput']),
            },
          ])
      );
      this.errorRollup = { 'total': CartographerState.num(rollupRaw['total']), 'groups': groups };
    }
  }
  // #endregion snapshot-restore

  // #region snapshot-helpers
  // ── Scalar narrowing helpers (no blanket `as unknown as` casts) ────────────

  /** Type predicate: narrows `unknown` to `JsonObjectType` via structural runtime checks. */
  private static isJsonObject(value: unknown): value is JsonObjectType {
    return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
  }

  private static asObject(value: unknown): JsonObjectType | null {
    return CartographerState.isJsonObject(value) ? value : null;
  }

  private static str(value: unknown, defaultValue: string = ''): string {
    return typeof value === 'string' ? value : defaultValue;
  }

  private static num(value: unknown, defaultValue: number = 0): number {
    return typeof value === 'number' ? value : defaultValue;
  }

  private static bool(value: unknown, defaultValue: boolean = false): boolean {
    return typeof value === 'boolean' ? value : defaultValue;
  }

  private static strArr(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  }

  // ── CanonicalEventVariant / SourcePayload narrowers + reconstruction ──────────────
  private static canonicalEventType(value: unknown): CanonicalEventVariant['eventType'] {
    return value === 'position-ping' || value === 'facility-scan' || value === 'sensor-reading'
      || value === 'customs-event' || value === 'delivery-confirmation'
      ? value
      : 'position-ping';
  }

  private static sourceFormat(value: unknown): SourcePayload['format'] {
    return value === 'csv' || value === 'json' || value === 'ndjson' || value === 'yaml' ? value : 'json';
  }

  private static canonicalSourceFormat(value: unknown): CanonicalEventVariant['sourceFormat'] {
    return value === 'csv' || value === 'json' || value === 'ndjson' || value === 'yaml' ? value : 'json';
  }

  private static canonicalSourceCompression(value: unknown): CanonicalEventVariant['sourceCompression'] {
    return value === 'none' || value === 'gzip' ? value : 'none';
  }

  // ── Dispatch maps (replace switches on eventType) ──────────────────────────

  private static readonly cloneVariantDispatch: Readonly<Record<string, (v: CanonicalEventVariant) => CanonicalEventVariant>> = {
    'position-ping': (v) => {
      if (v.eventType !== 'position-ping') return v;
      const copy: PositionPingEvent = { ...CartographerState.variantEnvelope(v), 'eventType': 'position-ping', 'body': { ...v.body } };
      if (v.geo !== undefined) copy.geo = { ...v.geo };
      if (v.consentHandled !== undefined) copy.consentHandled = v.consentHandled;
      if (v.pii !== undefined) copy.pii = v.pii;
      return copy;
    },
    'facility-scan': (v) => {
      if (v.eventType !== 'facility-scan') return v;
      const copy: FacilityScanEvent = { ...CartographerState.variantEnvelope(v), 'eventType': 'facility-scan', 'body': { ...v.body, 'lineItems': v.body.lineItems.map((li) => ({ ...li })) } };
      if (v.geo !== undefined) copy.geo = { ...v.geo };
      if (v.consentHandled !== undefined) copy.consentHandled = v.consentHandled;
      if (v.pii !== undefined) copy.pii = v.pii;
      return copy;
    },
    'sensor-reading': (v) => {
      if (v.eventType !== 'sensor-reading') return v;
      const copy: SensorReadingEvent = { ...CartographerState.variantEnvelope(v), 'eventType': 'sensor-reading', 'body': { ...v.body } };
      if (v.geo !== undefined) copy.geo = { ...v.geo };
      if (v.consentHandled !== undefined) copy.consentHandled = v.consentHandled;
      if (v.pii !== undefined) copy.pii = v.pii;
      return copy;
    },
    'customs-event': (v) => {
      if (v.eventType !== 'customs-event') return v;
      const copy: CustomsEvent = { ...CartographerState.variantEnvelope(v), 'eventType': 'customs-event', 'body': { ...v.body } };
      if (v.geo !== undefined) copy.geo = { ...v.geo };
      if (v.consentHandled !== undefined) copy.consentHandled = v.consentHandled;
      if (v.pii !== undefined) copy.pii = v.pii;
      return copy;
    },
    'delivery-confirmation': (v) => {
      if (v.eventType !== 'delivery-confirmation') return v;
      const copy: DeliveryConfirmationEvent = { ...CartographerState.variantEnvelope(v), 'eventType': 'delivery-confirmation', 'body': { ...v.body } };
      if (v.geo !== undefined) copy.geo = { ...v.geo };
      if (v.consentHandled !== undefined) copy.consentHandled = v.consentHandled;
      if (v.pii !== undefined) copy.pii = v.pii;
      return copy;
    },
  };

  private static readonly variantToJsonBodyDispatch: Readonly<Record<string, (v: CanonicalEventVariant) => JsonObjectType>> = {
    'position-ping': (v) => {
      if (v.eventType !== 'position-ping') return {};
      return {
        'scanSeq':      v.body.scanSeq,   'latitude':   v.body.latitude,  'longitude':    v.body.longitude,
        'ipAddress':    v.body.ipAddress,  'localeTag':  v.body.localeTag,  'countryCode':  v.body.countryCode,
        'legFromLat': v.body.legFromLat, 'legFromLng':  v.body.legFromLng,
        'originLat':    v.body.originLat,  'originLng':  v.body.originLng,  'destLat':     v.body.destLat,  'destLng': v.body.destLng,
        'carrier':      v.body.carrier,    'status':     v.body.status,      'rawTimestamp': v.body.rawTimestamp,
        'address': v.body.address, 'phone': v.body.phone,
      };
    },
    'facility-scan': (v) => {
      if (v.eventType !== 'facility-scan') return {};
      return {
        'scanSeq':      v.body.scanSeq,   'latitude':   v.body.latitude,  'longitude':    v.body.longitude,
        'ipAddress':    v.body.ipAddress,  'localeTag':  v.body.localeTag,  'countryCode':  v.body.countryCode,
        'legFromLat': v.body.legFromLat, 'legFromLng':  v.body.legFromLng,
        'originLat':    v.body.originLat,  'originLng':  v.body.originLng,  'destLat':     v.body.destLat,  'destLng': v.body.destLng,
        'carrier':      v.body.carrier,    'status':     v.body.status,      'rawTimestamp': v.body.rawTimestamp,
        'facilityId':   v.body.facilityId, 'weight': v.body.weight, 'weightUnit': v.body.weightUnit,
        'lineItems':    v.body.lineItems.map((li) => ({ 'productId': li.productId, 'quantity': li.quantity })),
        'rawDispatchAt': v.body.rawDispatchAt, 'rawPromisedDeliveryAt': v.body.rawPromisedDeliveryAt,
        'disruptionReason': v.body.disruptionReason,
        'recipientName': v.body.recipientName, 'recipientEmail': v.body.recipientEmail,
        'recipientPhone': v.body.recipientPhone, 'recipientAddress': v.body.recipientAddress,
        'recipientCountry': v.body.recipientCountry, 'marketingConsent': v.body.marketingConsent,
        'lawfulBasis':  v.body.lawfulBasis, 'specialCategory': v.body.specialCategory,
        'address': v.body.address, 'phone': v.body.phone,
      };
    },
    'sensor-reading': (v) => {
      if (v.eventType !== 'sensor-reading') return {};
      return {
        'scanSeq':      v.body.scanSeq,   'latitude':   v.body.latitude,  'longitude':    v.body.longitude,
        'ipAddress':    v.body.ipAddress,  'localeTag':  v.body.localeTag,  'countryCode':  v.body.countryCode,
        'legFromLat': v.body.legFromLat, 'legFromLng':  v.body.legFromLng,
        'originLat':    v.body.originLat,  'originLng':  v.body.originLng,  'destLat':     v.body.destLat,  'destLng': v.body.destLng,
        'carrier':      v.body.carrier,    'status':     v.body.status,      'rawTimestamp': v.body.rawTimestamp,
        'tempC':        v.body.tempC,      'humidityPct': v.body.humidityPct, 'shockG': v.body.shockG,
        'address': v.body.address, 'phone': v.body.phone,
      };
    },
    'customs-event': (v) => {
      if (v.eventType !== 'customs-event') return {};
      return {
        'scanSeq':      v.body.scanSeq,   'latitude':   v.body.latitude,  'longitude':    v.body.longitude,
        'ipAddress':    v.body.ipAddress,  'localeTag':  v.body.localeTag,  'countryCode':  v.body.countryCode,
        'legFromLat': v.body.legFromLat, 'legFromLng':  v.body.legFromLng,
        'originLat':    v.body.originLat,  'originLng':  v.body.originLng,  'destLat':     v.body.destLat,  'destLng': v.body.destLng,
        'carrier':      v.body.carrier,    'status':     v.body.status,      'rawTimestamp': v.body.rawTimestamp,
        'customsStatus': v.body.customsStatus,
        'address': v.body.address, 'phone': v.body.phone,
      };
    },
    'delivery-confirmation': (v) => {
      if (v.eventType !== 'delivery-confirmation') return {};
      return {
        'scanSeq':      v.body.scanSeq,   'latitude':   v.body.latitude,  'longitude':    v.body.longitude,
        'ipAddress':    v.body.ipAddress,  'localeTag':  v.body.localeTag,  'countryCode':  v.body.countryCode,
        'legFromLat': v.body.legFromLat, 'legFromLng':  v.body.legFromLng,
        'originLat':    v.body.originLat,  'originLng':  v.body.originLng,  'destLat':     v.body.destLat,  'destLng': v.body.destLng,
        'carrier':      v.body.carrier,    'status':     v.body.status,      'rawTimestamp': v.body.rawTimestamp,
        'delivered':    v.body.delivered,  'rawPromisedDeliveryAt': v.body.rawPromisedDeliveryAt,
        'disruptionReason': v.body.disruptionReason,
        'recipientName': v.body.recipientName, 'recipientEmail': v.body.recipientEmail,
        'recipientPhone': v.body.recipientPhone, 'recipientAddress': v.body.recipientAddress,
        'recipientCountry': v.body.recipientCountry, 'marketingConsent': v.body.marketingConsent,
        'lawfulBasis':  v.body.lawfulBasis, 'specialCategory': v.body.specialCategory,
        'address': v.body.address, 'phone': v.body.phone,
      };
    },
  };

  private static readonly variantFromJsonDispatch: Readonly<Record<string, (
    envelope: { shipmentId: string; eventId: string; epochMs: number; sourceId: string; sourceFormat: CanonicalEventVariant['sourceFormat']; sourceCompression: CanonicalEventVariant['sourceCompression'] },
    sharedBody: { scanSeq: number; latitude: number; longitude: number; ipAddress: string; localeTag: string; countryCode: string; legFromLat: number; legFromLng: number; originLat: number; originLng: number; destLat: number; destLng: number; carrier: string; status: string; rawTimestamp: string; address: string; phone: string },
    b: Record<string, unknown>,
    o: Record<string, unknown>,
  ) => CanonicalEventVariant>> = {
    'facility-scan': (envelope, sharedBody, b, o) => {
      const variant: FacilityScanEvent = {
        ...envelope, 'eventType': 'facility-scan',
        'body': {
          ...sharedBody,
          'facilityId':           CartographerState.str(b['facilityId']),
          'weight':               CartographerState.num(b['weight']),
          'weightUnit':           CartographerState.weightUnit(b['weightUnit']),
          'lineItems':            CartographerState.lineItemsFromJson(b['lineItems']),
          'rawDispatchAt':        CartographerState.str(b['rawDispatchAt']),
          'rawPromisedDeliveryAt': CartographerState.str(b['rawPromisedDeliveryAt']),
          'disruptionReason':     CartographerState.str(b['disruptionReason']),
          'recipientName':        CartographerState.str(b['recipientName']),
          'recipientEmail':       CartographerState.str(b['recipientEmail']),
          'recipientPhone':       CartographerState.str(b['recipientPhone']),
          'recipientAddress':     CartographerState.str(b['recipientAddress']),
          'recipientCountry':     CartographerState.str(b['recipientCountry']),
          'marketingConsent':     CartographerState.bool(b['marketingConsent']),
          'lawfulBasis':          CartographerState.lawfulBasis(b['lawfulBasis']),
          'specialCategory':      CartographerState.specialCategory(b['specialCategory']),
        },
      };
      const geoObj = CartographerState.asObject(o['geo']);
      if (geoObj !== null) variant.geo = { 'country': CartographerState.str(geoObj['country']), 'continent': CartographerState.str(geoObj['continent']), 'region': CartographerState.str(geoObj['region']) };
      if (typeof o['consentHandled'] === 'boolean') variant.consentHandled = o['consentHandled'];
      if (typeof o['pii'] === 'boolean') variant.pii = o['pii'];
      return variant;
    },
    'sensor-reading': (envelope, sharedBody, b, o) => {
      const variant: SensorReadingEvent = {
        ...envelope, 'eventType': 'sensor-reading',
        'body': {
          ...sharedBody,
          'tempC':       CartographerState.num(b['tempC']),
          'humidityPct': CartographerState.num(b['humidityPct']),
          'shockG':      CartographerState.num(b['shockG']),
        },
      };
      const geoObj = CartographerState.asObject(o['geo']);
      if (geoObj !== null) variant.geo = { 'country': CartographerState.str(geoObj['country']), 'continent': CartographerState.str(geoObj['continent']), 'region': CartographerState.str(geoObj['region']) };
      if (typeof o['consentHandled'] === 'boolean') variant.consentHandled = o['consentHandled'];
      if (typeof o['pii'] === 'boolean') variant.pii = o['pii'];
      return variant;
    },
    'customs-event': (envelope, sharedBody, b, o) => {
      const variant: CustomsEvent = {
        ...envelope, 'eventType': 'customs-event',
        'body': { ...sharedBody, 'customsStatus': CartographerState.str(b['customsStatus']) },
      };
      const geoObj = CartographerState.asObject(o['geo']);
      if (geoObj !== null) variant.geo = { 'country': CartographerState.str(geoObj['country']), 'continent': CartographerState.str(geoObj['continent']), 'region': CartographerState.str(geoObj['region']) };
      if (typeof o['consentHandled'] === 'boolean') variant.consentHandled = o['consentHandled'];
      if (typeof o['pii'] === 'boolean') variant.pii = o['pii'];
      return variant;
    },
    'delivery-confirmation': (envelope, sharedBody, b, o) => {
      const variant: DeliveryConfirmationEvent = {
        ...envelope, 'eventType': 'delivery-confirmation',
        'body': {
          ...sharedBody,
          'delivered':             CartographerState.bool(b['delivered']),
          'rawPromisedDeliveryAt': CartographerState.str(b['rawPromisedDeliveryAt']),
          'disruptionReason':      CartographerState.str(b['disruptionReason']),
          'recipientName':         CartographerState.str(b['recipientName']),
          'recipientEmail':        CartographerState.str(b['recipientEmail']),
          'recipientPhone':        CartographerState.str(b['recipientPhone']),
          'recipientAddress':      CartographerState.str(b['recipientAddress']),
          'recipientCountry':      CartographerState.str(b['recipientCountry']),
          'marketingConsent':      CartographerState.bool(b['marketingConsent']),
          'lawfulBasis':           CartographerState.lawfulBasis(b['lawfulBasis']),
          'specialCategory':       CartographerState.specialCategory(b['specialCategory']),
        },
      };
      const geoObj = CartographerState.asObject(o['geo']);
      if (geoObj !== null) variant.geo = { 'country': CartographerState.str(geoObj['country']), 'continent': CartographerState.str(geoObj['continent']), 'region': CartographerState.str(geoObj['region']) };
      if (typeof o['consentHandled'] === 'boolean') variant.consentHandled = o['consentHandled'];
      if (typeof o['pii'] === 'boolean') variant.pii = o['pii'];
      return variant;
    },
    'position-ping': (envelope, sharedBody, _b, o) => {
      const variant: PositionPingEvent = { ...envelope, 'eventType': 'position-ping', 'body': { ...sharedBody } };
      const geoObj = CartographerState.asObject(o['geo']);
      if (geoObj !== null) variant.geo = { 'country': CartographerState.str(geoObj['country']), 'continent': CartographerState.str(geoObj['continent']), 'region': CartographerState.str(geoObj['region']) };
      if (typeof o['consentHandled'] === 'boolean') variant.consentHandled = o['consentHandled'];
      if (typeof o['pii'] === 'boolean') variant.pii = o['pii'];
      return variant;
    },
  };

  /** Extract the shared envelope fields from a CanonicalEventVariant (used by dispatch maps). */
  private static variantEnvelope(v: CanonicalEventVariant): {
    shipmentId: string; eventId: string; epochMs: number;
    sourceId: string; sourceFormat: CanonicalEventVariant['sourceFormat']; sourceCompression: CanonicalEventVariant['sourceCompression'];
  } {
    return {
      'shipmentId':        v.shipmentId,
      'eventId':           v.eventId,
      'epochMs':           v.epochMs,
      'sourceId':          v.sourceId,
      'sourceFormat':      v.sourceFormat,
      'sourceCompression': v.sourceCompression,
    };
  }

  private static resolveCloneHandler(eventType: string): (v: CanonicalEventVariant) => CanonicalEventVariant {
    return CartographerState.cloneVariantDispatch[eventType]
        ?? CartographerState.cloneVariantDispatch['position-ping']
        ?? ((vv: CanonicalEventVariant): CanonicalEventVariant => ({ ...vv }));
  }

  /** Deep-clone a CanonicalEventVariant (dispatch map on eventType to keep each member's exact shape). */
  private static cloneVariant(v: CanonicalEventVariant): CanonicalEventVariant {
    return CartographerState.resolveCloneHandler(v.eventType)(v);
  }

  private static resolveToJsonBodyHandler(eventType: string): (v: CanonicalEventVariant) => JsonObjectType {
    return CartographerState.variantToJsonBodyDispatch[eventType]
        ?? CartographerState.variantToJsonBodyDispatch['position-ping']
        ?? (() => ({}));
  }

  /** Serialize a CanonicalEventVariant to a JSON-safe object (dispatch map on eventType for exact body fields). */
  private static variantToJson(v: CanonicalEventVariant): JsonObjectType {
    const bodyHandler = CartographerState.resolveToJsonBodyHandler(v.eventType);
    return {
      'shipmentId':        v.shipmentId,
      'eventId':           v.eventId,
      'epochMs':           v.epochMs,
      'eventType':         v.eventType,
      'sourceId':          v.sourceId,
      'sourceFormat':      v.sourceFormat,
      'sourceCompression': v.sourceCompression,
      'geo':               v.geo !== undefined ? { 'country': v.geo.country, 'continent': v.geo.continent, 'region': v.geo.region } : null,
      'consentHandled':    v.consentHandled !== undefined ? v.consentHandled : null,
      'pii':               v.pii !== undefined ? v.pii : null,
      'body':              bodyHandler(v),
    };
  }

  private static resolveFromJsonHandler(eventType: string): (
    envelope: { shipmentId: string; eventId: string; epochMs: number; sourceId: string; sourceFormat: CanonicalEventVariant['sourceFormat']; sourceCompression: CanonicalEventVariant['sourceCompression'] },
    sharedBody: { scanSeq: number; latitude: number; longitude: number; ipAddress: string; localeTag: string; countryCode: string; legFromLat: number; legFromLng: number; originLat: number; originLng: number; destLat: number; destLng: number; carrier: string; status: string; rawTimestamp: string; address: string; phone: string },
    b: Record<string, unknown>,
    o: Record<string, unknown>,
  ) => CanonicalEventVariant {
    const pp = (
      envelope: { shipmentId: string; eventId: string; epochMs: number; sourceId: string; sourceFormat: CanonicalEventVariant['sourceFormat']; sourceCompression: CanonicalEventVariant['sourceCompression'] },
      sharedBody: { scanSeq: number; latitude: number; longitude: number; ipAddress: string; localeTag: string; countryCode: string; legFromLat: number; legFromLng: number; originLat: number; originLng: number; destLat: number; destLng: number; carrier: string; status: string; rawTimestamp: string; address: string; phone: string },
      _b: Record<string, unknown>,
      o: Record<string, unknown>,
    ): CanonicalEventVariant => {
      const variant: PositionPingEvent = { ...envelope, 'eventType': 'position-ping', 'body': { ...sharedBody } };
      const geoObj = CartographerState.asObject(o['geo']);
      if (geoObj !== null) variant.geo = { 'country': CartographerState.str(geoObj['country']), 'continent': CartographerState.str(geoObj['continent']), 'region': CartographerState.str(geoObj['region']) };
      if (typeof o['consentHandled'] === 'boolean') variant.consentHandled = o['consentHandled'];
      if (typeof o['pii'] === 'boolean') variant.pii = o['pii'];
      return variant;
    };
    return CartographerState.variantFromJsonDispatch[eventType] ?? pp;
  }

  /** Reconstruct a CanonicalEventVariant from a deserialized JSON object (dispatch map on eventType). */
  private static variantFromJson(o: Record<string, unknown>): CanonicalEventVariant {
    const eventType = typeof o['eventType'] === 'string' ? o['eventType'] : 'position-ping';
    const b = CartographerState.asObject(o['body']) ?? {};
    const envelope = {
      'shipmentId':        CartographerState.str(o['shipmentId']),
      'eventId':           CartographerState.str(o['eventId']),
      'epochMs':           CartographerState.num(o['epochMs']),
      'sourceId':          CartographerState.str(o['sourceId']),
      'sourceFormat':      CartographerState.canonicalSourceFormat(o['sourceFormat']),
      'sourceCompression': CartographerState.canonicalSourceCompression(o['sourceCompression']),
    };
    const sharedBody = {
      'scanSeq':      CartographerState.num(b['scanSeq']),
      'latitude':     CartographerState.num(b['latitude']),
      'longitude':    CartographerState.num(b['longitude']),
      'ipAddress':    CartographerState.str(b['ipAddress']),
      'localeTag':    CartographerState.str(b['localeTag']),
      'countryCode':  CartographerState.str(b['countryCode']),
      'legFromLat':   CartographerState.num(b['legFromLat']),
      'legFromLng':   CartographerState.num(b['legFromLng']),
      'originLat':    CartographerState.num(b['originLat']),
      'originLng':    CartographerState.num(b['originLng']),
      'destLat':      CartographerState.num(b['destLat']),
      'destLng':      CartographerState.num(b['destLng']),
      'carrier':      CartographerState.str(b['carrier']),
      'status':       CartographerState.str(b['status']),
      'rawTimestamp': CartographerState.str(b['rawTimestamp']),
      'address':      CartographerState.str(b['address']),
      'phone':        CartographerState.str(b['phone']),
    };
    return CartographerState.resolveFromJsonHandler(eventType)(envelope, sharedBody, b, o);
  }

  private static sourceToJson(s: SourcePayload): JsonObjectType {
    return {
      'sourceId':    s.sourceId,
      'format':      s.format,
      'compression': s.compression,
      'mappingKey':  s.mappingKey,
      'eventType':   s.eventType,
      'payload':     s.payload,
    };
  }

  private static sourceFromJson(o: Record<string, unknown>): SourcePayload {
    return {
      'sourceId':    CartographerState.str(o['sourceId']),
      'format':      CartographerState.sourceFormat(o['format']),
      'compression': (o['compression'] === 'none' || o['compression'] === 'gzip') ? o['compression'] : 'none',
      'mappingKey':  CartographerState.str(o['mappingKey'], 'json-position'),
      'eventType':   CartographerState.canonicalEventType(o['eventType']),
      'payload':     CartographerState.str(o['payload']),
    };
  }

  private static geoStatus(value: unknown): GeoContext['status'] {
    return value === 'land' || value === 'water' || value === 'coastal' || value === 'unmapped'
      ? value
      : 'unmapped';
  }

  private static consentStatus(value: unknown): GdprResult['consentStatus'] {
    return value === 'valid' || value === 'missing' || value === 'expired' ? value : 'missing';
  }

  private static lawfulBasis(value: unknown): GdprResult['lawfulBasis'] {
    return value === 'contract' || value === 'consent' || value === 'legitimate-interest' || value === 'none'
      ? value
      : 'contract';
  }

  private static jurisdiction(value: unknown): GeoContext['jurisdiction'] {
    return value === 'GDPR' || value === 'UK-GDPR' || value === 'CCPA'
      || value === 'LGPD' || value === 'APPI' || value === 'baseline'
      || value === 'international-waters'
      ? value
      : 'baseline';
  }

  private static lifecycleStatus(value: unknown): NormalizedShipment['status'] {
    return value === 'SCAN' || value === 'DEPARTURE' || value === 'ARRIVAL'
      || value === 'OUT_FOR_DELIVERY' || value === 'DELIVERED' || value === 'EXCEPTION'
      ? value
      : 'SCAN';
  }

  private static serviceTier(value: unknown): NormalizedShipment['serviceTier'] {
    return value === 'express' || value === 'standard' || value === 'economy' ? value : 'standard';
  }

  private static sizeTier(value: unknown): NormalizedShipment['sizeTier'] {
    return value === 'envelope' || value === 'small' || value === 'medium'
      || value === 'large' || value === 'freight'
      ? value
      : 'small';
  }

  private static weightUnit(value: unknown): RawShipmentEvent['weightUnit'] {
    return value === 'lb' || value === 'kg' || value === 'g' || value === 'oz' ? value : 'kg';
  }

  private static specialCategory(value: unknown): RawShipmentEvent['specialCategory'] {
    return value === 'none' || value === 'health' ? value : 'none';
  }

  private static lineItemsFromJson(value: unknown): Array<{ 'productId': string; 'quantity': number }> {
    if (!Array.isArray(value)) return [{ 'productId': '', 'quantity': 1 }];
    const items = value
      .map((li) => CartographerState.asObject(li))
      .filter((li): li is JsonObjectType => li !== null)
      .map((li) => ({
        'productId': CartographerState.str(li['productId']),
        'quantity':  CartographerState.num(li['quantity'], 1),
      }));
    return items.length > 0 ? items : [{ 'productId': '', 'quantity': 1 }];
  }

  // ── Entity ↔ JSON reconstruction (field-by-field) ──────────────────────────
  private static enrichedToJson(e: EnrichedShipment): JsonObjectType {
    return {
      'shipmentId': e.shipmentId, 'scanSeq': e.scanSeq, 'epochMs': e.epochMs,
      'localIso': e.localIso, 'utcOffset': e.utcOffset, 'timezone': e.timezone, 'jurisdiction': e.jurisdiction,
      'continent': e.continent, 'region': e.region, 'country': e.country, 'hub': e.hub, 'geoStatus': e.geoStatus,
      'lat': e.lat, 'lng': e.lng, 'coordsCoarsened': e.coordsCoarsened, 'legKm': e.legKm,
      'status': e.status, 'serviceTier': e.serviceTier, 'sizeTier': e.sizeTier,
      'onTime': e.onTime, 'exception': e.exception, 'consentStatus': e.consentStatus,
      'disruptionReason': e.disruptionReason,
      'subtotalUsdMinor': e.subtotalUsdMinor, 'currency': e.currency,
      'shippingUsdMinor': e.shippingUsdMinor, 'distanceKm': e.distanceKm,
      'transitHours': e.transitHours, 'delayHours': e.delayHours,
      'redactionApplied': e.redactionApplied,
      'redactedSample': {
        'recipientName': e.redactedSample.recipientName,
        'recipientEmail': e.redactedSample.recipientEmail,
        'recipientPhone': e.redactedSample.recipientPhone,
      },
      'routing': CartographerState.routingToJson(e.routing),
    };
  }

  /** The all-false default routing record (single source of truth). */
  static defaultRouting(): EnrichedShipment['routing'] {
    return {
      'path':              'order',
      'geoLookupRun':      false,
      'geoLookupSkipped':  false,
      'ipGeolocateRun':    false,
      'ipGeolocateSkipped': false,
      'geoConfidence':     0,
      'geoModalities':     [],
      'geoFlaggedForReview': false,
      'geoSourceModel':    '',
      'geoSecondaryLookupUsed': false,
      'redactionRun':      false,
      'redactionSkipped':  false,
      'pricingRun':        false,
      'pricingSkipped':    false,
      'etaRun':            false,
      'etaSkipped':        false,
      'coldChainRun':      false,
      'customsDwellRun':   false,
    };
  }

  /** An unresolved GeoCandidate for the given modality (the default). */
  static unresolvedCandidate(modality: 'gps' | 'ip'): GeoCandidate {
    return {
      'modality': modality, 'resolved': false, 'country': '', 'countryName': '',
      'continent': '', 'region': '', 'locality': '', 'lat': 0, 'lng': 0, 'water': false,
    };
  }

  private static routingToJson(r: EnrichedShipment['routing']): JsonObjectType {
    return {
      'path':              r.path,
      'geoLookupRun':      r.geoLookupRun,
      'geoLookupSkipped':  r.geoLookupSkipped,
      'ipGeolocateRun':    r.ipGeolocateRun,
      'ipGeolocateSkipped': r.ipGeolocateSkipped,
      'geoConfidence':     r.geoConfidence,
      'geoModalities':     [...r.geoModalities],
      'geoFlaggedForReview': r.geoFlaggedForReview,
      'geoSourceModel':    r.geoSourceModel,
      'geoSecondaryLookupUsed': r.geoSecondaryLookupUsed,
      'redactionRun':      r.redactionRun,
      'redactionSkipped':  r.redactionSkipped,
      'pricingRun':        r.pricingRun,
      'pricingSkipped':    r.pricingSkipped,
      'etaRun':            r.etaRun,
      'etaSkipped':        r.etaSkipped,
      'coldChainRun':      r.coldChainRun,
      'customsDwellRun':   r.customsDwellRun,
    };
  }

  private static routingPath(value: unknown): EnrichedShipment['routing']['path'] {
    return value === 'geo-only' || value === 'sensor' || value === 'order' || value === 'customs'
      ? value
      : 'order';
  }

  private static routingFromJson(value: unknown): EnrichedShipment['routing'] {
    const o = CartographerState.asObject(value) ?? {};
    return {
      'path':              CartographerState.routingPath(o['path']),
      'geoLookupRun':      CartographerState.bool(o['geoLookupRun']),
      'geoLookupSkipped':  CartographerState.bool(o['geoLookupSkipped']),
      'ipGeolocateRun':    CartographerState.bool(o['ipGeolocateRun']),
      'ipGeolocateSkipped': CartographerState.bool(o['ipGeolocateSkipped']),
      'geoConfidence':     CartographerState.num(o['geoConfidence']),
      'geoModalities':     CartographerState.strArr(o['geoModalities']),
      'geoFlaggedForReview': CartographerState.bool(o['geoFlaggedForReview']),
      'geoSourceModel':    CartographerState.str(o['geoSourceModel']),
      'geoSecondaryLookupUsed': CartographerState.bool(o['geoSecondaryLookupUsed']),
      'redactionRun':      CartographerState.bool(o['redactionRun']),
      'redactionSkipped':  CartographerState.bool(o['redactionSkipped']),
      'pricingRun':        CartographerState.bool(o['pricingRun']),
      'pricingSkipped':    CartographerState.bool(o['pricingSkipped']),
      'etaRun':            CartographerState.bool(o['etaRun']),
      'etaSkipped':        CartographerState.bool(o['etaSkipped']),
      'coldChainRun':      CartographerState.bool(o['coldChainRun']),
      'customsDwellRun':   CartographerState.bool(o['customsDwellRun']),
    };
  }

  private static enrichedFromJson(o: Record<string, unknown>): EnrichedShipment {
    const sample = CartographerState.asObject(o['redactedSample']) ?? {};
    return {
      'shipmentId': CartographerState.str(o['shipmentId']),
      'scanSeq': CartographerState.num(o['scanSeq']),
      'epochMs': CartographerState.num(o['epochMs']),
      'localIso': CartographerState.str(o['localIso']),
      'utcOffset': CartographerState.str(o['utcOffset']),
      'timezone': CartographerState.str(o['timezone'], 'UTC'),
      'jurisdiction': CartographerState.jurisdiction(o['jurisdiction']),
      'continent': CartographerState.str(o['continent'], 'Unmapped'),
      'region': CartographerState.str(o['region']),
      'country': CartographerState.str(o['country']),
      'hub': CartographerState.str(o['hub']),
      'geoStatus': CartographerState.geoStatus(o['geoStatus']),
      'lat': CartographerState.num(o['lat']),
      'lng': CartographerState.num(o['lng']),
      'coordsCoarsened': CartographerState.bool(o['coordsCoarsened']),
      'legKm': CartographerState.num(o['legKm']),
      'status': CartographerState.lifecycleStatus(o['status']),
      'serviceTier': CartographerState.serviceTier(o['serviceTier']),
      'sizeTier': CartographerState.sizeTier(o['sizeTier']),
      'onTime': CartographerState.bool(o['onTime']),
      'exception': CartographerState.bool(o['exception']),
      'consentStatus': CartographerState.consentStatus(o['consentStatus']),
      'disruptionReason': CartographerState.str(o['disruptionReason']),
      'subtotalUsdMinor': CartographerState.num(o['subtotalUsdMinor']),
      'currency': CartographerState.str(o['currency'], 'USD'),
      'shippingUsdMinor': CartographerState.num(o['shippingUsdMinor']),
      'distanceKm': CartographerState.num(o['distanceKm']),
      'transitHours': CartographerState.num(o['transitHours']),
      'delayHours': CartographerState.num(o['delayHours']),
      'redactionApplied': CartographerState.bool(o['redactionApplied']),
      'redactedSample': {
        'recipientName': CartographerState.str(sample['recipientName']),
        'recipientEmail': CartographerState.str(sample['recipientEmail']),
        'recipientPhone': CartographerState.str(sample['recipientPhone']),
      },
      'routing': CartographerState.routingFromJson(o['routing']),
    };
  }
  // #endregion snapshot-helpers
}
// #endregion cartographer-state
