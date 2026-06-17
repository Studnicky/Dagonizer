/**
 * canonicalizeCoreBatch: batch counterpart to canonicalizeCore. Processes every
 * item in state.rawBatch in one pass, writing state.normalizedBatch in the same
 * index-parallel layout.
 *
 * Runs the EXACT same timestamp/carrier/country/classification logic as
 * CanonicalizeCoreNode for each item. Items whose scan timestamp is unparseable
 * receive a zeroed NormalizedShipment (epochMs=0, all strings empty/default) so
 * rawBatch[i] and normalizedBatch[i] stay parallel. The batch always routes
 * 'normalized'; per-item rejection is expressed via the zeroed sentinel.
 *
 * serviceTier and sizeTier are derived at weightGrams=0, matching the per-event
 * node. canonicalizeFacilityBatch overrides those fields for facility-scan items.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import type { NormalizedShipment } from '../entities/NormalizedShipment.ts';
import {
  CarrierRegistry,
  CountryCodes,
  Disruptions,
  EventClassifier,
  TimeNormalizer,
  TimeZoneResolver,
} from '../services.ts';

import {
  NodeOutputBuilder,
  type NodeContextInterface,
  type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region canonicalize-core-batch-node
export class CanonicalizeCoreBatchNode extends ScalarNode<CartographerState, 'normalized', CartographerServices> {
  readonly 'name' = 'canonicalize-core-batch';
  readonly 'outputs' = ['normalized'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'normalized'>> {
    state.normalizedBatch = [];

    for (let i = 0; i < state.rawBatch.length; i++) {
      const raw = state.rawBatch[i];
      if (raw === undefined) continue;
      // Skip items whose geo validation failed — they produce no enriched output.
      if (state.batchSkipMask[i] === true) {
        // Push a sentinel to keep index alignment for downstream arrays.
        state.normalizedBatch.push({
          'shipmentId': raw.shipmentId, 'scanSeq': raw.scanSeq,
          'epochMs': 0, 'dispatchEpochMs': 0,
          'isoTimestamp': '', 'localIso': '', 'utcOffset': '',
          'carrierId': '', 'carrierName': '', 'countryIso3': 'UNK',
          'weightGrams': 0, 'status': 'SCAN', 'serviceTier': 'standard', 'sizeTier': 'small',
          'lineItems': [{ 'productId': '', 'quantity': 1 }], 'facilityId': '',
          'latitude': 0, 'longitude': 0, 'legFromLat': 0, 'legFromLng': 0,
          'originLat': 0, 'originLng': 0, 'destLat': 0, 'destLng': 0,
          'recipientName': '', 'recipientEmail': '', 'recipientPhone': '',
          'recipientAddress': '', 'recipientCountry': '', 'marketingConsent': false,
          'promisedEpochMs': 0, 'disruptionHours': 0, 'disruptionReason': '',
        });
        continue;
      }
      const timezone = state.geoContextBatch[i]?.timezone ?? 'UTC';

      const epochMs = TimeNormalizer.toEpochMs(raw.rawTimestamp);

      if (!isFinite(epochMs) || epochMs <= 0) {
        // Invalid timestamp: push a zeroed sentinel to preserve index alignment.
        const { carrierId, carrierName } = CarrierRegistry.canonical(raw.carrier);
        const zeroed: NormalizedShipment = {
          'shipmentId':       raw.shipmentId,
          'scanSeq':          raw.scanSeq,
          'epochMs':          0,
          'dispatchEpochMs':  0,
          'isoTimestamp':     '',
          'localIso':         '',
          'utcOffset':        '',
          'carrierId':        carrierId,
          'carrierName':      carrierName,
          'countryIso3':      CountryCodes.toIso3(raw.recipientCountry),
          'weightGrams':      0,
          'status':           EventClassifier.eventType(raw.rawStatus),
          'serviceTier':      EventClassifier.serviceTier(carrierId, 0),
          'sizeTier':         EventClassifier.sizeTier(0),
          'lineItems':        [{ 'productId': '', 'quantity': 1 }],
          'facilityId':       '',
          'latitude':         raw.latitude,
          'longitude':        raw.longitude,
          'legFromLat':       raw.legFromLat,
          'legFromLng':       raw.legFromLng,
          'originLat':        raw.originLat,
          'originLng':        raw.originLng,
          'destLat':          raw.destLat,
          'destLng':          raw.destLng,
          'recipientName':    '',
          'recipientEmail':   '',
          'recipientPhone':   '',
          'recipientAddress': '',
          'recipientCountry': raw.recipientCountry,
          'marketingConsent': false,
          'promisedEpochMs':  0,
          'disruptionHours':  Disruptions.hoursFor(raw.disruptionReason),
          'disruptionReason': raw.disruptionReason,
        };
        state.normalizedBatch.push(zeroed);
        continue;
      }

      const dispatchEpochMs = TimeNormalizer.toEpochMs(raw.rawDispatchAt);
      const validDispatch = isFinite(dispatchEpochMs) && dispatchEpochMs > 0 ? dispatchEpochMs : epochMs;

      const promisedEpochMs = TimeNormalizer.toEpochMs(raw.rawPromisedDeliveryAt);
      const validPromised = isFinite(promisedEpochMs) && promisedEpochMs > 0 ? promisedEpochMs : validDispatch + 7 * 86_400_000;

      const { localIso, utcOffset } = TimeZoneResolver.localParts(epochMs, timezone);

      const { carrierId, carrierName } = CarrierRegistry.canonical(raw.carrier);
      const countryIso3 = CountryCodes.toIso3(raw.recipientCountry);
      const disruptionHours = Disruptions.hoursFor(raw.disruptionReason);

      // Derive classification at weightGrams=0. canonicalizeFacilityBatch will
      // override weightGrams/serviceTier/sizeTier with the real weight for
      // facility-scan events.
      const status      = EventClassifier.eventType(raw.rawStatus);
      const serviceTier = EventClassifier.serviceTier(carrierId, 0);
      const sizeTier    = EventClassifier.sizeTier(0);

      const normalized: NormalizedShipment = {
        'shipmentId':       raw.shipmentId,
        'scanSeq':          raw.scanSeq,
        'epochMs':          epochMs,
        'dispatchEpochMs':  validDispatch,
        'isoTimestamp':     TimeNormalizer.toIso(epochMs),
        'localIso':         localIso,
        'utcOffset':        utcOffset,
        'carrierId':        carrierId,
        'carrierName':      carrierName,
        'countryIso3':      countryIso3,
        'weightGrams':      0,
        'status':           status,
        'serviceTier':      serviceTier,
        'sizeTier':         sizeTier,
        'lineItems':        [{ 'productId': '', 'quantity': 1 }],
        'facilityId':       '',
        'latitude':         raw.latitude,
        'longitude':        raw.longitude,
        'legFromLat':       raw.legFromLat,
        'legFromLng':       raw.legFromLng,
        'originLat':        raw.originLat,
        'originLng':        raw.originLng,
        'destLat':          raw.destLat,
        'destLng':          raw.destLng,
        'recipientName':    '',
        'recipientEmail':   '',
        'recipientPhone':   '',
        'recipientAddress': '',
        'recipientCountry': raw.recipientCountry,
        'marketingConsent': false,
        'promisedEpochMs':  validPromised,
        'disruptionHours':  disruptionHours,
        'disruptionReason': raw.disruptionReason,
      };
      state.normalizedBatch.push(normalized);
    }

    return NodeOutputBuilder.of('normalized');
  }
}

export const canonicalizeCoreBatch = new CanonicalizeCoreBatchNode();
// #endregion canonicalize-core-batch-node
