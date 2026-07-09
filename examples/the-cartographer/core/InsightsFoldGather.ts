/**
 * InsightsFoldGather: stateless incremental gather strategy for the Cartographer demo.
 *
 * Folds each scatter clone's `state.enriched` (an EnrichedShipment) into THREE
 * BOUNDED accumulators that live in parent state (via accessor), rather than in
 * instance fields. Every accumulator is read, mutated, and written back via
 * accessor.get/set so the pattern survives process restart: on resume, already-acked
 * items' contributions remain in the checkpoint; the instance holds zero mutable state.
 *
 *   (a) state.insights             — EXACT per-region rollup (bounded: ~6-8 continent keys).
 *   (b) state.journeyAccumulators  — BOUNDED per-journey in-progress accumulators (cap: MAX_SAMPLE_JOURNEYS).
 *   (c) state.journeys             — FINALIZED per-journey map, written by finalize().
 *   (d) state.sampleRecords        — CAPPED FIFO ring of recent scans (cap: MAX_SAMPLE_RECORDS).
 *   (e) state.errorRollup          — bounded error distribution from clone capturedErrors.
 *
 * Memory never grows with event count. Only the journeys sample is lossy
 * (first MAX_SAMPLE_JOURNEYS unique shipmentIds are tracked); region arithmetic
 * is exact across all clones.
 *
 * Registered as 'insights-fold' at module load. The strategy instance is a
 * singleton that holds NO accumulator fields; all mutable state lives in
 * the parent NodeStateInterface, keyed by accessor paths.
 */

import type { GatherExecutionType, GatherRecordType } from '@studnicky/dagonizer/contracts';
import { GatherStrategies, GatherStrategy } from '@studnicky/dagonizer/core';
import type { GatherConfigType, NodeStateInterface } from '@studnicky/dagonizer/types';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';
import { CircularBuffer } from '@studnicky/circular-buffer';

import { EnrichedShipmentGuard, type EnrichedShipment } from '../entities/EnrichedShipment.ts';
import type { JourneyInsights, JourneyScan, RegionInsights } from '../CartographerState.ts';
import { GeoErrorRecord } from '../errors/GeoErrorRecord.ts';
import { ErrorRollup } from '../errors/ErrorRollup.ts';

// ── Module constants ───────────────────────────────────────────────────────────

const MAX_SAMPLE_JOURNEYS = 100;
const MAX_SAMPLE_RECORDS  = 200;
// Per-journey scan retention cap. A journey sample keeps at most this many
// JourneyScan objects (and status entries) so memory stays O(1) regardless of
// event count: a hot shipmentId folded a million times retains a bounded scan
// list, not a million scans. Exact scalar metrics (scanCount, pathKm, epoch
// bounds, offset/timezone/jurisdiction sets) are maintained independently of
// the capped scan list, so reconstruction stays faithful for the retained
// prefix while totals remain exact.
const MAX_SCANS_PER_JOURNEY = 64;

// ── Exported accumulator type ─────────────────────────────────────────────────

/** Internal accumulator for per-journey incremental folding. Exported for CartographerState snapshot/restore. */
export interface JourneyAccumulator {
  scans:            JourneyScan[];
  /** True scan count for this journey, maintained even when `scans` is capped. */
  scanCount:        number;
  pathKm:           number;
  minEpoch:         number;
  maxEpoch:         number;
  offsets:          string[];
  timezones:        string[];
  jurisdictions:    string[];
  statusProgression: string[];
  delivered:        boolean;
  /** True once order-lane facts have been captured from an etaRun scan. */
  etaCaptured:      boolean;
  onTime:           boolean;
  delayHours:       number;
  subtotalUsdMinor: number;
  shippingUsdMinor: number;
}

// ── Module-level type narrowing helpers ───────────────────────────────────────
// Named static classes per noun.verb() convention — no freestanding functions.

class RegionInsightsMap {
  static is(v: unknown): v is Map<string, RegionInsights> {
    return v instanceof Map;
  }
}

class JourneyAccumulatorMap {
  static is(v: unknown): v is Map<string, JourneyAccumulator> {
    return v instanceof Map;
  }
}

// ── InsightsFoldGather ────────────────────────────────────────────────────────

type SizeTierKey = 'envelope' | 'small' | 'medium' | 'large' | 'freight';

