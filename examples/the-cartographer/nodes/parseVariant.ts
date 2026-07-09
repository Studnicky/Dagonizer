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
import { CanonicalEventVariantBuilder, type CanonicalEventVariant } from '../entities/CanonicalEvent.ts';

import { Batch, MonadicNode, NodeOutput } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, NodeOutputType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region parse-variant-node
export class ParseVariantNode extends MonadicNode<CartographerState, 'parsed' | 'invalid'> {
  readonly '@id' = 'urn:noocodec:node:parse-variant';
  readonly 'name' = 'parse-variant';
  readonly 'outputs' = ['parsed', 'invalid'] as const;

  override get outputSchema(): Record<'parsed' | 'invalid', SchemaObjectType> {
    return {
      'parsed':  { 'type': 'object' },
      'invalid': { 'type': 'object' },
    };
  }

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

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'parsed' | 'invalid', CartographerState>> {
    const acc = new Map<'parsed' | 'invalid', ItemType<CartographerState>[]>();

    for (const item of batch) {
      const result = this.routeItem(item.state);
      for (const error of result.errors) {
        item.state.collectError(error);
      }
      const bucket = acc.get(result.output);
      if (bucket === undefined) {
        acc.set(result.output, [item]);
      } else {
        bucket.push(item);
      }
    }

    const routed = new Map<'parsed' | 'invalid', Batch<CartographerState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  private routeItem(state: CartographerState): NodeOutputType<'parsed' | 'invalid'> {
    const raw = state.getMetadata('canonical-event');
    if (!CanonicalEventVariantBuilder.is(raw)) {
      return NodeOutput.create('invalid');
    }
    const variant = raw;
    state.canonicalVariant = variant;
    // Mirror onto state.canonical so routeGeo can branch on 'has-geo' / 'needs-geo'
    // and score-signals can read all geo signal fields from state.canonical.body.
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
      'localeTag':             b.localeTag,
      'countryCode':           b.countryCode,
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

    return NodeOutput.create('parsed');
  }
}

export const parseVariant = new ParseVariantNode();
// #endregion parse-variant-node
