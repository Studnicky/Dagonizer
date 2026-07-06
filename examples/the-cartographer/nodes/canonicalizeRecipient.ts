/**
 * canonicalizeRecipient: facility-scan + delivery-confirmation. Fills the
 * recipient-PII slots of state.normalized AND projects the PII into
 * state.currentEvent (the ShipmentEvent shape the gdpr nodes consume). Reads
 * state.raw PII fields (projected by parseVariant).
 *
 * Routes 'done'.
 */

import type { CartographerState } from '../CartographerState.ts';

import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region canonicalize-recipient-node
export class CanonicalizeRecipientNode extends MonadicNode<CartographerState, 'done'> {
  readonly 'name' = 'canonicalize-recipient';
  readonly 'outputs' = ['done'] as const;

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return {
      'done': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'done', CartographerState>> {
    for (const item of batch) {
      const state = item.state;
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
    }

    return RoutedBatch.create('done', batch);
  }
}

export const canonicalizeRecipient = new CanonicalizeRecipientNode();
// #endregion canonicalize-recipient-node
