/**
 * canonicalizeRecipient: facility-scan + delivery-confirmation. Fills the
 * recipient-PII slots of state.normalized AND projects the PII into
 * state.currentEvent (the ShipmentEvent shape the gdpr nodes consume). Reads
 * state.raw PII fields (projected by parseVariant).
 *
 * Routes 'done'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region canonicalize-recipient-node
export class CanonicalizeRecipientNode extends ScalarNode<CartographerState, 'done', CartographerServices> {
  readonly 'name' = 'canonicalize-recipient';
  readonly 'outputs' = ['done'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'done'>> {
    const raw  = state.raw;
    const norm = state.normalized;

    state.normalized = {
      ...norm,
      'recipientName':    raw.recipientName,
      'recipientEmail':   raw.recipientEmail,
      'recipientPhone':   raw.recipientPhone,
      'recipientAddress': raw.recipientAddress,
      'recipientCountry': raw.recipientCountry,
      'marketingConsent': raw.marketingConsent,
    };

    state.currentEvent = {
      'shipmentId':        norm.shipmentId,
      'timestamp':         norm.isoTimestamp,
      'eventType':         norm.status,
      'latitude':          norm.latitude,
      'longitude':         norm.longitude,
      'carrier':           norm.carrierName,
      'facilityId':        norm.facilityId,
      'recipientName':     raw.recipientName,
      'recipientEmail':    raw.recipientEmail,
      'recipientPhone':    raw.recipientPhone,
      'recipientAddress':  raw.recipientAddress,
      'recipientCountry':  raw.recipientCountry,
      'marketingConsent':  raw.marketingConsent,
      'promisedDeliveryAt': new Date(norm.promisedEpochMs).toISOString(),
    };

    return NodeOutputBuilder.of('done');
  }
}

export const canonicalizeRecipient = new CanonicalizeRecipientNode();
// #endregion canonicalize-recipient-node
