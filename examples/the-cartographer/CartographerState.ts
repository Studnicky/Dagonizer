/**
 * CartographerState: the mutable clipboard threaded through every node.
 *
 * Top-level (cartographer DAG):
 *   - `events`      – the AsyncGenerator source set before dispatch; scatter reads it
 *   - `eventCount`  – how many events to generate (seed for ShipmentEvents.generate)
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
 * Durable: eventCount, eventConfig, useStreamingSource, streamCount, sources,
 * ingestBuckets, canonicalEvents, records, sampleRecords, enriched.
 * Per-event scratch (currentSource, decodedText, parsedRecords, mappedRecords,
 * ingestedEvents, canonical, canonicalVariant, raw, normalized, currentEvent,
 * geoContext, pricedOrder, shippingQuote, deliveryEstimate, legKm,
 * batchEventTypeCount, coldChainBreach, customsDwellHours, gpsCandidate,
 * ipCandidate, routing, gdprResult, resolvedGeo) is never serialized; workers
 * recompute it from the source-payload metadata on each dispatch.
 * The `sources` AsyncIterable is not checkpointable (snapshots as empty array;
 * re-seeded by the pre-phase node on resume via eventConfig + streamCount).
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

import { NodeStateBase } from '@noocodex/dagonizer';
import type { JsonObject } from '@noocodex/dagonizer/types';

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
   * When true, `seedEvents` sets `sources` to an `AsyncIterable<SourcePayload>`
   * from `EventStreamSource.streamTyped(eventConfig, streamCount)` rather than
   * awaiting a fully materialised array from `Sources.buildTypedFeed`. The
   * engine's scatter reads the async iterable with backpressure. Defaults to
   * false (materialised array path).
   */
  useStreamingSource: boolean = false;

  /**
   * Override for the total event count when `useStreamingSource` is true.
   * When 0 (default), `EventStreamSource` derives the count from the feed
   * config sum or the `CARTO_EVENT_COUNT` env var.
   */
  streamCount: number = 0;

  /**
   * The multi-format source feeds, seeded by the seed phase node. Each is a
   * `{ sourceId, format, mappingKey, eventType, payload }` — a different on-the-wire
   * encoding (JSON / CSV / gzip NDJSON) of a typed scan from the event feed.
   *
   * When `useStreamingSource` is true this field holds an
   * `AsyncIterable<SourcePayload>` from `EventStreamSource.streamTyped()` rather
   * than a materialised array. The engine's scatter accepts either form
   * transparently. Snapshot/restore serialises the array path only; the async
   * iterable is re-seeded by the pre-phase node on resume.
   *
   * For the batch scatter path (stream-event-batch) the field may hold a
   * `SourcePayload[][]` (materialised batches) or an
   * `AsyncIterable<SourcePayload[]>` from `EventStreamSource.streamTypedBatches()`.
   * The engine's scatter iterates each yielded `SourcePayload[]` item and places it
   * on the configured itemKey (`'source-batch'`).
   */
  sources: SourcePayload[] | SourcePayload[][] | AsyncIterable<SourcePayload> | AsyncIterable<SourcePayload[]> = [];

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
  /** The source feed currently being ingested (set from `sources` by select). */
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

  /** Raw scan from scatter metadata (set by parseEvent). */
  raw: RawShipmentEvent = {
    'shipmentId':          '',
    'scanSeq':             0,
    'rawTimestamp':        '',
    'rawDispatchAt':       '',
    'rawStatus':           '',
    'carrier':             '',
    'ipAddress':           '',
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

  /**
   * Batch size recorded by the classifyBatch node during the batch-by-event-type
   * reservoir scatter. Set per-clone to the number of items in the batch
   * released by the reservoir for this clone's event type. Used for observability
   * of the keyed reservoir batching mechanism.
   */
  batchEventTypeCount: number = 0;

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

  /** GPS-modality candidate from reverse-geocode (set by the geo-resolve sub-DAG). */
  gpsCandidate: GeoCandidate = CartographerState.unresolvedCandidate('gps');

  /** IP-modality candidate from ip-geolocate (unresolved when that node skipped). */
  ipCandidate: GeoCandidate = CartographerState.unresolvedCandidate('ip');

  /** The fused multi-modal location (set by fuse-geo). */
  resolvedGeo: ResolvedGeo = {
    'country':      '',
    'countryName':  '',
    'continent':    'Unmapped',
    'region':       '',
    'locality':     '',
    'lat':          0,
    'lng':          0,
    'status':       'land',
    'jurisdiction': 'baseline',
    'confidence':   0,
    'modalities':   [],
  };

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

  // ── Batch fields (Wave 1 sprout: homogeneous per-type batch path) ─────────
  // These fields coexist alongside the per-event scalars; the per-event path is
  // UNCHANGED. Per-stage transient arrays are never snapshotted (like the scalar
  // scratch fields they pair with). Only `enrichedBatch` is snapshotted because
  // the gather reads it off the returned worker clone.

  /** Discriminant for the homogeneous batch (all items share this eventType). */
  batchEventType: CanonicalEventVariant['eventType'] = 'position-ping';

  /** Decoded variants for the whole batch (decode-batch output). */
  variantBatch: CanonicalEventVariant[] = [];

  /** Per-stage transient working arrays (NOT snapshotted). */
  rawBatch:              RawShipmentEvent[]                     = [];
  normalizedBatch:       NormalizedShipment[]                   = [];
  currentEventBatch:     ShipmentEvent[]                        = [];
  geoContextBatch:       GeoContext[]                           = [];
  resolvedGeoBatch:      ResolvedGeo[]                          = [];
  pricedOrderBatch:      PricedOrder[]                          = [];
  shippingQuoteBatch:    ShippingQuote[]                        = [];
  deliveryEstimateBatch: DeliveryEstimate[]                     = [];
  legKmBatch:            number[]                               = [];
  coldChainBreachBatch:  boolean[]                              = [];
  customsDwellHoursBatch: number[]                              = [];
  gdprResultBatch:       GdprResult[]                           = [];
  routingBatch:          Array<EnrichedShipment['routing']>     = [];
  gpsCandidateBatch:     GeoCandidate[]                         = [];
  ipCandidateBatch:      GeoCandidate[]                         = [];
  /**
   * Per-item skip mask: true means the item should be excluded from enrichedBatch.
   * Set by geo-pipeline-batch for items with invalid WGS-84 coordinates (matching
   * the per-event behaviour where validate-coords routes to the 'rejected' terminal
   * and the item produces no enriched output).
   */
  batchSkipMask:         boolean[]                              = [];

  /**
   * Aggregate-batch output: one EnrichedShipment per item in the batch.
   * Snapshotted so the gather can read it off the returned worker clone.
   */
  enrichedBatch: EnrichedShipment[] = [];

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
    // AsyncIterable sources are shared by reference — the engine iterates the
    // parent's source before cloning for scatters, so this is safe. Array
    // sources are shallow-copied (each payload is a value object).
    // SourcePayload[][] (batch materialised) and AsyncIterable<SourcePayload[]>
    // (batch streaming) are also handled: the inner arrays/iterables are shared
    // by reference since the scatter consumes them before any clone runs.
    if (Array.isArray(this.sources)) {
      const sources = this.sources as SourcePayload[] | SourcePayload[][];
      const firstItem = sources[0];
      if (Array.isArray(firstItem)) {
        // SourcePayload[][] — shallow copy outer array, share inner arrays
        copy.sources = (sources as SourcePayload[][]).map((batch) => [...batch]);
      } else {
        // SourcePayload[] — shallow copy each payload
        copy.sources = (sources as SourcePayload[]).map((s) => ({ ...s }));
      }
    } else {
      // AsyncIterable (per-event or batch streaming) — shared by reference
      copy.sources = this.sources;
    }
    copy.useStreamingSource = this.useStreamingSource;
    copy.streamCount = this.streamCount;
    copy.ingestBuckets = this.ingestBuckets.map((bucket) => bucket.map((e) => CartographerState.cloneVariant(e)));
    copy.canonicalEvents = this.canonicalEvents.map((e) => CartographerState.cloneVariant(e));
    copy.records      = [...this.records];
    copy.sampleRecords = [...this.sampleRecords];
    copy.insights   = new Map(this.insights);
    copy.journeys   = new Map(this.journeys);

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
    copy.batchEventTypeCount = this.batchEventTypeCount;

    copy.gpsCandidate = { ...this.gpsCandidate };
    copy.ipCandidate  = { ...this.ipCandidate };
    copy.resolvedGeo  = { ...this.resolvedGeo, 'modalities': [...this.resolvedGeo.modalities] };

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

    // ── Batch fields (Wave 1 sprout) ──────────────────────────────────────────
    copy.batchEventType = this.batchEventType;
    copy.variantBatch   = this.variantBatch.map((e) => CartographerState.cloneVariant(e));

    // Transient per-stage arrays: shallow-copy the array, deep-copy each element
    // using the same strategy as the corresponding scalar field.
    copy.rawBatch = this.rawBatch.map((r) => ({ ...r, 'lineItems': r.lineItems.map((li) => ({ ...li })) }));
    copy.normalizedBatch = this.normalizedBatch.map((n) => ({ ...n, 'lineItems': n.lineItems.map((li) => ({ ...li })) }));
    copy.currentEventBatch = this.currentEventBatch.map((e) => ({ ...e }));
    copy.geoContextBatch = this.geoContextBatch.map((g) => ({ ...g, 'countries': [...g.countries], 'waterBodies': [...g.waterBodies] }));
    copy.resolvedGeoBatch = this.resolvedGeoBatch.map((r) => ({ ...r, 'modalities': [...r.modalities] }));
    copy.pricedOrderBatch = this.pricedOrderBatch.map((p) => ({ ...p, 'lines': p.lines.map((l) => ({ ...l })) }));
    copy.shippingQuoteBatch = this.shippingQuoteBatch.map((q) => ({ ...q, 'breakdown': { ...q.breakdown } }));
    copy.deliveryEstimateBatch = this.deliveryEstimateBatch.map((d) => ({ ...d }));
    copy.legKmBatch = [...this.legKmBatch];
    copy.coldChainBreachBatch = [...this.coldChainBreachBatch];
    copy.customsDwellHoursBatch = [...this.customsDwellHoursBatch];
    copy.gdprResultBatch = this.gdprResultBatch.map((g) => ({
      ...g,
      'personalDataFields':  [...g.personalDataFields],
      'sensitiveDataFields': [...g.sensitiveDataFields],
      'retention': { ...g.retention },
    }));
    copy.routingBatch = this.routingBatch.map((r) => ({ ...r, 'geoModalities': [...r.geoModalities] }));
    copy.gpsCandidateBatch = this.gpsCandidateBatch.map((c) => ({ ...c }));
    copy.ipCandidateBatch  = this.ipCandidateBatch.map((c) => ({ ...c }));
    copy.batchSkipMask = [...this.batchSkipMask];

    copy.enrichedBatch = this.enrichedBatch.map((e) => ({ ...e, 'redactedSample': { ...e.redactedSample } }));

    return copy;
  }
  // #endregion clone

  // #region snapshot-restore
  protected override snapshotData(): JsonObject {
    return {
      'eventCount': this.eventCount,
      'eventConfig': this.eventConfig.map((e) => ({ 'eventType': e.eventType, 'count': e.count, 'formatMix': e.formatMix.map((m) => ({ 'format': m.format, 'compression': m.compression, 'weight': m.weight })) })),
      // AsyncIterable sources are not checkpointable. The pre-phase node
      // re-seeds them on resume using eventConfig + streamCount. Snapshot as
      // empty array so restoreData leaves sources = [] (re-seeded by pre-phase).
      // Batch SourcePayload[][] is also not checkpointable; snapshot as [].
      'sources':    Array.isArray(this.sources) && !Array.isArray((this.sources as unknown[])[0])
        ? (this.sources as SourcePayload[]).map((s) => CartographerState.sourceToJson(s))
        : [],
      'useStreamingSource': this.useStreamingSource,
      'streamCount': this.streamCount,
      'ingestBuckets': this.ingestBuckets.map((bucket) => bucket.map((e) => CartographerState.variantToJson(e))),
      'canonicalEvents': this.canonicalEvents.map((e) => CartographerState.variantToJson(e)),
      'records':      this.records.map((r) => CartographerState.enrichedToJson(r)),
      'sampleRecords': this.sampleRecords.map((r) => CartographerState.enrichedToJson(r)),
      'enriched': CartographerState.enrichedToJson(this.enriched),
      // Batch accumulator — only enrichedBatch is checkpointable; the per-stage
      // transient arrays are recomputed per dispatch (same as the scalar scratch).
      'enrichedBatch': this.enrichedBatch.map((e) => CartographerState.enrichedToJson(e)),
    };
  }

  protected override restoreData(snap: JsonObject): void {
    if (typeof snap['eventCount'] === 'number') this.eventCount = snap['eventCount'];
    if (typeof snap['useStreamingSource'] === 'boolean') this.useStreamingSource = snap['useStreamingSource'];
    if (typeof snap['streamCount'] === 'number') this.streamCount = snap['streamCount'];
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
      const loadedEvtCfg: EventTypeConfig = (snap['eventConfig'] as unknown[])
        .map((e) => CartographerState.asObject(e))
        .filter((e): e is Record<string, unknown> => e !== null)
        .map((e) => {
          const mixRaw = Array.isArray(e['formatMix']) ? e['formatMix'] : [];
          const formatMix = mixRaw
            .map((m) => CartographerState.asObject(m))
            .filter((m): m is Record<string, unknown> => m !== null)
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
    // Batch accumulator restore.
    if (Array.isArray(snap['enrichedBatch'])) {
      this.enrichedBatch = snap['enrichedBatch'].map((e) => CartographerState.enrichedFromJson(CartographerState.asObject(e) ?? {}));
    } else {
      this.enrichedBatch = [];
    }
  }
  // #endregion snapshot-restore

  // #region snapshot-helpers
  // ── Scalar narrowing helpers (no blanket `as unknown as` casts) ────────────
  private static asObject(value: unknown): Record<string, unknown> | null {
    if (value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private static str(value: unknown, fallback: string = ''): string {
    return typeof value === 'string' ? value : fallback;
  }

  private static num(value: unknown, fallback: number = 0): number {
    return typeof value === 'number' ? value : fallback;
  }

  private static bool(value: unknown, fallback: boolean = false): boolean {
    return typeof value === 'boolean' ? value : fallback;
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

  /** Deep-clone a CanonicalEventVariant (switches on eventType to keep each member's exact shape). */
  private static cloneVariant(v: CanonicalEventVariant): CanonicalEventVariant {
    const envelope = {
      'shipmentId':        v.shipmentId,
      'eventId':           v.eventId,
      'epochMs':           v.epochMs,
      'sourceId':          v.sourceId,
      'sourceFormat':      v.sourceFormat,
      'sourceCompression': v.sourceCompression,
    } as const;
    let result: CanonicalEventVariant;
    switch (v.eventType) {
      case 'position-ping': {
        const copy: PositionPingEvent = { ...envelope, 'eventType': 'position-ping', 'body': { ...v.body } };
        if (v.geo !== undefined) copy.geo = { ...v.geo };
        if (v.consentHandled !== undefined) copy.consentHandled = v.consentHandled;
        if (v.pii !== undefined) copy.pii = v.pii;
        result = copy;
        break;
      }
      case 'facility-scan': {
        const copy: FacilityScanEvent = { ...envelope, 'eventType': 'facility-scan', 'body': { ...v.body, 'lineItems': v.body.lineItems.map((li) => ({ ...li })) } };
        if (v.geo !== undefined) copy.geo = { ...v.geo };
        if (v.consentHandled !== undefined) copy.consentHandled = v.consentHandled;
        if (v.pii !== undefined) copy.pii = v.pii;
        result = copy;
        break;
      }
      case 'sensor-reading': {
        const copy: SensorReadingEvent = { ...envelope, 'eventType': 'sensor-reading', 'body': { ...v.body } };
        if (v.geo !== undefined) copy.geo = { ...v.geo };
        if (v.consentHandled !== undefined) copy.consentHandled = v.consentHandled;
        if (v.pii !== undefined) copy.pii = v.pii;
        result = copy;
        break;
      }
      case 'customs-event': {
        const copy: CustomsEvent = { ...envelope, 'eventType': 'customs-event', 'body': { ...v.body } };
        if (v.geo !== undefined) copy.geo = { ...v.geo };
        if (v.consentHandled !== undefined) copy.consentHandled = v.consentHandled;
        if (v.pii !== undefined) copy.pii = v.pii;
        result = copy;
        break;
      }
      case 'delivery-confirmation': {
        const copy: DeliveryConfirmationEvent = { ...envelope, 'eventType': 'delivery-confirmation', 'body': { ...v.body } };
        if (v.geo !== undefined) copy.geo = { ...v.geo };
        if (v.consentHandled !== undefined) copy.consentHandled = v.consentHandled;
        if (v.pii !== undefined) copy.pii = v.pii;
        result = copy;
        break;
      }
    }
    return result;
  }

  /** Serialize a CanonicalEventVariant to a JSON-safe object (switches on eventType for exact body fields). */
  private static variantToJson(v: CanonicalEventVariant): JsonObject {
    const envelope: JsonObject = {
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
    };
    switch (v.eventType) {
      case 'position-ping':
        envelope['body'] = {
          'scanSeq':      v.body.scanSeq,   'latitude':  v.body.latitude,  'longitude': v.body.longitude,
          'ipAddress':    v.body.ipAddress,  'legFromLat': v.body.legFromLat, 'legFromLng': v.body.legFromLng,
          'originLat':    v.body.originLat,  'originLng':  v.body.originLng,  'destLat':    v.body.destLat,  'destLng': v.body.destLng,
          'carrier':      v.body.carrier,    'status':     v.body.status,      'rawTimestamp': v.body.rawTimestamp,
        };
        break;
      case 'facility-scan':
        envelope['body'] = {
          'scanSeq':      v.body.scanSeq,   'latitude':  v.body.latitude,  'longitude': v.body.longitude,
          'ipAddress':    v.body.ipAddress,  'legFromLat': v.body.legFromLat, 'legFromLng': v.body.legFromLng,
          'originLat':    v.body.originLat,  'originLng':  v.body.originLng,  'destLat':    v.body.destLat,  'destLng': v.body.destLng,
          'carrier':      v.body.carrier,    'status':     v.body.status,      'rawTimestamp': v.body.rawTimestamp,
          'facilityId':   v.body.facilityId, 'weight': v.body.weight, 'weightUnit': v.body.weightUnit,
          'lineItems':    v.body.lineItems.map((li) => ({ 'productId': li.productId, 'quantity': li.quantity })),
          'rawDispatchAt': v.body.rawDispatchAt, 'rawPromisedDeliveryAt': v.body.rawPromisedDeliveryAt,
          'disruptionReason': v.body.disruptionReason,
          'recipientName': v.body.recipientName, 'recipientEmail': v.body.recipientEmail,
          'recipientPhone': v.body.recipientPhone, 'recipientAddress': v.body.recipientAddress,
          'recipientCountry': v.body.recipientCountry, 'marketingConsent': v.body.marketingConsent,
          'lawfulBasis':  v.body.lawfulBasis, 'specialCategory': v.body.specialCategory,
        };
        break;
      case 'sensor-reading':
        envelope['body'] = {
          'scanSeq':      v.body.scanSeq,   'latitude':  v.body.latitude,  'longitude': v.body.longitude,
          'ipAddress':    v.body.ipAddress,  'legFromLat': v.body.legFromLat, 'legFromLng': v.body.legFromLng,
          'originLat':    v.body.originLat,  'originLng':  v.body.originLng,  'destLat':    v.body.destLat,  'destLng': v.body.destLng,
          'carrier':      v.body.carrier,    'status':     v.body.status,      'rawTimestamp': v.body.rawTimestamp,
          'tempC':        v.body.tempC,      'humidityPct': v.body.humidityPct, 'shockG': v.body.shockG,
        };
        break;
      case 'customs-event':
        envelope['body'] = {
          'scanSeq':      v.body.scanSeq,   'latitude':  v.body.latitude,  'longitude': v.body.longitude,
          'ipAddress':    v.body.ipAddress,  'legFromLat': v.body.legFromLat, 'legFromLng': v.body.legFromLng,
          'originLat':    v.body.originLat,  'originLng':  v.body.originLng,  'destLat':    v.body.destLat,  'destLng': v.body.destLng,
          'carrier':      v.body.carrier,    'status':     v.body.status,      'rawTimestamp': v.body.rawTimestamp,
          'customsStatus': v.body.customsStatus,
        };
        break;
      case 'delivery-confirmation':
        envelope['body'] = {
          'scanSeq':      v.body.scanSeq,   'latitude':  v.body.latitude,  'longitude': v.body.longitude,
          'ipAddress':    v.body.ipAddress,  'legFromLat': v.body.legFromLat, 'legFromLng': v.body.legFromLng,
          'originLat':    v.body.originLat,  'originLng':  v.body.originLng,  'destLat':    v.body.destLat,  'destLng': v.body.destLng,
          'carrier':      v.body.carrier,    'status':     v.body.status,      'rawTimestamp': v.body.rawTimestamp,
          'delivered':    v.body.delivered,  'rawPromisedDeliveryAt': v.body.rawPromisedDeliveryAt,
          'disruptionReason': v.body.disruptionReason,
          'recipientName': v.body.recipientName, 'recipientEmail': v.body.recipientEmail,
          'recipientPhone': v.body.recipientPhone, 'recipientAddress': v.body.recipientAddress,
          'recipientCountry': v.body.recipientCountry, 'marketingConsent': v.body.marketingConsent,
          'lawfulBasis':  v.body.lawfulBasis, 'specialCategory': v.body.specialCategory,
        };
        break;
    }
    return envelope;
  }

  /** Reconstruct a CanonicalEventVariant from a deserialized JSON object (switches on eventType). */
  private static variantFromJson(o: Record<string, unknown>): CanonicalEventVariant {
    const eventType = o['eventType'];
    const b = CartographerState.asObject(o['body']) ?? {};
    const envelope = {
      'shipmentId':        CartographerState.str(o['shipmentId']),
      'eventId':           CartographerState.str(o['eventId']),
      'epochMs':           CartographerState.num(o['epochMs']),
      'sourceId':          CartographerState.str(o['sourceId']),
      'sourceFormat':      CartographerState.canonicalSourceFormat(o['sourceFormat']),
      'sourceCompression': CartographerState.canonicalSourceCompression(o['sourceCompression']),
    } as const;
    const sharedBody = {
      'scanSeq':      CartographerState.num(b['scanSeq']),
      'latitude':     CartographerState.num(b['latitude']),
      'longitude':    CartographerState.num(b['longitude']),
      'ipAddress':    CartographerState.str(b['ipAddress']),
      'legFromLat':   CartographerState.num(b['legFromLat']),
      'legFromLng':   CartographerState.num(b['legFromLng']),
      'originLat':    CartographerState.num(b['originLat']),
      'originLng':    CartographerState.num(b['originLng']),
      'destLat':      CartographerState.num(b['destLat']),
      'destLng':      CartographerState.num(b['destLng']),
      'carrier':      CartographerState.str(b['carrier']),
      'status':       CartographerState.str(b['status']),
      'rawTimestamp': CartographerState.str(b['rawTimestamp']),
    } as const;
    let result: CanonicalEventVariant;
    switch (eventType) {
      case 'facility-scan': {
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
        const geoObjFs = CartographerState.asObject(o['geo']);
        if (geoObjFs !== null) variant.geo = { 'country': CartographerState.str(geoObjFs['country']), 'continent': CartographerState.str(geoObjFs['continent']), 'region': CartographerState.str(geoObjFs['region']) };
        if (typeof o['consentHandled'] === 'boolean') variant.consentHandled = o['consentHandled'];
        if (typeof o['pii'] === 'boolean') variant.pii = o['pii'];
        result = variant;
        break;
      }
      case 'sensor-reading': {
        const variant: SensorReadingEvent = {
          ...envelope, 'eventType': 'sensor-reading',
          'body': {
            ...sharedBody,
            'tempC':       CartographerState.num(b['tempC']),
            'humidityPct': CartographerState.num(b['humidityPct']),
            'shockG':      CartographerState.num(b['shockG']),
          },
        };
        const geoObjSr = CartographerState.asObject(o['geo']);
        if (geoObjSr !== null) variant.geo = { 'country': CartographerState.str(geoObjSr['country']), 'continent': CartographerState.str(geoObjSr['continent']), 'region': CartographerState.str(geoObjSr['region']) };
        if (typeof o['consentHandled'] === 'boolean') variant.consentHandled = o['consentHandled'];
        if (typeof o['pii'] === 'boolean') variant.pii = o['pii'];
        result = variant;
        break;
      }
      case 'customs-event': {
        const variant: CustomsEvent = {
          ...envelope, 'eventType': 'customs-event',
          'body': { ...sharedBody, 'customsStatus': CartographerState.str(b['customsStatus']) },
        };
        const geoObjCe = CartographerState.asObject(o['geo']);
        if (geoObjCe !== null) variant.geo = { 'country': CartographerState.str(geoObjCe['country']), 'continent': CartographerState.str(geoObjCe['continent']), 'region': CartographerState.str(geoObjCe['region']) };
        if (typeof o['consentHandled'] === 'boolean') variant.consentHandled = o['consentHandled'];
        if (typeof o['pii'] === 'boolean') variant.pii = o['pii'];
        result = variant;
        break;
      }
      case 'delivery-confirmation': {
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
        const geoObjDc = CartographerState.asObject(o['geo']);
        if (geoObjDc !== null) variant.geo = { 'country': CartographerState.str(geoObjDc['country']), 'continent': CartographerState.str(geoObjDc['continent']), 'region': CartographerState.str(geoObjDc['region']) };
        if (typeof o['consentHandled'] === 'boolean') variant.consentHandled = o['consentHandled'];
        if (typeof o['pii'] === 'boolean') variant.pii = o['pii'];
        result = variant;
        break;
      }
      default: {
        // 'position-ping' and any unrecognised value fall here
        const variant: PositionPingEvent = { ...envelope, 'eventType': 'position-ping', 'body': { ...sharedBody } };
        const geoObjPp = CartographerState.asObject(o['geo']);
        if (geoObjPp !== null) variant.geo = { 'country': CartographerState.str(geoObjPp['country']), 'continent': CartographerState.str(geoObjPp['continent']), 'region': CartographerState.str(geoObjPp['region']) };
        if (typeof o['consentHandled'] === 'boolean') variant.consentHandled = o['consentHandled'];
        if (typeof o['pii'] === 'boolean') variant.pii = o['pii'];
        result = variant;
        break;
      }
    }
    return result;
  }

  private static sourceToJson(s: SourcePayload): JsonObject {
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
      .filter((li): li is Record<string, unknown> => li !== null)
      .map((li) => ({
        'productId': CartographerState.str(li['productId']),
        'quantity':  CartographerState.num(li['quantity'], 1),
      }));
    return items.length > 0 ? items : [{ 'productId': '', 'quantity': 1 }];
  }

  // ── Entity ↔ JSON reconstruction (field-by-field) ──────────────────────────
  private static enrichedToJson(e: EnrichedShipment): JsonObject {
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
      'reverseGeocodeRun': false,
      'ipGeolocateRun':    false,
      'ipGeolocateSkipped': false,
      'geoConfidence':     0,
      'geoModalities':     [],
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

  private static routingToJson(r: EnrichedShipment['routing']): JsonObject {
    return {
      'path':              r.path,
      'geoLookupRun':      r.geoLookupRun,
      'geoLookupSkipped':  r.geoLookupSkipped,
      'reverseGeocodeRun': r.reverseGeocodeRun,
      'ipGeolocateRun':    r.ipGeolocateRun,
      'ipGeolocateSkipped': r.ipGeolocateSkipped,
      'geoConfidence':     r.geoConfidence,
      'geoModalities':     [...r.geoModalities],
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
      'reverseGeocodeRun': CartographerState.bool(o['reverseGeocodeRun']),
      'ipGeolocateRun':    CartographerState.bool(o['ipGeolocateRun']),
      'ipGeolocateSkipped': CartographerState.bool(o['ipGeolocateSkipped']),
      'geoConfidence':     CartographerState.num(o['geoConfidence']),
      'geoModalities':     CartographerState.strArr(o['geoModalities']),
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
