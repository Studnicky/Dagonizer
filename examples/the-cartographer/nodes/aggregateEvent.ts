/**
 * aggregateEvent: writes the compact per-scan EnrichedShipment onto state.enriched.
 *
 * Final productive node in the shipment-pipeline. The parent gather appends each
 * clone's state.enriched into parent.state.records.
 *
 * Sources:
 *   - state.normalized      → shipmentId, scanSeq, epochMs, local time, status, tiers
 *   - state.geoContext      → region, country, hub, geoStatus, timezone, jurisdiction
 *   - state.currentEvent    → stored lat/lng (possibly GDPR-coarsened) + redactedSample
 *   - state.gdprResult      → consentStatus, redactionApplied, coordsCoarsened
 *   - state.pricedOrder     → subtotalUsdMinor, currency  (shipment-level)
 *   - state.shippingQuote   → shippingUsdMinor, distanceKm (shipment-level)
 *   - state.deliveryEstimate→ transitHours, onTime, delayHours (shipment-level)
 *   - state.legKm           → this scan's leg distance
 */

import type { CartographerState } from '../CartographerState.ts';
import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

// #region aggregate-event-node
export class AggregateEventNode extends ScalarNode<CartographerState, 'done'> {
  readonly 'name' = 'aggregate-event';
  readonly 'outputs' = ['done'] as const;

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return {
      'done': { 'type': 'object' },
    };
  }

  protected override async executeOne(state: CartographerState, _context: NodeContextType): Promise<NodeOutputType<'done'>> {
    const norm = state.normalized;
    const geo  = state.geoContext;
    const gdpr = state.gdprResult;
    const po   = state.pricedOrder;
    const sq   = state.shippingQuote;
    const de   = state.deliveryEstimate;
    const ev   = state.currentEvent;

    const isException = norm.status === 'EXCEPTION';

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
      'geoStatus':        geo.status,
      // Stored coords come from currentEvent, which GDPR coarsened in-place
      // when the jurisdiction is strict or consent is not valid.
      'lat':              ev.latitude,
      'lng':              ev.longitude,
      'coordsCoarsened':  gdpr.coordsCoarsened,
      'legKm':            state.legKm,
      'status':           norm.status,
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
  }
}
// #endregion aggregate-event-node

export const aggregateEvent = new AggregateEventNode();
