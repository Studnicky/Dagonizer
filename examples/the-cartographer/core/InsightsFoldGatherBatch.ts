/**
 * InsightsFoldGatherBatch: incremental, bounded gather strategy that reads
 * `state.enrichedBatch` (an `EnrichedShipment[]`) off each scatter clone and
 * folds EACH element using the same foldRegion / foldJourney / pushSampleRing
 * logic as `InsightsFoldGather`.
 *
 * This is the Wave-1 batch-path companion to `InsightsFoldGather`. The per-event
 * gather is UNCHANGED. This strategy coexists with it under the name
 * `'insights-fold-batch'`.
 *
 * Registered as 'insights-fold-batch' at module load.
 */

import { GatherStrategies, GatherStrategy } from '@noocodex/dagonizer/core';
import type { GatherExecution, GatherRecord } from '@noocodex/dagonizer/core';
import type { GatherConfig } from '@noocodex/dagonizer';
import type { NodeStateInterface } from '@noocodex/dagonizer';
import type { StateAccessor } from '@noocodex/dagonizer/contracts';

import type { EnrichedShipment } from '../entities/EnrichedShipment.ts';
import type { JourneyInsights, JourneyScan, RegionInsights } from '../CartographerState.ts';

// ── Module constants ───────────────────────────────────────────────────────────

const MAX_SAMPLE_JOURNEYS = 100;
const MAX_SAMPLE_RECORDS  = 200;
const MAX_SCANS_PER_JOURNEY = 64;

// ── Internal accumulator type ─────────────────────────────────────────────────

/** Internal accumulator for per-journey incremental folding. */
interface JourneyAccumulator {
  scans:             JourneyScan[];
  /** True scan count for this journey, maintained even when `scans` is capped. */
  scanCount:         number;
  pathKm:            number;
  minEpoch:          number;
  maxEpoch:          number;
  offsets:           string[];
  timezones:         string[];
  jurisdictions:     string[];
  statusProgression: string[];
  delivered:         boolean;
  /** True once order-lane facts have been captured from an etaRun scan. */
  etaCaptured:       boolean;
  onTime:            boolean;
  delayHours:        number;
  subtotalUsdMinor:  number;
  shippingUsdMinor:  number;
}

// ── InsightsFoldGatherBatch ────────────────────────────────────────────────────

export class InsightsFoldGatherBatch extends GatherStrategy {
  readonly name = 'insights-fold-batch';

  // Per-execution accumulators (reset in initial() before each scatter).
  private regionMap:    Map<string, RegionInsights>      = new Map();
  private journeyMap:   Map<string, JourneyAccumulator>  = new Map();
  private sampleRing:   EnrichedShipment[]               = [];

  // ── initial: reset accumulators and parent state targets ─────────────────

  override initial(
    _config: GatherConfig,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    this.regionMap  = new Map();
    this.journeyMap = new Map();
    this.sampleRing = [];

    accessor.set(state, 'insights',      new Map());
    accessor.set(state, 'journeys',      new Map());
    accessor.set(state, 'sampleRecords', []);
  }

  // ── reduce: per-clone fold — reads enrichedBatch, folds each element ──────

  override reduce(
    _config: GatherConfig,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    for (const item of batch) {
      const record: GatherRecord<NodeStateInterface> = item.state;
      const enrichedBatch = accessor.get<EnrichedShipment[]>(record.cloneState, 'enrichedBatch');
      if (!Array.isArray(enrichedBatch)) continue;

      for (const enriched of enrichedBatch) {
        if (!enriched.shipmentId) continue;
        this.foldRegion(enriched, state, accessor);
        this.foldJourney(enriched);
        this.pushSampleRing(enriched, state, accessor);
      }
    }
  }

  // ── finalize: build state.journeys from bounded accumulators ─────────────

