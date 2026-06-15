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
 * Checkpoint/resume: snapshotData/restoreData round-trip every scalar.
 * The `events` generator is not checkpointed (it is re-seeded by the pre-phase
 * node on resume via `eventCount`). The scatter durable-inbox handles exactly-once
 * delivery; un-acked items are reprocessed from the inbox, not re-read from source.
 */

import type { CanonicalEvent } from './entities/CanonicalEvent.ts';
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
import type { FeedConfig } from './services.ts';

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
  readonly eventType: string;
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
  /** Number of synthetic journeys to generate (retained for backward compat with checkpoint/resume). */
  eventCount: number = 200;

  /**
   * Per-format feed configuration driving buildFromConfig. Each entry specifies
   * format, compression, and count; the total across entries is the effective
   * event count for the pipeline run.
   */
  feedConfig: FeedConfig = [
    { 'format': 'json',   'compression': 'none', 'count': 6 },
    { 'format': 'csv',    'compression': 'gzip', 'count': 4 },
    { 'format': 'ndjson', 'compression': 'gzip', 'count': 4 },
    { 'format': 'yaml',   'compression': 'none', 'count': 2 },
  ];

  /**
   * The multi-format source feeds, seeded by the seed phase node. Each is a
   * `{ sourceId, format, mappingKey, kind, payload }` — a different on-the-wire
   * encoding (JSON / CSV / gzip NDJSON) of a partition of the raw scan feed.
   */
  sources: SourcePayload[] = [];

  /**
   * Ingestion fan-in buckets: the `append` gather of the ingestion scatter
   * appends each source clone's `ingestedEvents` array as one element here, so
   * this is one bucket per source. The `merge-events` node flattens it into the
   * unified `canonicalEvents` collection.
   */
  ingestBuckets: CanonicalEvent[][] = [];

  /**
   * The unified canonical event collection. Every source's decoded events are
   * flattened into this one array (from `ingestBuckets`); the enrichment scatter
   * then reads it.
   */
  canonicalEvents: CanonicalEvent[] = [];

  // ── Per-source ingest slots (used inside a source's ingest sub-DAG clone) ──
  /** The source feed currently being ingested (set from `sources` by select). */
  currentSource: SourcePayload = {
    'sourceId':     '',
    'format':       'json',
    'compression':  'none',
    'mappingKey':   'json-position',
    'kind':         'position-ping',
    'payload':      '',
  };

  /** Decompressed/raw text of the current source (after `decompress`). */
  decodedText: string = '';

  /** Records parsed from the decoded text (after parse-csv/json/ndjson). */
  parsedRecords: Array<Record<string, unknown>> = [];

  /** Records with source field names mapped to canonical fields (after map-fields). */
  mappedRecords: Array<Record<string, unknown>> = [];

  /** Canonical events validated from this source (after coerce-types + validate-event). */
  ingestedEvents: CanonicalEvent[] = [];

  /** The single canonical event under enrichment in a scatter clone (set by parse). */
  canonical: CanonicalEvent = {
    'shipmentId':        '',
    'eventId':           '',
    'epochMs':           0,
    'kind':              'position-ping',
    'sourceId':          '',
    'sourceFormat':      'json',
    'sourceCompression': 'none',
    'body': {
      'scanSeq':          0,
      'latitude':         0,
      'longitude':        0,
      'ipAddress':        '',
      'legFromLat':       0,
      'legFromLng':       0,
      'originLat':        0,
      'originLng':        0,
      'destLat':          0,
      'destLng':          0,
      'carrier':          '',
      'facilityId':       '',
      'status':           '',
      'weight':           0,
      'weightUnit':       'kg',
      'lineItems':        [],
      'rawTimestamp':          '',
      'rawDispatchAt':         '',
      'rawPromisedDeliveryAt': '',
      'disruptionReason':      '',
      'tempC':            0,
      'humidityPct':      0,
      'shockG':           0,
      'customsStatus':    '',
      'delivered':        false,
      'recipientName':    '',
      'recipientEmail':   '',
      'recipientPhone':   '',
      'recipientAddress': '',
      'recipientCountry': '',
      'marketingConsent': false,
      'lawfulBasis':      'contract',
      'specialCategory':  'none',
    },
  };

  /** Enriched shipment records gathered from scatter clones. */
  records: EnrichedShipment[] = [];

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
    'eventType':        'SCAN',
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
    'status':           'unmapped',
    'lat':              0,
    'lng':              0,
    'coordsCoarsened':  false,
    'legKm':            0,
    'eventType':        'SCAN',
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
    copy.feedConfig  = this.feedConfig.map((e) => ({ ...e })) as FeedConfig;
    copy.sources    = this.sources.map((s) => ({ ...s }));
    copy.ingestBuckets = this.ingestBuckets.map((bucket) => bucket.map((e) => CartographerState.cloneCanonical(e)));
    copy.canonicalEvents = this.canonicalEvents.map((e) => CartographerState.cloneCanonical(e));
    copy.records    = [...this.records];
    copy.insights   = new Map(this.insights);
    copy.journeys   = new Map(this.journeys);

    copy.currentSource  = { ...this.currentSource };
    copy.decodedText    = this.decodedText;
    copy.parsedRecords  = this.parsedRecords.map((r) => ({ ...r }));
    copy.mappedRecords  = this.mappedRecords.map((r) => ({ ...r }));
    copy.ingestedEvents = this.ingestedEvents.map((e) => CartographerState.cloneCanonical(e));
    copy.canonical      = CartographerState.cloneCanonical(this.canonical);

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

    return copy;
  }
  // #endregion clone

  // #region snapshot-restore
  protected override snapshotData(): JsonObject {
    return {
      'eventCount': this.eventCount,
      'feedConfig': this.feedConfig.map((e) => ({ 'format': e.format, 'compression': e.compression, 'count': e.count })),
      'sources':    this.sources.map((s) => CartographerState.sourceToJson(s)),
      'ingestBuckets': this.ingestBuckets.map((bucket) => bucket.map((e) => CartographerState.canonicalToJson(e))),
      'canonicalEvents': this.canonicalEvents.map((e) => CartographerState.canonicalToJson(e)),
      'canonical':  CartographerState.canonicalToJson(this.canonical),
      'records':    this.records.map((r) => CartographerState.enrichedToJson(r)),
      'raw':        CartographerState.rawToJson(this.raw),
      'normalized': CartographerState.normalizedToJson(this.normalized),
      'currentEvent': CartographerState.eventToJson(this.currentEvent),
      'geoContext': {
        'gridZone':     this.geoContext.gridZone,
        'country':      this.geoContext.country,
        'continent':    this.geoContext.continent,
        'countries':    [...this.geoContext.countries],
        'region':       this.geoContext.region,
        'hub':          this.geoContext.hub,
        'status':       this.geoContext.status,
        'waterBodies':  [...this.geoContext.waterBodies],
        'timezone':     this.geoContext.timezone,
        'jurisdiction': this.geoContext.jurisdiction,
      },
      'pricedOrder': CartographerState.pricedOrderToJson(this.pricedOrder),
      'shippingQuote': {
        'distanceKm':   this.shippingQuote.distanceKm,
        'costUsdMinor': this.shippingQuote.costUsdMinor,
        'breakdown': { ...this.shippingQuote.breakdown },
      },
      'deliveryEstimate': {
        'transitHours':    this.deliveryEstimate.transitHours,
        'etaEpochMs':      this.deliveryEstimate.etaEpochMs,
        'etaIso':          this.deliveryEstimate.etaIso,
        'promisedEpochMs': this.deliveryEstimate.promisedEpochMs,
        'onTime':          this.deliveryEstimate.onTime,
        'delayHours':      this.deliveryEstimate.delayHours,
      },
      'legKm': this.legKm,
      'coldChainBreach': this.coldChainBreach,
      'customsDwellHours': this.customsDwellHours,
      'routing': {
        'path':             this.routing.path,
        'geoLookupRun':     this.routing.geoLookupRun,
        'geoLookupSkipped': this.routing.geoLookupSkipped,
        'redactionRun':     this.routing.redactionRun,
        'redactionSkipped': this.routing.redactionSkipped,
        'pricingRun':       this.routing.pricingRun,
        'pricingSkipped':   this.routing.pricingSkipped,
        'etaRun':           this.routing.etaRun,
        'etaSkipped':       this.routing.etaSkipped,
        'coldChainRun':     this.routing.coldChainRun,
        'customsDwellRun':  this.routing.customsDwellRun,
      },
      'gdprResult': {
        'personalDataFields':  [...this.gdprResult.personalDataFields],
        'sensitiveDataFields': [...this.gdprResult.sensitiveDataFields],
        'consentStatus':   this.gdprResult.consentStatus,
        'lawfulBasis':     this.gdprResult.lawfulBasis,
        'jurisdiction':    this.gdprResult.jurisdiction,
        'strictness':      this.gdprResult.strictness,
        'complianceScore': this.gdprResult.complianceScore,
        'retention': {
          'retainUntil': this.gdprResult.retention.retainUntil,
          'autoDelete':  this.gdprResult.retention.autoDelete,
        },
        'redactionApplied': this.gdprResult.redactionApplied,
        'marketingAnalyticsEligible': this.gdprResult.marketingAnalyticsEligible,
        'coordsCoarsened': this.gdprResult.coordsCoarsened,
      },
      'enriched': CartographerState.enrichedToJson(this.enriched),
    };
  }

  protected override restoreData(snap: JsonObject): void {
    if (typeof snap['eventCount'] === 'number') this.eventCount = snap['eventCount'];
    if (Array.isArray(snap['feedConfig'])) {
      const loaded: FeedConfig = (snap['feedConfig'] as unknown[])
        .map((e) => CartographerState.asObject(e as unknown))
        .filter((e): e is Record<string, unknown> => e !== null)
        .map((e): { readonly format: 'csv' | 'json' | 'ndjson' | 'yaml'; readonly compression: 'none' | 'gzip'; readonly count: number } => ({
          'format':      (e['format'] === 'csv' || e['format'] === 'json' || e['format'] === 'ndjson' || e['format'] === 'yaml') ? e['format'] : 'json',
          'compression': (e['compression'] === 'none' || e['compression'] === 'gzip') ? e['compression'] : 'none',
          'count':       typeof e['count'] === 'number' ? e['count'] : 0,
        }));
      if (loaded.length > 0) this.feedConfig = loaded;
    }
    if (Array.isArray(snap['sources'])) {
      this.sources = snap['sources'].map((s) => CartographerState.sourceFromJson(CartographerState.asObject(s) ?? {}));
    }
    if (Array.isArray(snap['ingestBuckets'])) {
      this.ingestBuckets = snap['ingestBuckets'].map((bucket) =>
        Array.isArray(bucket)
          ? bucket.map((e) => CartographerState.canonicalFromJson(CartographerState.asObject(e) ?? {}))
          : [],
      );
    }
    if (Array.isArray(snap['canonicalEvents'])) {
      this.canonicalEvents = snap['canonicalEvents'].map((e) => CartographerState.canonicalFromJson(CartographerState.asObject(e) ?? {}));
    }
    const canObj = CartographerState.asObject(snap['canonical']);
    if (canObj !== null) this.canonical = CartographerState.canonicalFromJson(canObj);
    if (Array.isArray(snap['records'])) {
      this.records = snap['records'].map((r) => CartographerState.enrichedFromJson(CartographerState.asObject(r) ?? {}));
    }

    const rawObj = CartographerState.asObject(snap['raw']);
    if (rawObj !== null) this.raw = CartographerState.rawFromJson(rawObj);

    const normObj = CartographerState.asObject(snap['normalized']);
    if (normObj !== null) this.normalized = CartographerState.normalizedFromJson(normObj);

    const ceObj = CartographerState.asObject(snap['currentEvent']);
    if (ceObj !== null) this.currentEvent = CartographerState.eventFromJson(ceObj);

    const gcObj = CartographerState.asObject(snap['geoContext']);
    if (gcObj !== null) {
      this.geoContext = {
        'gridZone':     CartographerState.str(gcObj['gridZone']),
        'country':      CartographerState.str(gcObj['country']),
        'continent':    CartographerState.str(gcObj['continent'], 'Unmapped'),
        'countries':    CartographerState.strArr(gcObj['countries']),
        'region':       CartographerState.str(gcObj['region']),
        'hub':          CartographerState.str(gcObj['hub']),
        'status':       CartographerState.geoStatus(gcObj['status']),
        'waterBodies':  CartographerState.strArr(gcObj['waterBodies']),
        'timezone':     CartographerState.str(gcObj['timezone'], 'UTC'),
        'jurisdiction': CartographerState.jurisdiction(gcObj['jurisdiction']),
      };
    }

    const poObj = CartographerState.asObject(snap['pricedOrder']);
    if (poObj !== null) this.pricedOrder = CartographerState.pricedOrderFromJson(poObj);

    const sqObj = CartographerState.asObject(snap['shippingQuote']);
    if (sqObj !== null) {
      const bdObj = CartographerState.asObject(sqObj['breakdown']) ?? {};
      this.shippingQuote = {
        'distanceKm':   CartographerState.num(sqObj['distanceKm']),
        'costUsdMinor': CartographerState.num(sqObj['costUsdMinor']),
        'breakdown': {
          'baseMinor':      CartographerState.num(bdObj['baseMinor']),
          'perKmMinor':     CartographerState.num(bdObj['perKmMinor']),
          'perKgMinor':     CartographerState.num(bdObj['perKgMinor']),
          'tierMultiplier': CartographerState.num(bdObj['tierMultiplier'], 1.0),
        },
      };
    }

    const deObj = CartographerState.asObject(snap['deliveryEstimate']);
    if (deObj !== null) {
      this.deliveryEstimate = {
        'transitHours':    CartographerState.num(deObj['transitHours']),
        'etaEpochMs':      CartographerState.num(deObj['etaEpochMs']),
        'etaIso':          CartographerState.str(deObj['etaIso']),
        'promisedEpochMs': CartographerState.num(deObj['promisedEpochMs']),
        'onTime':          CartographerState.bool(deObj['onTime']),
        'delayHours':      CartographerState.num(deObj['delayHours']),
      };
    }

    if (typeof snap['legKm'] === 'number') this.legKm = snap['legKm'];
    if (typeof snap['coldChainBreach'] === 'boolean') this.coldChainBreach = snap['coldChainBreach'];
    if (typeof snap['customsDwellHours'] === 'number') this.customsDwellHours = snap['customsDwellHours'];

    if (snap['routing'] !== undefined) this.routing = CartographerState.routingFromJson(snap['routing']);

    const grObj = CartographerState.asObject(snap['gdprResult']);
    if (grObj !== null) {
      const retObj = CartographerState.asObject(grObj['retention']) ?? {};
      this.gdprResult = {
        'personalDataFields':  CartographerState.strArr(grObj['personalDataFields']),
        'sensitiveDataFields': CartographerState.strArr(grObj['sensitiveDataFields']),
        'consentStatus':    CartographerState.consentStatus(grObj['consentStatus']),
        'lawfulBasis':      CartographerState.lawfulBasis(grObj['lawfulBasis']),
        'jurisdiction':     CartographerState.jurisdiction(grObj['jurisdiction']),
        'strictness':       CartographerState.strictness(grObj['strictness']),
        'complianceScore':  CartographerState.num(grObj['complianceScore']),
        'retention': {
          'retainUntil': CartographerState.str(retObj['retainUntil']),
          'autoDelete':  CartographerState.bool(retObj['autoDelete']),
        },
        'redactionApplied': CartographerState.bool(grObj['redactionApplied']),
        'marketingAnalyticsEligible': CartographerState.bool(grObj['marketingAnalyticsEligible']),
        'coordsCoarsened':  CartographerState.bool(grObj['coordsCoarsened']),
      };
    }

    const enObj = CartographerState.asObject(snap['enriched']);
    if (enObj !== null) this.enriched = CartographerState.enrichedFromJson(enObj);
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

  // ── CanonicalEvent / SourcePayload narrowers + reconstruction ──────────────
  private static canonicalKind(value: unknown): CanonicalEvent['kind'] {
    return value === 'position-ping' || value === 'facility-scan' || value === 'sensor-reading'
      || value === 'customs-event' || value === 'delivery-confirmation'
      ? value
      : 'position-ping';
  }

  private static sourceFormat(value: unknown): SourcePayload['format'] {
    return value === 'csv' || value === 'json' || value === 'ndjson' || value === 'yaml' ? value : 'json';
  }

  private static canonicalSourceFormat(value: unknown): CanonicalEvent['sourceFormat'] {
    return value === 'csv' || value === 'json' || value === 'ndjson' || value === 'yaml' ? value : 'json';
  }

  private static canonicalSourceCompression(value: unknown): CanonicalEvent['sourceCompression'] {
    return value === 'none' || value === 'gzip' ? value : 'none';
  }

  /** Deep-clone a CanonicalEvent (body + optional geo) for V8-stable copies. */
  private static cloneCanonical(e: CanonicalEvent): CanonicalEvent {
    const copy: CanonicalEvent = {
      'shipmentId':        e.shipmentId,
      'eventId':           e.eventId,
      'epochMs':           e.epochMs,
      'kind':              e.kind,
      'sourceId':          e.sourceId,
      'sourceFormat':      e.sourceFormat,
      'sourceCompression': e.sourceCompression,
      'body':              { ...e.body, 'lineItems': e.body.lineItems.map((li) => ({ ...li })) },
    };
    if (e.geo !== undefined) copy.geo = { ...e.geo };
    if (e.consentHandled !== undefined) copy.consentHandled = e.consentHandled;
    if (e.pii !== undefined) copy.pii = e.pii;
    return copy;
  }

  private static canonicalToJson(e: CanonicalEvent): JsonObject {
    const body: JsonObject = {
      'scanSeq':          e.body.scanSeq,
      'latitude':         e.body.latitude,
      'longitude':        e.body.longitude,
      'ipAddress':        e.body.ipAddress,
      'legFromLat':       e.body.legFromLat,
      'legFromLng':       e.body.legFromLng,
      'originLat':        e.body.originLat,
      'originLng':        e.body.originLng,
      'destLat':          e.body.destLat,
      'destLng':          e.body.destLng,
      'carrier':          e.body.carrier,
      'facilityId':       e.body.facilityId,
      'status':           e.body.status,
      'weight':           e.body.weight,
      'weightUnit':       e.body.weightUnit,
      'lineItems':        e.body.lineItems.map((li) => ({ 'productId': li.productId, 'quantity': li.quantity })),
      'rawTimestamp':          e.body.rawTimestamp,
      'rawDispatchAt':         e.body.rawDispatchAt,
      'rawPromisedDeliveryAt': e.body.rawPromisedDeliveryAt,
      'disruptionReason':      e.body.disruptionReason,
      'tempC':            e.body.tempC,
      'humidityPct':      e.body.humidityPct,
      'shockG':           e.body.shockG,
      'customsStatus':    e.body.customsStatus,
      'delivered':        e.body.delivered,
      'recipientName':    e.body.recipientName,
      'recipientEmail':   e.body.recipientEmail,
      'recipientPhone':   e.body.recipientPhone,
      'recipientAddress': e.body.recipientAddress,
      'recipientCountry': e.body.recipientCountry,
      'marketingConsent': e.body.marketingConsent,
      'lawfulBasis':      e.body.lawfulBasis,
      'specialCategory':  e.body.specialCategory,
    };
    return {
      'shipmentId':        e.shipmentId,
      'eventId':           e.eventId,
      'epochMs':           e.epochMs,
      'kind':              e.kind,
      'sourceId':          e.sourceId,
      'sourceFormat':      e.sourceFormat,
      'sourceCompression': e.sourceCompression,
      'body':              body,
      'geo':               e.geo !== undefined ? { 'country': e.geo.country, 'continent': e.geo.continent, 'region': e.geo.region } : null,
      'consentHandled':    e.consentHandled !== undefined ? e.consentHandled : null,
      'pii':               e.pii !== undefined ? e.pii : null,
    };
  }

  private static canonicalFromJson(o: Record<string, unknown>): CanonicalEvent {
    const b = CartographerState.asObject(o['body']) ?? {};
    const event: CanonicalEvent = {
      'shipmentId':        CartographerState.str(o['shipmentId']),
      'eventId':           CartographerState.str(o['eventId']),
      'epochMs':           CartographerState.num(o['epochMs']),
      'kind':              CartographerState.canonicalKind(o['kind']),
      'sourceId':          CartographerState.str(o['sourceId']),
      'sourceFormat':      CartographerState.canonicalSourceFormat(o['sourceFormat']),
      'sourceCompression': CartographerState.canonicalSourceCompression(o['sourceCompression']),
      'body': {
        'scanSeq':          CartographerState.num(b['scanSeq']),
        'latitude':         CartographerState.num(b['latitude']),
        'longitude':        CartographerState.num(b['longitude']),
        'ipAddress':        CartographerState.str(b['ipAddress']),
        'legFromLat':       CartographerState.num(b['legFromLat']),
        'legFromLng':       CartographerState.num(b['legFromLng']),
        'originLat':        CartographerState.num(b['originLat']),
        'originLng':        CartographerState.num(b['originLng']),
        'destLat':          CartographerState.num(b['destLat']),
        'destLng':          CartographerState.num(b['destLng']),
        'carrier':          CartographerState.str(b['carrier']),
        'facilityId':       CartographerState.str(b['facilityId']),
        'status':           CartographerState.str(b['status']),
        'weight':           CartographerState.num(b['weight']),
        'weightUnit':       CartographerState.weightUnit(b['weightUnit']),
        'lineItems':        CartographerState.lineItemsFromJson(b['lineItems']),
        'rawTimestamp':          CartographerState.str(b['rawTimestamp']),
        'rawDispatchAt':         CartographerState.str(b['rawDispatchAt']),
        'rawPromisedDeliveryAt': CartographerState.str(b['rawPromisedDeliveryAt']),
        'disruptionReason':      CartographerState.str(b['disruptionReason']),
        'tempC':            CartographerState.num(b['tempC']),
        'humidityPct':      CartographerState.num(b['humidityPct']),
        'shockG':           CartographerState.num(b['shockG']),
        'customsStatus':    CartographerState.str(b['customsStatus']),
        'delivered':        CartographerState.bool(b['delivered']),
        'recipientName':    CartographerState.str(b['recipientName']),
        'recipientEmail':   CartographerState.str(b['recipientEmail']),
        'recipientPhone':   CartographerState.str(b['recipientPhone']),
        'recipientAddress': CartographerState.str(b['recipientAddress']),
        'recipientCountry': CartographerState.str(b['recipientCountry']),
        'marketingConsent': CartographerState.bool(b['marketingConsent']),
        'lawfulBasis':      CartographerState.lawfulBasis(b['lawfulBasis']),
        'specialCategory':  CartographerState.specialCategory(b['specialCategory']),
      },
    };
    const geoObj = CartographerState.asObject(o['geo']);
    if (geoObj !== null) {
      event.geo = {
        'country':   CartographerState.str(geoObj['country']),
        'continent': CartographerState.str(geoObj['continent']),
        'region':    CartographerState.str(geoObj['region']),
      };
    }
    if (typeof o['consentHandled'] === 'boolean') event.consentHandled = o['consentHandled'];
    if (typeof o['pii'] === 'boolean') event.pii = o['pii'];
    return event;
  }

  private static sourceToJson(s: SourcePayload): JsonObject {
    return {
      'sourceId':    s.sourceId,
      'format':      s.format,
      'compression': s.compression,
      'mappingKey':  s.mappingKey,
      'kind':        s.kind,
      'payload':     s.payload,
    };
  }

  private static sourceFromJson(o: Record<string, unknown>): SourcePayload {
    return {
      'sourceId':    CartographerState.str(o['sourceId']),
      'format':      CartographerState.sourceFormat(o['format']),
      'compression': (o['compression'] === 'none' || o['compression'] === 'gzip') ? o['compression'] : 'none',
      'mappingKey':  CartographerState.str(o['mappingKey'], 'json-position'),
      'kind':        CartographerState.canonicalKind(o['kind']),
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

  private static strictness(value: unknown): GdprResult['strictness'] {
    return value === 'strict' || value === 'moderate' || value === 'light' ? value : 'light';
  }

  private static eventType(value: unknown): ShipmentEvent['eventType'] {
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
  private static rawToJson(r: RawShipmentEvent): JsonObject {
    return {
      'shipmentId': r.shipmentId, 'scanSeq': r.scanSeq, 'rawTimestamp': r.rawTimestamp,
      'rawDispatchAt': r.rawDispatchAt, 'rawStatus': r.rawStatus,
      'carrier': r.carrier, 'ipAddress': r.ipAddress, 'latitude': r.latitude, 'longitude': r.longitude,
      'legFromLat': r.legFromLat, 'legFromLng': r.legFromLng,
      'originLat': r.originLat, 'originLng': r.originLng, 'destLat': r.destLat, 'destLng': r.destLng,
      'weight': r.weight, 'weightUnit': r.weightUnit,
      'recipientName': r.recipientName, 'recipientEmail': r.recipientEmail, 'recipientPhone': r.recipientPhone,
      'recipientAddress': r.recipientAddress, 'recipientCountry': r.recipientCountry,
      'marketingConsent': r.marketingConsent, 'rawPromisedDeliveryAt': r.rawPromisedDeliveryAt,
      'lineItems': r.lineItems.map((li) => ({ 'productId': li.productId, 'quantity': li.quantity })),
      'facilityId': r.facilityId, 'lawfulBasis': r.lawfulBasis, 'specialCategory': r.specialCategory,
      'disruptionReason': r.disruptionReason,
    };
  }

  private static rawFromJson(o: Record<string, unknown>): RawShipmentEvent {
    return {
      'shipmentId': CartographerState.str(o['shipmentId']),
      'scanSeq': CartographerState.num(o['scanSeq']),
      'rawTimestamp': CartographerState.str(o['rawTimestamp']),
      'rawDispatchAt': CartographerState.str(o['rawDispatchAt']),
      'rawStatus': CartographerState.str(o['rawStatus']),
      'carrier': CartographerState.str(o['carrier']),
      'ipAddress': CartographerState.str(o['ipAddress']),
      'latitude': CartographerState.num(o['latitude']),
      'longitude': CartographerState.num(o['longitude']),
      'legFromLat': CartographerState.num(o['legFromLat']),
      'legFromLng': CartographerState.num(o['legFromLng']),
      'originLat': CartographerState.num(o['originLat']),
      'originLng': CartographerState.num(o['originLng']),
      'destLat': CartographerState.num(o['destLat']),
      'destLng': CartographerState.num(o['destLng']),
      'weight': CartographerState.num(o['weight']),
      'weightUnit': CartographerState.weightUnit(o['weightUnit']),
      'recipientName': CartographerState.str(o['recipientName']),
      'recipientEmail': CartographerState.str(o['recipientEmail']),
      'recipientPhone': CartographerState.str(o['recipientPhone']),
      'recipientAddress': CartographerState.str(o['recipientAddress']),
      'recipientCountry': CartographerState.str(o['recipientCountry']),
      'marketingConsent': CartographerState.bool(o['marketingConsent']),
      'rawPromisedDeliveryAt': CartographerState.str(o['rawPromisedDeliveryAt']),
      'lineItems': CartographerState.lineItemsFromJson(o['lineItems']),
      'facilityId': CartographerState.str(o['facilityId']),
      'lawfulBasis': CartographerState.lawfulBasis(o['lawfulBasis']),
      'specialCategory': CartographerState.specialCategory(o['specialCategory']),
      'disruptionReason': CartographerState.str(o['disruptionReason']),
    };
  }

  private static normalizedToJson(n: NormalizedShipment): JsonObject {
    return {
      'shipmentId': n.shipmentId, 'scanSeq': n.scanSeq, 'epochMs': n.epochMs, 'dispatchEpochMs': n.dispatchEpochMs,
      'isoTimestamp': n.isoTimestamp, 'localIso': n.localIso, 'utcOffset': n.utcOffset,
      'carrierId': n.carrierId, 'carrierName': n.carrierName, 'countryIso3': n.countryIso3,
      'weightGrams': n.weightGrams, 'eventType': n.eventType, 'serviceTier': n.serviceTier, 'sizeTier': n.sizeTier,
      'lineItems': n.lineItems.map((li) => ({ 'productId': li.productId, 'quantity': li.quantity })),
      'facilityId': n.facilityId, 'latitude': n.latitude, 'longitude': n.longitude,
      'legFromLat': n.legFromLat, 'legFromLng': n.legFromLng,
      'originLat': n.originLat, 'originLng': n.originLng, 'destLat': n.destLat, 'destLng': n.destLng,
      'recipientName': n.recipientName, 'recipientEmail': n.recipientEmail, 'recipientPhone': n.recipientPhone,
      'recipientAddress': n.recipientAddress, 'recipientCountry': n.recipientCountry,
      'marketingConsent': n.marketingConsent, 'promisedEpochMs': n.promisedEpochMs,
      'disruptionHours': n.disruptionHours, 'disruptionReason': n.disruptionReason,
    };
  }

  private static normalizedFromJson(o: Record<string, unknown>): NormalizedShipment {
    return {
      'shipmentId': CartographerState.str(o['shipmentId']),
      'scanSeq': CartographerState.num(o['scanSeq']),
      'epochMs': CartographerState.num(o['epochMs']),
      'dispatchEpochMs': CartographerState.num(o['dispatchEpochMs']),
      'isoTimestamp': CartographerState.str(o['isoTimestamp']),
      'localIso': CartographerState.str(o['localIso']),
      'utcOffset': CartographerState.str(o['utcOffset']),
      'carrierId': CartographerState.str(o['carrierId']),
      'carrierName': CartographerState.str(o['carrierName']),
      'countryIso3': CartographerState.str(o['countryIso3'], 'UNK'),
      'weightGrams': CartographerState.num(o['weightGrams']),
      'eventType': CartographerState.eventType(o['eventType']),
      'serviceTier': CartographerState.serviceTier(o['serviceTier']),
      'sizeTier': CartographerState.sizeTier(o['sizeTier']),
      'lineItems': CartographerState.lineItemsFromJson(o['lineItems']),
      'facilityId': CartographerState.str(o['facilityId']),
      'latitude': CartographerState.num(o['latitude']),
      'longitude': CartographerState.num(o['longitude']),
      'legFromLat': CartographerState.num(o['legFromLat']),
      'legFromLng': CartographerState.num(o['legFromLng']),
      'originLat': CartographerState.num(o['originLat']),
      'originLng': CartographerState.num(o['originLng']),
      'destLat': CartographerState.num(o['destLat']),
      'destLng': CartographerState.num(o['destLng']),
      'recipientName': CartographerState.str(o['recipientName']),
      'recipientEmail': CartographerState.str(o['recipientEmail']),
      'recipientPhone': CartographerState.str(o['recipientPhone']),
      'recipientAddress': CartographerState.str(o['recipientAddress']),
      'recipientCountry': CartographerState.str(o['recipientCountry']),
      'marketingConsent': CartographerState.bool(o['marketingConsent']),
      'promisedEpochMs': CartographerState.num(o['promisedEpochMs']),
      'disruptionHours': CartographerState.num(o['disruptionHours']),
      'disruptionReason': CartographerState.str(o['disruptionReason']),
    };
  }

  private static eventToJson(e: ShipmentEvent): JsonObject {
    return {
      'shipmentId': e.shipmentId, 'timestamp': e.timestamp, 'eventType': e.eventType,
      'latitude': e.latitude, 'longitude': e.longitude, 'carrier': e.carrier, 'facilityId': e.facilityId,
      'recipientName': e.recipientName, 'recipientEmail': e.recipientEmail, 'recipientPhone': e.recipientPhone,
      'recipientAddress': e.recipientAddress, 'recipientCountry': e.recipientCountry,
      'marketingConsent': e.marketingConsent, 'promisedDeliveryAt': e.promisedDeliveryAt,
    };
  }

  private static eventFromJson(o: Record<string, unknown>): ShipmentEvent {
    return {
      'shipmentId': CartographerState.str(o['shipmentId']),
      'timestamp': CartographerState.str(o['timestamp']),
      'eventType': CartographerState.eventType(o['eventType']),
      'latitude': CartographerState.num(o['latitude']),
      'longitude': CartographerState.num(o['longitude']),
      'carrier': CartographerState.str(o['carrier']),
      'facilityId': CartographerState.str(o['facilityId']),
      'recipientName': CartographerState.str(o['recipientName']),
      'recipientEmail': CartographerState.str(o['recipientEmail']),
      'recipientPhone': CartographerState.str(o['recipientPhone']),
      'recipientAddress': CartographerState.str(o['recipientAddress']),
      'recipientCountry': CartographerState.str(o['recipientCountry']),
      'marketingConsent': CartographerState.bool(o['marketingConsent']),
      'promisedDeliveryAt': CartographerState.str(o['promisedDeliveryAt']),
    };
  }

  private static pricedOrderToJson(p: PricedOrder): JsonObject {
    return {
      'lines': p.lines.map((l) => ({
        'productId': l.productId, 'name': l.name, 'category': l.category, 'quantity': l.quantity,
        'unitPriceMinor': l.unitPriceMinor, 'currency': l.currency, 'lineTotalMinor': l.lineTotalMinor,
      })),
      'subtotalMinor': p.subtotalMinor, 'currency': p.currency,
      'subtotalUsdMinor': p.subtotalUsdMinor, 'fxRate': p.fxRate,
    };
  }

  private static pricedOrderFromJson(o: Record<string, unknown>): PricedOrder {
    const lines = Array.isArray(o['lines'])
      ? o['lines']
          .map((l) => CartographerState.asObject(l))
          .filter((l): l is Record<string, unknown> => l !== null)
          .map((l) => ({
            'productId': CartographerState.str(l['productId']),
            'name': CartographerState.str(l['name']),
            'category': CartographerState.str(l['category']),
            'quantity': CartographerState.num(l['quantity'], 1),
            'unitPriceMinor': CartographerState.num(l['unitPriceMinor']),
            'currency': CartographerState.str(l['currency'], 'USD'),
            'lineTotalMinor': CartographerState.num(l['lineTotalMinor']),
          }))
      : [];
    return {
      'lines': lines,
      'subtotalMinor': CartographerState.num(o['subtotalMinor']),
      'currency': CartographerState.str(o['currency'], 'USD'),
      'subtotalUsdMinor': CartographerState.num(o['subtotalUsdMinor']),
      'fxRate': CartographerState.num(o['fxRate'], 1.0),
    };
  }

  private static enrichedToJson(e: EnrichedShipment): JsonObject {
    return {
      'shipmentId': e.shipmentId, 'scanSeq': e.scanSeq, 'epochMs': e.epochMs,
      'localIso': e.localIso, 'utcOffset': e.utcOffset, 'timezone': e.timezone, 'jurisdiction': e.jurisdiction,
      'continent': e.continent, 'region': e.region, 'country': e.country, 'hub': e.hub, 'status': e.status,
      'lat': e.lat, 'lng': e.lng, 'coordsCoarsened': e.coordsCoarsened, 'legKm': e.legKm,
      'eventType': e.eventType, 'serviceTier': e.serviceTier, 'sizeTier': e.sizeTier,
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
      'status': CartographerState.geoStatus(o['status']),
      'lat': CartographerState.num(o['lat']),
      'lng': CartographerState.num(o['lng']),
      'coordsCoarsened': CartographerState.bool(o['coordsCoarsened']),
      'legKm': CartographerState.num(o['legKm']),
      'eventType': CartographerState.eventType(o['eventType']),
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
