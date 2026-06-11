/**
 * classify: derives the canonical classification for a normalized shipment.
 *
 * Reads state.raw.rawStatus and state.normalized (scalar-canonicalized by the
 * normalize node) and derives, via EventClassifier:
 *   - eventType   from the free-text rawStatus (keyword dispatch map)
 *   - serviceTier from carrierId + weightGrams
 *   - sizeTier    from weightGrams
 * These are written back onto state.normalized.
 *
 * It then projects the classified scan into the ShipmentEvent shape on
 * state.currentEvent so the downstream GDPR nodes can consume it unchanged
 * (geo enrichment already ran before normalize/classify in the geo-first order).
 *
 * Routes 'classified' on success. SCAN is the documented default eventType for
 * statuses that match no keyword, so there is no reject route here.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { EventClassifier } from '../services.ts';

import { NodeOutputBuilder, type NodeInterface } from '@noocodex/dagonizer';

// #region classify-node
export const classify: NodeInterface<CartographerState, 'classified', CartographerServices> = {
  'name': 'classify',
  'outputs': ['classified'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const norm = state.normalized;

    // Derive the canonical classification from the raw status + normalized scalars.
    const eventType   = EventClassifier.eventType(state.raw.rawStatus);
    const serviceTier = EventClassifier.serviceTier(norm.carrierId, norm.weightGrams);
    const sizeTier    = EventClassifier.sizeTier(norm.weightGrams);

    state.normalized = {
      ...norm,
      'eventType':   eventType,
      'serviceTier': serviceTier,
      'sizeTier':    sizeTier,
    };

    // Project the classified scan into the ShipmentEvent shape the GDPR nodes
    // consume. (GDPR may further coarsen these coords as location-PII.)
    state.currentEvent = {
      'shipmentId':        norm.shipmentId,
      'timestamp':         norm.isoTimestamp,
      'eventType':         eventType,
      'latitude':          norm.latitude,
      'longitude':         norm.longitude,
      'carrier':           norm.carrierName,
      'facilityId':        norm.facilityId,
      'recipientName':     norm.recipientName,
      'recipientEmail':    norm.recipientEmail,
      'recipientPhone':    norm.recipientPhone,
      'recipientAddress':  norm.recipientAddress,
      'recipientCountry':  norm.recipientCountry,
      'marketingConsent':  norm.marketingConsent,
      'promisedDeliveryAt': new Date(norm.promisedEpochMs).toISOString(),
    };

    return NodeOutputBuilder.of('classified');
  },
};
// #endregion classify-node
