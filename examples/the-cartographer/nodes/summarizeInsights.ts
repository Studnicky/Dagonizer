/**
 * summarizeInsights: finalizes the cartographer's insight views after the
 * process-stream scatter completes.
 *
 * In the streaming topology the insights-fold gather strategy accumulates
 * state.insights (exact per-region rollup), state.journeys (bounded
 * per-journey sample), and state.sampleRecords (capped FIFO of scans)
 * incrementally as each scatter clone completes. Memory stays O(1) regardless
 * of event count. When that path ran (state.insights.size > 0 OR
 * state.journeys.size > 0) this node is a pure pass-through.
 *
 * The records-based fold (iterating state.records) is retained as a fallback
 * for callers that populate state.records via the array path and do not use
 * the insights-fold gather. Routes 'success' to the done terminal in both paths.
 */

import type {
  CartographerState,
  JourneyInsights,
  JourneyScan,
  RegionInsights,
} from '../CartographerState.ts';
import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

type SizeTierKey = 'envelope' | 'small' | 'medium' | 'large' | 'freight';

// #region summarize-insights-node
export class SummarizeInsightsNode extends MonadicNode<CartographerState, 'success'> {
  private static readonly sizeTierDispatch: Readonly<Record<SizeTierKey, (entry: RegionInsights) => void>> = {
    'envelope': (entry) => { entry.sizeTierEnvelope++; },
    'small':    (entry) => { entry.sizeTierSmall++; },
    'medium':   (entry) => { entry.sizeTierMedium++; },
    'large':    (entry) => { entry.sizeTierLarge++; },
    'freight':  (entry) => { entry.sizeTierFreight++; },
  };
  readonly 'name' = 'summarize';
  readonly 'outputs' = ['success'] as const;

