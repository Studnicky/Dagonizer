/**
 * parseVariant: adapts the typed CanonicalEventVariant under enrichment into
 * state.canonicalVariant + projects its OWNED fields onto state.raw. The
 * typed-path replacement for parseEvent (which reads the fat CanonicalEvent).
 * Unowned raw fields keep their RawShipmentEvent defaults.
 *
 * Routes 'parsed' on success, 'invalid' when the metadata item is absent or
 * has no shipmentId.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import type { CanonicalEventVariant } from '../entities/CanonicalEvent.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region parse-variant-node
export class ParseVariantNode extends ScalarNode<CartographerState, 'parsed' | 'invalid', CartographerServices> {
  readonly 'name' = 'parse-variant';
  readonly 'outputs' = ['parsed', 'invalid'] as const;

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

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'parsed' | 'invalid'>> {
    const variant = state.getMetadata<CanonicalEventVariant>('canonical-event');
    if (variant === null || variant === undefined || !variant.shipmentId) {
      return NodeOutputBuilder.of('invalid');
    }
    state.canonicalVariant = variant;
    // Mirror onto state.canonical so routeGeo can branch on 'has-geo' / 'needs-geo'
    // and routeModalities can read ipAddress from state.canonical.body.ipAddress.
    state.canonical = variant;

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

    state.raw = {
      'shipmentId':            variant.shipmentId,
      'scanSeq':               b.scanSeq,
      'rawTimestamp':          b.rawTimestamp,
      'rawDispatchAt':         rawDispatchAt,
      'rawStatus':             ParseVariantNode.statusFor(variant),
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
    };

    return NodeOutputBuilder.of('parsed');
  }
}

export const parseVariant = new ParseVariantNode();
// #endregion parse-variant-node
