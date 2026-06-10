/**
 * parseEvent: adapts the canonical event under enrichment into state.raw.
 *
 * The enrichment scatter writes each CanonicalEvent under the itemKey
 * 'canonical-event' in the clone metadata. This node retrieves it, stores it on
 * state.canonical, and projects it into the RawShipmentEvent shape on state.raw
 * so the existing geo/normalize/classify/enrich/gdpr chain consumes it unchanged.
 *
 * The canonical body already carries every field the enrichment needs (the
 * ingestion fan-in widened it from the heterogeneous sources). Per-kind fields
 * (delivered, customsStatus, sensor channels) inform the status when the source
 * status string is sparse.
 *
 * Routes 'parsed' on success, 'invalid' when the metadata item is absent or has
 * no shipmentId.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import type { CanonicalEvent } from '../entities/CanonicalEvent.ts';

import { NodeOutputBuilder, type NodeInterface } from '@noocodex/dagonizer';

// #region parse-event-node
/** A non-empty status for kinds whose source status string may be sparse. */
function statusFor(event: CanonicalEvent): string {
  const s = event.body.status;
  if (s.length > 0) return s;
  if (event.kind === 'delivery-confirmation') return 'delivered';
  if (event.kind === 'customs-event') return event.body.customsStatus === 'held' ? 'customs hold' : 'customs cleared';
  if (event.kind === 'sensor-reading') return 'sensor reading';
  return 'in transit';
}

export const parseEvent: NodeInterface<CartographerState, 'parsed' | 'invalid', CartographerServices> = {
  'name': 'parse',
  'outputs': ['parsed', 'invalid'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const event = state.getMetadata<CanonicalEvent>('canonical-event');
    if (event === null || event === undefined || !event.shipmentId) {
      return NodeOutputBuilder.of('invalid');
    }
    state.canonical = event;
    const b = event.body;

    state.raw = {
      'shipmentId':          event.shipmentId,
      'scanSeq':             b.scanSeq,
      'rawTimestamp':        b.rawTimestamp,
      'rawDispatchAt':       b.rawDispatchAt,
      'rawStatus':           statusFor(event),
      'carrier':             b.carrier,
      'ipAddress':           b.ipAddress,
      'latitude':            b.latitude,
      'longitude':           b.longitude,
      'legFromLat':          b.legFromLat,
      'legFromLng':          b.legFromLng,
      'originLat':           b.originLat,
      'originLng':           b.originLng,
      'destLat':             b.destLat,
      'destLng':             b.destLng,
      'weight':              b.weight,
      'weightUnit':          b.weightUnit,
      'recipientName':       b.recipientName,
      'recipientEmail':      b.recipientEmail,
      'recipientPhone':      b.recipientPhone,
      'recipientAddress':    b.recipientAddress,
      'recipientCountry':    b.recipientCountry,
      'marketingConsent':    b.marketingConsent,
      'rawPromisedDeliveryAt': b.rawPromisedDeliveryAt,
      'lineItems':           b.lineItems.length > 0 ? b.lineItems.map((li) => ({ ...li })) : [{ 'productId': 'PROD-001', 'quantity': 1 }],
      'facilityId':          b.facilityId,
      'lawfulBasis':         b.lawfulBasis,
      'specialCategory':     b.specialCategory,
      'disruptionReason':    b.disruptionReason,
    };

    return NodeOutputBuilder.of('parsed');
  },
};
// #endregion parse-event-node