  override get outputSchema(): Record<'success', SchemaObjectType> {
    return {
      'success': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'success', CartographerState>> {
    for (const item of batch) {
      this.summarizeItem(item.state);
    }
    return RoutedBatch.create('success', batch);
  }

  private summarizeItem(state: CartographerState): void {
    // Streaming path: insights-fold gather already produced state.insights,
    // state.journeys, and state.sampleRecords with bounded memory. Nothing to do.
    if (state.insights.size > 0 || state.journeys.size > 0) {
      return;
    }

    // Array-path fallback: fold state.records into insights and journeys for
    // callers that did not use the insights-fold gather strategy.
    state.insights = new Map<string, RegionInsights>();
    state.journeys = new Map<string, JourneyInsights>();

    // ── (b) Group scans by shipmentId for per-journey reconstruction ──────────
    const scansByShipment = new Map<string, JourneyScan[]>();

    for (const record of state.records) {
      if (!record.shipmentId) continue;

      // ── (a) per-region accumulation (rolled up to CONTINENT) ────────────────
      // Bucket by the macro continent the real geo API resolved (not the fine
      // subdivision/country), so the table reads ~6–8 rows. Maritime pings (open
      // water → no continent) collapse into one 'International Waters / Maritime'
      // bucket. The continent is always present (default 'Unmapped' upstream),
      // so the key is consistent — never a bare country code or subdivision.
      const key = record.geoStatus === 'water'
        ? 'International Waters / Maritime'
        : record.continent;
      let entry = state.insights.get(key);
      if (entry === undefined) {
        entry = {
          'region':               key,
          'country':              key,
          'hub':                  key,
          'deliveries':           0,
          'exceptions':           0,
          'onTimeCount':          0,
          'lateCount':            0,
          'totalSubtotalUsdMinor': 0,
          'totalShippingUsdMinor': 0,
          'totalDistanceKm':      0,
          'totalDelayHours':      0,
          'consentValid':         0,
          'consentMissing':       0,
          'consentExpired':       0,
          'sizeTierEnvelope':     0,
          'sizeTierSmall':        0,
          'sizeTierMedium':       0,
          'sizeTierLarge':        0,
          'sizeTierFreight':      0,
          'shipmentCount':        0,
        };
        state.insights.set(key, entry);
      }

      entry.shipmentCount++;
      entry.totalSubtotalUsdMinor += record.subtotalUsdMinor;
      entry.totalShippingUsdMinor += record.shippingUsdMinor;
      entry.totalDistanceKm       += record.distanceKm;

      // On-time is only meaningful for order-lane events that ran the ETA node;
      // position/sensor/customs events skip pricing/eta (the branching saves it),
      // so they are NOT counted toward on-time% (which would otherwise read 0%).
      if (record.routing.etaRun) {
        if (record.onTime) entry.onTimeCount++;
        else {
          entry.lateCount++;
          entry.totalDelayHours += record.delayHours;
        }
      }
      if (record.status === 'DELIVERED') entry.deliveries++;
      if (record.exception) entry.exceptions++;
      if (record.consentStatus === 'valid')   entry.consentValid++;
      if (record.consentStatus === 'missing') entry.consentMissing++;
      if (record.consentStatus === 'expired') entry.consentExpired++;

      SummarizeInsightsNode.sizeTierDispatch[record.sizeTier]?.(entry);

      // ── (b) collect the scan for this journey ───────────────────────────────
      let scans = scansByShipment.get(record.shipmentId);
      if (scans === undefined) {
        scans = [];
        scansByShipment.set(record.shipmentId, scans);
      }
      scans.push({
        'scanSeq':          record.scanSeq,
        'epochMs':          record.epochMs,
        'localIso':         record.localIso,
        'utcOffset':        record.utcOffset,
        'timezone':         record.timezone,
        'jurisdiction':     record.jurisdiction,
        'status':           record.status,
        'hub':              record.hub,
        'region':           record.region,
        'country':          record.country,
        'lat':              record.lat,
        'lng':              record.lng,
        'legKm':            record.legKm,
        'disruptionReason': record.disruptionReason,
      });
    }

    // ── (b) build the per-journey aggregates ──────────────────────────────────
    for (const [shipmentId, rawScans] of scansByShipment) {
      // Order by scanSeq (the authoritative journey order); epochMs is a display
      // value that can collapse/reorder under lossy raw timestamp formats, so it
      // is only a tiebreak.
      const scans = [...rawScans].sort((a, b) => a.scanSeq - b.scanSeq || a.epochMs - b.epochMs);
      const first = scans[0];
      const last  = scans[scans.length - 1];
      if (first === undefined || last === undefined) continue;

      let pathKm = 0;
      let minEpoch = first.epochMs;
      let maxEpoch = first.epochMs;
      const offsets: string[] = [];
      const timezones: string[] = [];
      const jurisdictions: string[] = [];
      const statusProgression: string[] = [];
      let delivered = false;

      for (const s of scans) {
        pathKm += s.legKm;
        if (s.epochMs < minEpoch) minEpoch = s.epochMs;
        if (s.epochMs > maxEpoch) maxEpoch = s.epochMs;
        if (!offsets.includes(s.utcOffset)) offsets.push(s.utcOffset);
        if (!timezones.includes(s.timezone)) timezones.push(s.timezone);
        if (!jurisdictions.includes(s.jurisdiction)) jurisdictions.push(s.jurisdiction);
        statusProgression.push(s.status);
        if (s.status === 'DELIVERED') delivered = true;
      }

      // Shipment-level facts (on-time, delay, pricing) come from an ORDER-lane
      // record of the journey — one that actually ran pricing/eta. Position/
      // sensor/customs scans skip that work, so prefer an eta-bearing record;
      // fall back to any record only if the journey has no order-lane scan.
      const orderRecord = state.records.find(
        (r) => r.shipmentId === shipmentId && r.shipmentId.length > 0 && r.routing.etaRun,
      );
      const deliveryRecord = orderRecord
        ?? state.records.find((r) => r.shipmentId === shipmentId && r.shipmentId.length > 0);
      const onTime = deliveryRecord?.onTime ?? false;
      const delayHours = deliveryRecord?.delayHours ?? 0;
      const subtotalUsdMinor = deliveryRecord?.subtotalUsdMinor ?? 0;
      const shippingUsdMinor = deliveryRecord?.shippingUsdMinor ?? 0;

      const journey: JourneyInsights = {
        'shipmentId':        shipmentId,
        'scans':             scans,
        'scanCount':         scans.length,
        'pathKm':            pathKm,
        'firstEpochMs':      minEpoch,
        'lastEpochMs':       maxEpoch,
        'elapsedHours':      (maxEpoch - minEpoch) / 3_600_000,
        'timezones':         timezones,
        'offsets':           offsets,
        'jurisdictions':     jurisdictions,
        'statusProgression': statusProgression,
        'lastStatus':        last.status,
        'lastHub':           last.hub,
        'delivered':         delivered,
        'onTime':            onTime,
        'delayHours':        delayHours,
        'subtotalUsdMinor':  subtotalUsdMinor,
        'shippingUsdMinor':  shippingUsdMinor,
      };
      state.journeys.set(shipmentId, journey);
    }
  }
}

export const summarizeInsights = new SummarizeInsightsNode();
// #endregion summarize-insights-node