export class InsightsFoldGather extends GatherStrategy {
  private static readonly sizeTierDispatch: Readonly<Record<SizeTierKey, (entry: import('../CartographerState.ts').RegionInsights) => void>> = {
    'envelope': (entry) => { entry.sizeTierEnvelope++; },
    'small':    (entry) => { entry.sizeTierSmall++; },
    'medium':   (entry) => { entry.sizeTierMedium++; },
    'large':    (entry) => { entry.sizeTierLarge++; },
    'freight':  (entry) => { entry.sizeTierFreight++; },
  };
  private static isSizeTierKey(value: string): value is SizeTierKey {
    return value === 'envelope' || value === 'small' || value === 'medium' || value === 'large' || value === 'freight';
  }
  readonly name = 'insights-fold';
  readonly '@id' = 'urn:noocodec:node:insights-fold';

  // ── initial: reset accumulators in state ─────────────────────────────────

  override initial(
    _config: GatherConfigType,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    accessor.set(state, 'insights',             new Map<string, RegionInsights>());
    accessor.set(state, 'journeyAccumulators',  new Map<string, JourneyAccumulator>());
    accessor.set(state, 'sampleRecords',        []);
    accessor.set(state, 'errorRollup',          ErrorRollup.empty());
    accessor.set(state, 'journeys',             new Map());
  }

  // ── reduce: per-clone fold (batch.size === 1) ─────────────────────────────

  override reduce(
    _config: GatherConfigType,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    for (const item of batch) {
      const record: GatherRecordType = item.state;

      // Fold this clone's captured errors into the parent rollup FIRST — errors
      // flow scatter→gather as data, independent of whether the clone produced a
      // usable enriched record. A clone whose coords were out of range still
      // carries its captured RangeError even if enrichment degraded.
      this.foldErrors(record.cloneState, state, accessor);

      const rawEnriched = accessor.get(record.cloneState, 'enriched');
      if (!EnrichedShipmentGuard.is(rawEnriched) || !rawEnriched.shipmentId) continue;
      const enriched: EnrichedShipment = rawEnriched;

      this.foldRegion(enriched, state, accessor);
      this.foldJourney(enriched, state, accessor);
      this.pushSampleRing(enriched, state, accessor);
    }
  }

  // ── finalize: build state.journeys from bounded accumulators ─────────────

