/**
 * summarizeInsights: folds state.records into TWO views.
 *
 * (a) per-region (state.insights): shipments, exceptions, on-time/late counts,
 *     revenue (Σ subtotalUsdMinor), shipping cost, distance, delay, size-tier
 *     and consent mix.
 * (b) per-journey (state.journeys): records grouped by shipmentId, ordered by
 *     epoch — scan count, path distance (Σ legKm), elapsed (last−first epoch),
 *     timezones/offsets crossed, jurisdictions traversed, status progression,
 *     last status & location, and on-time at delivery.
 *
 * Called once at the parent DAG level after all scatter clones are gathered.
 * Routes 'success' to the done terminal.
 */

import type {
  CartographerState,
  JourneyInsights,
  JourneyScan,
  RegionInsights,
} from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region summarize-insights-node
export class SummarizeInsightsNode extends ScalarNode<CartographerState, 'success', CartographerServices> {
  readonly 'name' = 'summarize';
  readonly 'outputs' = ['success'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'success'>> {
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
      const key = record.status === 'water'
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
      if (record.eventType === 'DELIVERED') entry.deliveries++;
      if (record.exception) entry.exceptions++;
      if (record.consentStatus === 'valid')   entry.consentValid++;
      if (record.consentStatus === 'missing') entry.consentMissing++;
      if (record.consentStatus === 'expired') entry.consentExpired++;

      switch (record.sizeTier) {
        case 'envelope': entry.sizeTierEnvelope++; break;
        case 'small':    entry.sizeTierSmall++;    break;
        case 'medium':   entry.sizeTierMedium++;   break;
        case 'large':    entry.sizeTierLarge++;    break;
        case 'freight':  entry.sizeTierFreight++;  break;
      }

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
        'eventType':        record.eventType,
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
        statusProgression.push(s.eventType);
        if (s.eventType === 'DELIVERED') delivered = true;
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
        'lastStatus':        last.eventType,
        'lastHub':           last.hub,
        'delivered':         delivered,
        'onTime':            onTime,
        'delayHours':        delayHours,
        'subtotalUsdMinor':  subtotalUsdMinor,
        'shippingUsdMinor':  shippingUsdMinor,
      };
      state.journeys.set(shipmentId, journey);
    }

    return NodeOutputBuilder.of('success');
  }
}

export const summarizeInsights = new SummarizeInsightsNode();
// #endregion summarize-insights-node