  override async finalize(
    _config: GatherConfig,
    execution: GatherExecution<NodeStateInterface>,
  ): Promise<void> {
    const built = new Map<string, JourneyInsights>();

    for (const [shipmentId, acc] of this.journeyMap) {
      const scans = [...acc.scans].sort(
        (a, b) => a.scanSeq - b.scanSeq || a.epochMs - b.epochMs,
      );
      if (scans.length === 0) continue;

      const last = scans[scans.length - 1];
      if (last === undefined) continue;

      const statusProgression = [...acc.statusProgression];
      if (acc.delivered && !statusProgression.includes('DELIVERED')) {
        statusProgression.push('DELIVERED');
      }

      const journey: JourneyInsights = {
        'shipmentId':        shipmentId,
        'scans':             scans,
        'scanCount':         acc.scanCount,
        'pathKm':            acc.pathKm,
        'firstEpochMs':      acc.minEpoch,
        'lastEpochMs':       acc.maxEpoch,
        'elapsedHours':      (acc.maxEpoch - acc.minEpoch) / 3_600_000,
        'timezones':         [...acc.timezones],
        'offsets':           [...acc.offsets],
        'jurisdictions':     [...acc.jurisdictions],
        'statusProgression': statusProgression,
        'lastStatus':        last.status,
        'lastHub':           last.hub,
        'delivered':         acc.delivered,
        'onTime':            acc.onTime,
        'delayHours':        acc.delayHours,
        'subtotalUsdMinor':  acc.subtotalUsdMinor,
        'shippingUsdMinor':  acc.shippingUsdMinor,
      };
      built.set(shipmentId, journey);
    }

    execution.accessor.set(execution.state, 'journeys', built);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Fold one enriched scan into the per-region accumulator and update parent state. */
  private foldRegion(
    enriched: EnrichedShipment,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    const key = enriched.geoStatus === 'water'
      ? 'International Waters / Maritime'
      : enriched.continent;

    let entry = this.regionMap.get(key);
    if (entry === undefined) {
      entry = {
        'region':                key,
        'country':               key,
        'hub':                   key,
        'deliveries':            0,
        'exceptions':            0,
        'onTimeCount':           0,
        'lateCount':             0,
        'totalSubtotalUsdMinor': 0,
        'totalShippingUsdMinor': 0,
        'totalDistanceKm':       0,
        'totalDelayHours':       0,
        'consentValid':          0,
        'consentMissing':        0,
        'consentExpired':        0,
        'sizeTierEnvelope':      0,
        'sizeTierSmall':         0,
        'sizeTierMedium':        0,
        'sizeTierLarge':         0,
        'sizeTierFreight':       0,
        'shipmentCount':         0,
      };
      this.regionMap.set(key, entry);
    }

    entry.shipmentCount++;
    entry.totalSubtotalUsdMinor += enriched.subtotalUsdMinor;
    entry.totalShippingUsdMinor += enriched.shippingUsdMinor;
    entry.totalDistanceKm       += enriched.distanceKm;

    if (enriched.routing.etaRun) {
      if (enriched.onTime) entry.onTimeCount++;
      else {
        entry.lateCount++;
        entry.totalDelayHours += enriched.delayHours;
      }
    }
    if (enriched.status === 'DELIVERED') entry.deliveries++;
    if (enriched.exception)              entry.exceptions++;
    if (enriched.consentStatus === 'valid')   entry.consentValid++;
    if (enriched.consentStatus === 'missing') entry.consentMissing++;
    if (enriched.consentStatus === 'expired') entry.consentExpired++;

    switch (enriched.sizeTier) {
      case 'envelope': entry.sizeTierEnvelope++; break;
      case 'small':    entry.sizeTierSmall++;    break;
      case 'medium':   entry.sizeTierMedium++;   break;
      case 'large':    entry.sizeTierLarge++;    break;
      case 'freight':  entry.sizeTierFreight++;  break;
    }

    accessor.set(state, 'insights', this.regionMap);
  }

  /** Fold one enriched scan into the bounded per-journey accumulator. */
  private foldJourney(enriched: EnrichedShipment): void {
    const id = enriched.shipmentId;
    const existing = this.journeyMap.get(id);

    const scan: JourneyScan = {
      'scanSeq':          enriched.scanSeq,
      'epochMs':          enriched.epochMs,
      'localIso':         enriched.localIso,
      'utcOffset':        enriched.utcOffset,
      'timezone':         enriched.timezone,
      'jurisdiction':     enriched.jurisdiction,
      'status':           enriched.status,
      'hub':              enriched.hub,
      'region':           enriched.region,
      'country':          enriched.country,
      'lat':              enriched.lat,
      'lng':              enriched.lng,
      'legKm':            enriched.legKm,
      'disruptionReason': enriched.disruptionReason,
    };

    if (existing !== undefined) {
      existing.scanCount++;
      if (existing.scans.length < MAX_SCANS_PER_JOURNEY) existing.scans.push(scan);
      if (existing.statusProgression.length < MAX_SCANS_PER_JOURNEY) existing.statusProgression.push(enriched.status);
      existing.pathKm  += enriched.legKm;
      if (enriched.epochMs < existing.minEpoch) existing.minEpoch = enriched.epochMs;
      if (enriched.epochMs > existing.maxEpoch) existing.maxEpoch = enriched.epochMs;
      if (!existing.offsets.includes(enriched.utcOffset))         existing.offsets.push(enriched.utcOffset);
      if (!existing.timezones.includes(enriched.timezone))         existing.timezones.push(enriched.timezone);
      if (!existing.jurisdictions.includes(enriched.jurisdiction)) existing.jurisdictions.push(enriched.jurisdiction);
      if (enriched.status === 'DELIVERED') existing.delivered = true;
      if (enriched.routing.etaRun && !existing.etaCaptured) {
        existing.etaCaptured      = true;
        existing.onTime           = enriched.onTime;
        existing.delayHours       = enriched.delayHours;
        existing.subtotalUsdMinor = enriched.subtotalUsdMinor;
        existing.shippingUsdMinor = enriched.shippingUsdMinor;
      }
      return;
    }

    if (this.journeyMap.size >= MAX_SAMPLE_JOURNEYS) return;

    const acc: JourneyAccumulator = {
      'scans':             [scan],
      'scanCount':         1,
      'pathKm':            enriched.legKm,
      'minEpoch':          enriched.epochMs,
      'maxEpoch':          enriched.epochMs,
      'offsets':           [enriched.utcOffset],
      'timezones':         [enriched.timezone],
      'jurisdictions':     [enriched.jurisdiction],
      'statusProgression': [enriched.status],
      'delivered':         enriched.status === 'DELIVERED',
      'etaCaptured':       enriched.routing.etaRun,
      'onTime':            enriched.routing.etaRun ? enriched.onTime : false,
      'delayHours':        enriched.routing.etaRun ? enriched.delayHours : 0,
      'subtotalUsdMinor':  enriched.routing.etaRun ? enriched.subtotalUsdMinor : 0,
      'shippingUsdMinor':  enriched.routing.etaRun ? enriched.shippingUsdMinor : 0,
    };
    this.journeyMap.set(id, acc);
  }

  /** Push one enriched record into the FIFO sample ring and update parent state. */
  private pushSampleRing(
    enriched: EnrichedShipment,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    this.sampleRing.push(enriched);
    if (this.sampleRing.length > MAX_SAMPLE_RECORDS) this.sampleRing.shift();
    accessor.set(state, 'sampleRecords', this.sampleRing);
  }
}

// ── Module-load registration ──────────────────────────────────────────────────

GatherStrategies.register(new InsightsFoldGatherBatch());
// GatherStrategies.resolve('insights-fold-batch') now works in any scatter placement.
