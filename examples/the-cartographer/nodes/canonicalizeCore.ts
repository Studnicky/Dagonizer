/**
 * canonicalizeCore: shared scalar canonicalization for ALL event types (the
 * normalize+classify subset MINUS facility/PII). Writes only the CORE slots of
 * state.normalized: timestamps, carrier, country, weight=0 placeholder,
 * status/serviceTier/sizeTier, leg/geo coords, scanSeq. Facility slots
 * (weightGrams/facilityId/lineItems) and PII slots are filled by
 * canonicalizeFacility / canonicalizeRecipient. Reads state.raw +
 * state.geoContext.timezone.
 *
 * serviceTier and sizeTier are derived from weightGrams=0 here (the placeholder
 * value); canonicalizeFacility overrides both after computing the real
 * weightGrams from the facility-scan body. For all non-facility types, the 0-gram
 * tiers are the correct final values.
 *
 * Routes 'normalized'; 'rejected' when the scan timestamp is unparseable.
 */

import type { CartographerState } from '../CartographerState.ts';
import {
  CarrierRegistry,
  CountryCodes,
  Disruptions,
  EventClassifier,
  TimeNormalizer,
  TimeZoneResolver,
} from '../services.ts';

import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

// #region canonicalize-core-node
export class CanonicalizeCoreNode extends ScalarNode<CartographerState, 'normalized' | 'rejected'> {
  readonly 'name' = 'canonicalize-core';
  readonly 'outputs' = ['normalized', 'rejected'] as const;

  override get outputSchema(): Record<'normalized' | 'rejected', SchemaObjectType> {
    return {
      'normalized': { 'type': 'object' },
      'rejected':   { 'type': 'object' },
    };
  }

  protected override async executeOne(state: CartographerState, _context: NodeContextType): Promise<NodeOutputType<'normalized' | 'rejected'>> {
    const raw = state.raw;

    const epochMs = TimeNormalizer.toEpochMs(raw.rawTimestamp);
    if (!isFinite(epochMs) || epochMs <= 0) {
      return NodeOutputBuilder.of('rejected');
    }

    const dispatchEpochMs = TimeNormalizer.toEpochMs(raw.rawDispatchAt);
    const validDispatch = isFinite(dispatchEpochMs) && dispatchEpochMs > 0 ? dispatchEpochMs : epochMs;

    const promisedEpochMs = TimeNormalizer.toEpochMs(raw.rawPromisedDeliveryAt);
    const validPromised = isFinite(promisedEpochMs) && promisedEpochMs > 0 ? promisedEpochMs : validDispatch + 7 * 86_400_000;

    const { localIso, utcOffset } = TimeZoneResolver.localParts(epochMs, state.geoContext.timezone);

    const { carrierId, carrierName } = CarrierRegistry.canonical(raw.carrier);
    const countryIso3 = CountryCodes.toIso3(raw.recipientCountry);
    const disruptionHours = Disruptions.hoursFor(raw.disruptionReason);

    // Derive classification at weightGrams=0. canonicalizeFacility will override
    // weightGrams/serviceTier/sizeTier with the real weight for facility-scan events.
    const status      = EventClassifier.eventType(raw.rawStatus);
    const serviceTier = EventClassifier.serviceTier(carrierId, 0);
    const sizeTier    = EventClassifier.sizeTier(0);

    state.normalized = {
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

    return NodeOutputBuilder.of('normalized');
  }
}

export const canonicalizeCore = new CanonicalizeCoreNode();
// #endregion canonicalize-core-node
