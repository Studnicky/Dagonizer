/**
 * InsightsFoldGather: incremental, bounded gather strategy for the Cartographer demo.
 *
 * Folds each scatter clone's `state.enriched` (an EnrichedShipment) into THREE
 * BOUNDED accumulators as clones arrive, rather than collecting a full records
 * array and batch-folding at finalize.
 *
 *   (a) state.insights  — EXACT per-region rollup (bounded: ~6-8 continent keys).
 *   (b) state.journeys  — BOUNDED per-journey sample (cap: MAX_SAMPLE_JOURNEYS).
 *   (c) state.sampleRecords — CAPPED FIFO ring of recent scans (cap: MAX_SAMPLE_RECORDS).
 *
 * Memory never grows with event count. Only the journeys sample is lossy
 * (first MAX_SAMPLE_JOURNEYS unique shipmentIds are tracked); region arithmetic
 * is exact across all clones.
 *
 * Registered as 'insights-fold' at module load. The strategy is a singleton;
 * `initial()` resets all accumulators per execution. Sequential cartographer
 * executions are safe because executions run one at a time.
 */

import type { GatherExecutionType, GatherRecordType } from '@studnicky/dagonizer/contracts';
import { GatherStrategies, GatherStrategy } from '@studnicky/dagonizer/core';
import type { GatherConfigType, NodeStateInterface } from '@studnicky/dagonizer/types';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';

import type { EnrichedShipment } from '../entities/EnrichedShipment.ts';
import type { JourneyInsights, JourneyScan, RegionInsights } from '../CartographerState.ts';
import type { GeoErrorRecordType } from '../errors/GeoErrorRecord.ts';
import { ErrorRollup, type ErrorRollupType } from '../errors/ErrorRollup.ts';

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

// ── Internal accumulator type ─────────────────────────────────────────────────

/** Internal accumulator for per-journey incremental folding. */
interface JourneyAccumulator {
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

// ── InsightsFoldGather ────────────────────────────────────────────────────────

export class InsightsFoldGather extends GatherStrategy {
  readonly name = 'insights-fold';

  // Per-execution accumulators (reset in initial() before each scatter).
  // Single-instance accumulation is safe: the cartographer runs executions
  // sequentially so no two scatter runs overlap on the same strategy instance.
  private regionMap:    Map<string, RegionInsights>      = new Map();
  private journeyMap:   Map<string, JourneyAccumulator>  = new Map();
  private sampleRing:   EnrichedShipment[]               = [];
  private errorRollup:  ErrorRollupType                  = ErrorRollup.empty();

  // ── initial: reset accumulators and parent state targets ─────────────────

  override initial(
    _config: GatherConfigType,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    this.regionMap   = new Map();
    this.journeyMap  = new Map();
    this.sampleRing  = [];
    this.errorRollup = ErrorRollup.empty();

    accessor.set(state, 'insights',      new Map());
    accessor.set(state, 'journeys',      new Map());
    accessor.set(state, 'sampleRecords', []);
    accessor.set(state, 'errorRollup',   ErrorRollup.empty());
  }

  // ── reduce: per-clone fold (batch.size === 1) ─────────────────────────────

  override reduce(
    _config: GatherConfigType,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    for (const item of batch) {
      const record: GatherRecordType<NodeStateInterface> = item.state;

      // Fold this clone's captured errors into the parent rollup FIRST — errors
      // flow scatter→gather as data, independent of whether the clone produced a
      // usable enriched record. A clone whose coords were out of range still
      // carries its captured RangeError even if enrichment degraded.
      this.foldErrors(record.cloneState, state, accessor);

      const enriched = accessor.get<EnrichedShipment>(record.cloneState, 'enriched');
      if (enriched === null || !enriched.shipmentId) continue;

      this.foldRegion(enriched, state, accessor);
      this.foldJourney(enriched);
      this.pushSampleRing(enriched, state, accessor);
    }
  }

  // ── finalize: build state.journeys from bounded accumulators ─────────────

  override async finalize(
    _config: GatherConfigType,
    execution: GatherExecutionType<NodeStateInterface>,
  ): Promise<void> {
    const built = new Map<string, JourneyInsights>();

    for (const [shipmentId, acc] of this.journeyMap) {
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
    const errors = accessor.get<readonly GeoErrorRecordType[]>(cloneState, 'capturedErrors');
    if (errors === null || errors.length === 0) return;
    for (const error of errors) {
      ErrorRollup.fold(this.errorRollup, error);
    }
    // Write the rollup back to parent state after folding. The rollup is bounded
    // to O(distinct source+variant groups) regardless of event count.
    accessor.set(state, 'errorRollup', this.errorRollup);
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

    // Write the internal map back to parent state after every mutation.
    // The map is bounded to ~6-8 continent keys regardless of event count.
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
      return;
    }

    // New shipmentId: only start tracking if under the sample cap.
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
      // Seed order-lane facts from this scan if it is an etaRun; otherwise use
      // safe defaults (non-etaRun scans have no pricing/eta data).
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
    accessor: StateAccessorInterface,
  ): void {
    this.sampleRing.push(enriched);
    if (this.sampleRing.length > MAX_SAMPLE_RECORDS) this.sampleRing.shift();
    accessor.set(state, 'sampleRecords', this.sampleRing);
  }
}

// ── Module-load registration ──────────────────────────────────────────────────

GatherStrategies.register(new InsightsFoldGather());
// GatherStrategies.resolve('insights-fold') now works in any scatter placement.
