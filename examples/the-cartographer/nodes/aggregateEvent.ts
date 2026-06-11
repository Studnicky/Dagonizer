/**
 * aggregateEvent: writes the compact per-scan EnrichedShipment onto state.enriched.
 *
 * Final productive node in the shipment-pipeline. The parent gather appends each
 * clone's state.enriched into parent.state.records.
 *
 * Sources:
 *   - state.normalized      → shipmentId, scanSeq, epochMs, local time, eventType, tiers
 *   - state.geoContext      → region, country, hub, status, timezone, jurisdiction
 *   - state.currentEvent    → stored lat/lng (possibly GDPR-coarsened) + redactedSample
 *   - state.gdprResult      → consentStatus, redactionApplied, coordsCoarsened
 *   - state.pricedOrder     → subtotalUsdMinor, currency  (shipment-level)
 *   - state.shippingQuote   → shippingUsdMinor, distanceKm (shipment-level)
 *   - state.deliveryEstimate→ transitHours, onTime, delayHours (shipment-level)
 *   - state.legKm           → this scan's leg distance
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { NodeOutputBuilder, type NodeInterface } from '@noocodex/dagonizer';

// #region aggregate-event-node
export const aggregateEvent: NodeInterface<CartographerState, 'done', CartographerServices> = {
  'name': 'aggregate-event',
  'outputs': ['done'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const norm = state.normalized;
    const geo  = state.geoContext;
    const gdpr = state.gdprResult;
    const po   = state.pricedOrder;
    const sq   = state.shippingQuote;
    const de   = state.deliveryEstimate;
    const ev   = state.currentEvent;

    const isException = norm.eventType === 'EXCEPTION';

    state.enriched = {
      'shipmentId':       norm.shipmentId,
      'scanSeq':          norm.scanSeq,
      'epochMs':          norm.epochMs,
      'localIso':         norm.localIso,
      'utcOffset':        norm.utcOffset,
      'timezone':         geo.timezone,
      'jurisdiction':     geo.jurisdiction,
      // Macro continent for the per-region insights rollup (from the real API).
      'continent':        geo.continent,
      'region':           geo.region,
      'country':          geo.country,
      'hub':              geo.hub,
      'status':           geo.status,
      // Stored coords come from currentEvent, which GDPR coarsened in-place
      // when the jurisdiction is strict or consent is not valid.
      'lat':              ev.latitude,
      'lng':              ev.longitude,
      'coordsCoarsened':  gdpr.coordsCoarsened,
      'legKm':            state.legKm,
      'eventType':        norm.eventType,
      'serviceTier':      norm.serviceTier,
      'sizeTier':         norm.sizeTier,
      'onTime':           de.onTime,
      'exception':        isException,
      'consentStatus':    gdpr.consentStatus,
      'disruptionReason': norm.disruptionReason,
      'subtotalUsdMinor': po.subtotalUsdMinor,
      'currency':         po.currency,
      'shippingUsdMinor': sq.costUsdMinor,
      'distanceKm':       sq.distanceKm,
      'transitHours':     de.transitHours,
      'delayHours':       de.delayHours,
      'redactionApplied': gdpr.redactionApplied,
      'redactedSample': {
        'recipientName':  ev.recipientName,
        'recipientEmail': ev.recipientEmail,
        'recipientPhone': ev.recipientPhone,
      },
      // This scan's conditional-routing decisions (RAN vs SKIPPED per branch),
      // recorded by the route-* nodes on this clone. The parent's summarize
      // totals them into the savings view.
      'routing': { ...state.routing },
    };

    return NodeOutputBuilder.of('done');
  },
};
// #endregion aggregate-event-node
