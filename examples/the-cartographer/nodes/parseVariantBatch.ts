/**
 * parseVariantBatch: processes state.variantBatch (a CanonicalEventVariant[])
 * already decoded by the upstream scatter/decode stage. For each item it runs
 * the same field-extraction logic as parseVariant and writes into
 * state.rawBatch[i] (RawShipmentEvent) and state.currentEventBatch[i]
 * (ShipmentEvent). Items with an empty shipmentId are silently dropped.
 *
 * Routes 'parsed' unconditionally — the batch always completes. There is no
 * 'invalid' route because the items are already decoded; per-item invalidity
 * is handled by the skip/drop on empty shipmentId.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import type { CanonicalEventVariant } from '../entities/CanonicalEvent.ts';
import type { ShipmentEvent } from '../entities/ShipmentEvent.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region parse-variant-batch-node
export class ParseVariantBatchNode extends ScalarNode<CartographerState, 'parsed', CartographerServices> {
  readonly 'name' = 'parse-variant-batch';
  readonly 'outputs' = ['parsed'] as const;

  /** A non-empty status for event types whose source status string may be sparse. */
  private static statusFor(variant: CanonicalEventVariant): string {
    if (variant.eventType === 'delivery-confirmation') return 'delivered';
    if (variant.eventType === 'customs-event') {
      return variant.body.customsStatus === 'held' ? 'customs hold' : 'customs cleared';
    }
    if (variant.eventType === 'sensor-reading') return 'sensor reading';
    const s = variant.body.status;
    return s.length > 0 ? s : 'in transit';
  }

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'parsed'>> {
    state.rawBatch          = [];
    state.currentEventBatch = [];

    for (const variant of state.variantBatch) {
      if (!variant.shipmentId) continue;

      const b = variant.body;

      // Facility-scan-owned extras (override after defaults).
      let rawDispatchAt           = '';
      let weight                  = 0;
      let weightUnit: 'lb' | 'kg' | 'g' | 'oz' = 'kg';
      let lineItems: Array<{ 'productId': string; 'quantity': number }> = [{ 'productId': 'PROD-001', 'quantity': 1 }];
      let facilityId              = '';
      let rawPromisedDeliveryAt   = '';
      let disruptionReason        = '';
      let recipientName           = '';
      let recipientEmail          = '';
      let recipientPhone          = '';
      let recipientAddress        = '';
      let recipientCountry        = '';
      let marketingConsent        = false;
      let lawfulBasis: 'contract' | 'consent' | 'legitimate-interest' | 'none' = 'contract';
      let specialCategory: 'none' | 'health' = 'none';

      if (variant.eventType === 'facility-scan') {
        rawDispatchAt         = variant.body.rawDispatchAt;
        weight                = variant.body.weight;
        weightUnit            = variant.body.weightUnit;
        lineItems             = variant.body.lineItems.length > 0
          ? variant.body.lineItems.map((li) => ({ ...li }))
          : [{ 'productId': 'PROD-001', 'quantity': 1 }];
        facilityId            = variant.body.facilityId;
        rawPromisedDeliveryAt = variant.body.rawPromisedDeliveryAt;
        disruptionReason      = variant.body.disruptionReason;
        recipientName         = variant.body.recipientName;
        recipientEmail        = variant.body.recipientEmail;
        recipientPhone        = variant.body.recipientPhone;
        recipientAddress      = variant.body.recipientAddress;
        recipientCountry      = variant.body.recipientCountry;
        marketingConsent      = variant.body.marketingConsent;
        lawfulBasis           = variant.body.lawfulBasis;
        specialCategory       = variant.body.specialCategory;
      }

      if (variant.eventType === 'delivery-confirmation') {
        rawPromisedDeliveryAt = variant.body.rawPromisedDeliveryAt;
        disruptionReason      = variant.body.disruptionReason;
        recipientName         = variant.body.recipientName;
        recipientEmail        = variant.body.recipientEmail;
        recipientPhone        = variant.body.recipientPhone;
        recipientAddress      = variant.body.recipientAddress;
        recipientCountry      = variant.body.recipientCountry;
        marketingConsent      = variant.body.marketingConsent;
        lawfulBasis           = variant.body.lawfulBasis;
        specialCategory       = variant.body.specialCategory;
      }

      state.rawBatch.push({
        'shipmentId':            variant.shipmentId,
        'scanSeq':               b.scanSeq,
        'rawTimestamp':          b.rawTimestamp,
        'rawDispatchAt':         rawDispatchAt,
        'rawStatus':             ParseVariantBatchNode.statusFor(variant),
        'carrier':               b.carrier,
        'ipAddress':             b.ipAddress,
        'latitude':              b.latitude,
        'longitude':             b.longitude,
        'legFromLat':            b.legFromLat,
        'legFromLng':            b.legFromLng,
        'originLat':             b.originLat,
        'originLng':             b.originLng,
        'destLat':               b.destLat,
        'destLng':               b.destLng,
        'weight':                weight,
        'weightUnit':            weightUnit,
        'recipientName':         recipientName,
        'recipientEmail':        recipientEmail,
        'recipientPhone':        recipientPhone,
        'recipientAddress':      recipientAddress,
        'recipientCountry':      recipientCountry,
        'marketingConsent':      marketingConsent,
        'rawPromisedDeliveryAt': rawPromisedDeliveryAt,
        'lineItems':             lineItems,
        'facilityId':            facilityId,
        'lawfulBasis':           lawfulBasis,
        'specialCategory':       specialCategory,
        'disruptionReason':      disruptionReason,
      });

      const currentEvent: ShipmentEvent = {
        'shipmentId':         variant.shipmentId,
        'timestamp':          b.rawTimestamp,
        'eventType':          'SCAN',
        'latitude':           b.latitude,
        'longitude':          b.longitude,
        'carrier':            b.carrier,
        'facilityId':         facilityId,
        'recipientName':      recipientName,
        'recipientEmail':     recipientEmail,
        'recipientPhone':     recipientPhone,
        'recipientAddress':   recipientAddress,
        'recipientCountry':   recipientCountry,
        'marketingConsent':   marketingConsent,
        'promisedDeliveryAt': rawPromisedDeliveryAt,
      };

      state.currentEventBatch.push(currentEvent);
    }

    return NodeOutputBuilder.of('parsed');
  }
}

export const parseVariantBatch = new ParseVariantBatchNode();
// #endregion parse-variant-batch-node