  override async finalize(
    _config: GatherConfigType,
    execution: GatherExecutionType<NodeStateInterface>,
  ): Promise<void> {
    const built = new Map<string, JourneyInsights>();

    const rawJourneyAccumulators = execution.accessor.get(execution.state, 'journeyAccumulators');
    if (!JourneyAccumulatorMap.is(rawJourneyAccumulators)) return;
    const journeyMap = rawJourneyAccumulators;

    for (const [shipmentId, acc] of journeyMap) {
      // Sort the retained (capped) scans by scanSeq (authoritative order);
      // epochMs is a tiebreak. The scalar metrics below come from the exact
      // accumulators, not from this bounded scan list.
      const scans = [...acc.scans].sort(
        (a, b) => a.scanSeq - b.scanSeq || a.epochMs - b.epochMs,
      );
      if (scans.length === 0) continue;

      const last = scans[scans.length - 1];
      if (last === undefined) continue;

      // Terminal-aware status progression. The progression is capped at
      // MAX_SCANS_PER_JOURNEY during folding, but `delivered` is tracked
      // uncapped: a hot shipmentId can fold its terminal DELIVERED scan after
      // the progression array is already full, dropping DELIVERED from the
      // capped prefix while the flag stays true. Delivery is terminal, so
      // restore the DELIVERED marker at the end when the flag is set but the
      // capped progression lost it — bounded (+1 entry), invariant preserved.
      const statusProgression = [...acc.statusProgression];
      if (acc.delivered && !statusProgression.includes('DELIVERED')) {
        statusProgression.push('DELIVERED');
      }

      // pathKm, epoch bounds, offset/timezone/jurisdiction sets, scanCount, and
      // delivered are maintained exactly during folding (independent of the
      // capped scan list), so totals stay faithful even when the journey folded
      // more scans than MAX_SCANS_PER_JOURNEY.
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
    // Region insights are exact in state.insights already; finalize does not touch them.
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Fold one clone's captured errors into the bounded parent rollup. */
  private foldErrors(
    cloneState: NodeStateInterface,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    const rawErrors = accessor.get(cloneState, 'capturedErrors');
    if (!GeoErrorRecord.isArray(rawErrors) || rawErrors.length === 0) return;
    const rawRollup = accessor.get(state, 'errorRollup');
    const rollup = ErrorRollup.is(rawRollup) ? rawRollup : ErrorRollup.empty();
    for (const error of rawErrors) {
      ErrorRollup.fold(rollup, error);
    }
    // Write the rollup back to parent state after folding. The rollup is bounded
    // to O(distinct source+variant groups) regardless of event count.
    accessor.set(state, 'errorRollup', rollup);
  }

  /** Fold one enriched scan into the per-region accumulator and update parent state. */
  private foldRegion(
    enriched: EnrichedShipment,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    const key = enriched.geoStatus === 'water'
      ? 'International Waters / Maritime'
      : enriched.continent;

    const rawInsights = accessor.get(state, 'insights');
    const regionMap: Map<string, RegionInsights> = RegionInsightsMap.is(rawInsights)
      ? rawInsights
      : new Map<string, RegionInsights>();

    let entry = regionMap.get(key);
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
      regionMap.set(key, entry);
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

    if (InsightsFoldGather.isSizeTierKey(enriched.sizeTier)) {
      InsightsFoldGather.sizeTierDispatch[enriched.sizeTier](entry);
    }

    // Write the internal map back to parent state after every mutation.
    // The map is bounded to ~6-8 continent keys regardless of event count.
    accessor.set(state, 'insights', regionMap);
  }

  /** Fold one enriched scan into the bounded per-journey accumulator. */
  private foldJourney(
    enriched: EnrichedShipment,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    const id = enriched.shipmentId;

    const rawJourneyAccumulators = accessor.get(state, 'journeyAccumulators');
    const journeyMap: Map<string, JourneyAccumulator> = JourneyAccumulatorMap.is(rawJourneyAccumulators)
      ? rawJourneyAccumulators
      : new Map<string, JourneyAccumulator>();

    const existing = journeyMap.get(id);

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
      // Fold this scan into the existing accumulator. The scan list and status
      // progression are capped at MAX_SCANS_PER_JOURNEY so a frequently-folded
      // shipmentId does not grow these arrays without bound; scanCount and the
      // scalar metrics below stay exact regardless of the cap.
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
      // Capture order-lane facts on the first etaRun scan seen for this journey.
      if (enriched.routing.etaRun && !existing.etaCaptured) {
        existing.etaCaptured      = true;
        existing.onTime           = enriched.onTime;
        existing.delayHours       = enriched.delayHours;
        existing.subtotalUsdMinor = enriched.subtotalUsdMinor;
        existing.shippingUsdMinor = enriched.shippingUsdMinor;
      }
      accessor.set(state, 'journeyAccumulators', journeyMap);
      return;
    }

    // New shipmentId: only start tracking if under the sample cap.
    if (journeyMap.size >= MAX_SAMPLE_JOURNEYS) return;

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
      // Seed order-lane facts from this scan if it is an etaRun; otherwise use
      // safe defaults (non-etaRun scans have no pricing/eta data).
      'etaCaptured':       enriched.routing.etaRun,
      'onTime':            enriched.routing.etaRun ? enriched.onTime : false,
      'delayHours':        enriched.routing.etaRun ? enriched.delayHours : 0,
      'subtotalUsdMinor':  enriched.routing.etaRun ? enriched.subtotalUsdMinor : 0,
      'shippingUsdMinor':  enriched.routing.etaRun ? enriched.shippingUsdMinor : 0,
    };
    journeyMap.set(id, acc);
    accessor.set(state, 'journeyAccumulators', journeyMap);
  }

  /** Push one enriched record into the FIFO sample ring and update parent state. */
  private pushSampleRing(
    enriched: EnrichedShipment,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    const rawSample = accessor.get(state, 'sampleRecords');
    const sampleRing = CircularBuffer.create<EnrichedShipment>({
      'capacity': MAX_SAMPLE_RECORDS,
      'overflow': 'overwrite',
    });
    if (Array.isArray(rawSample)) {
      for (const s of rawSample) {
        if (EnrichedShipmentGuard.is(s)) sampleRing.push(s);
      }
    }
    sampleRing.push(enriched);
    const sampleRecords: EnrichedShipment[] = [];
    let record = sampleRing.shift();
    while (record !== undefined) {
      sampleRecords.push(record);
      record = sampleRing.shift();
    }
    accessor.set(state, 'sampleRecords', sampleRecords);
  }
}

// ── Module-load registration ──────────────────────────────────────────────────

GatherStrategies.register(new InsightsFoldGather());
// GatherStrategies.resolve('insights-fold') now works in any scatter placement.
