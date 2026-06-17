/**
 * aggregateEventBatch: assembles EnrichedShipment[] from the per-type batch arrays.
 *
 * Position-ping events skip the order/gdpr/cold-chain/customs pipeline stages, so
 * pricedOrder, shippingQuote, deliveryEstimate, and gdprResult fall back to the same
 * zero-value defaults that CartographerState declares as its field initializers.
 *
 * Sources (batch arrays, indexed by position):
 *   - state.normalizedBatch     → shipmentId, scanSeq, epochMs, localIso, utcOffset, status, tiers
 *   - state.geoContextBatch     → region, country, hub, geoStatus, timezone, jurisdiction, continent
 *   - state.currentEventBatch   → lat, lng (from normalized coords; no PII in position-ping)
 *   - state.routingBatch        → per-event routing decisions
 *   - state.legKmBatch          → per-event leg distance
 *
 * Defaults (position-ping — no enrichment stages ran):
 *   - gdprResult:       zero-value (consentStatus='missing', no redaction, coords not coarsened)
 *   - pricedOrder:      zero-value (no lines, subtotal=0, USD)
 *   - shippingQuote:    zero-value (distanceKm=0, costUsdMinor=0)
 *   - deliveryEstimate: zero-value (transitHours=0, onTime=false, delayHours=0)
 */

import { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import type { GdprResult } from '../entities/GdprResult.ts';
import type { PricedOrder } from '../entities/PricedOrder.ts';
import type { ShippingQuote } from '../entities/ShippingQuote.ts';
import type { DeliveryEstimate } from '../entities/DeliveryEstimate.ts';
import {
  NodeOutputBuilder,
  type NodeContextInterface,
  type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region aggregate-event-batch-defaults

const DEFAULT_GDPR_RESULT: GdprResult = {
  'personalDataFields':         [],
  'sensitiveDataFields':        [],
  'consentStatus':              'missing',
  'lawfulBasis':                'contract',
  'jurisdiction':               'baseline',
  'strictness':                 'light',
  'complianceScore':            0,
  'retention':                  { 'retainUntil': '', 'autoDelete': false },
  'redactionApplied':           false,
  'marketingAnalyticsEligible': false,
  'coordsCoarsened':            false,
};

const DEFAULT_PRICED_ORDER: PricedOrder = {
  'lines':            [],
  'subtotalMinor':    0,
  'currency':         'USD',
  'subtotalUsdMinor': 0,
  'fxRate':           1.0,
};

const DEFAULT_SHIPPING_QUOTE: ShippingQuote = {
  'distanceKm':   0,
  'costUsdMinor': 0,
  'breakdown': {
    'baseMinor':      0,
    'perKmMinor':     0,
    'perKgMinor':     0,
    'tierMultiplier': 1.0,
  },
};

const DEFAULT_DELIVERY_ESTIMATE: DeliveryEstimate = {
  'transitHours':    0,
  'etaEpochMs':      0,
  'etaIso':          '',
  'promisedEpochMs': 0,
  'onTime':          false,
  'delayHours':      0,
};

// #endregion aggregate-event-batch-defaults

// #region aggregate-event-batch-node

export class AggregateEventBatchNode extends ScalarNode<CartographerState, 'done', CartographerServices> {
  readonly 'name' = 'aggregate-event-batch';
  readonly 'outputs' = ['done'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'done'>> {
    state.enrichedBatch = [];

    for (let i = 0; i < state.normalizedBatch.length; i++) {
      const norm = state.normalizedBatch[i];
      if (norm === undefined) { continue; }
      // Skip items where geo validation failed (invalid WGS-84 coords): mirrors
      // the per-event validate-coords 'rejected' terminal which produces no output.
      if (state.batchSkipMask[i] === true) { continue; }

      const geo     = state.geoContextBatch[i] ?? state.geoContext;
      const routing = state.routingBatch[i]     ?? CartographerState.defaultRouting();
      const legKm   = state.legKmBatch[i]        ?? 0;
      const ev      = state.currentEventBatch[i];

      // Position-ping carries no PII; coords come from the normalized record.
      const lat            = ev !== undefined ? ev.latitude        : (norm.latitude  ?? 0);
      const lng            = ev !== undefined ? ev.longitude       : (norm.longitude ?? 0);
      const recipientName  = ev !== undefined ? ev.recipientName  : '';
      const recipientEmail = ev !== undefined ? ev.recipientEmail : '';
      const recipientPhone = ev !== undefined ? ev.recipientPhone : '';

      const isException = norm.status === 'EXCEPTION';

      state.enrichedBatch.push({
        'shipmentId':       norm.shipmentId,
        'scanSeq':          norm.scanSeq,
        'epochMs':          norm.epochMs,
        'localIso':         norm.localIso,
        'utcOffset':        norm.utcOffset,
        'timezone':         geo.timezone,
        'jurisdiction':     geo.jurisdiction,
        'continent':        geo.continent,
        'region':           geo.region,
        'country':          geo.country,
        'hub':              geo.hub,
        'geoStatus':        geo.status,
        'lat':              lat,
        'lng':              lng,
        'coordsCoarsened':  DEFAULT_GDPR_RESULT.coordsCoarsened,
        'legKm':            legKm,
        'status':           norm.status,
        'serviceTier':      norm.serviceTier,
        'sizeTier':         norm.sizeTier,
        'onTime':           DEFAULT_DELIVERY_ESTIMATE.onTime,
        'exception':        isException,
        'consentStatus':    DEFAULT_GDPR_RESULT.consentStatus,
        'disruptionReason': norm.disruptionReason,
        'subtotalUsdMinor': DEFAULT_PRICED_ORDER.subtotalUsdMinor,
        'currency':         DEFAULT_PRICED_ORDER.currency,
        'shippingUsdMinor': DEFAULT_SHIPPING_QUOTE.costUsdMinor,
        'distanceKm':       DEFAULT_SHIPPING_QUOTE.distanceKm,
        'transitHours':     DEFAULT_DELIVERY_ESTIMATE.transitHours,
        'delayHours':       DEFAULT_DELIVERY_ESTIMATE.delayHours,
        'redactionApplied': DEFAULT_GDPR_RESULT.redactionApplied,
        'redactedSample': {
          'recipientName':  recipientName,
          'recipientEmail': recipientEmail,
          'recipientPhone': recipientPhone,
        },
        'routing': { ...routing },
      });
    }

    return NodeOutputBuilder.of('done');
  }
}

// #endregion aggregate-event-batch-node

export const aggregateEventBatch = new AggregateEventBatchNode();
