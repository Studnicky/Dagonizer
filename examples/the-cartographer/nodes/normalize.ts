/**
 * normalize: scalar canonicalization of a raw tracking scan (runs after geo).
 *
 * Reads state.raw and the scan's timezone (from state.geoContext, set by the
 * geo-first geo-context node). Canonicalizes:
 *   - TimeNormalizer.toEpochMs for the scan + dispatch timestamps
 *   - TimeZoneResolver.localParts for LOCAL time + UTC offset at the scan's zone
 *   - CarrierRegistry.canonical for carrier alias → carrierId / carrierName
 *   - CountryCodes.toIso3 for country
 *   - Units.toGrams for weight
 *   - Disruptions.hoursFor to recover the journey's disruption hours
 *
 * It does NOT derive status, serviceTier, or sizeTier — that is classify's job.
 * Carries journey fields (scanSeq, leg coords, origin/dest) through.
 *
 * Routes 'normalized'; 'rejected' when the scan timestamp is unparseable.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import {
  CarrierRegistry,
  CountryCodes,
  Disruptions,
  TimeNormalizer,
  TimeZoneResolver,
  Units,
} from '../services.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region normalize-node
export class NormalizeNode extends ScalarNode<CartographerState, 'normalized' | 'rejected', CartographerServices> {
  readonly 'name' = 'normalize';
  readonly 'outputs' = ['normalized', 'rejected'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'normalized' | 'rejected'>> {
    const raw = state.raw;

    const epochMs = TimeNormalizer.toEpochMs(raw.rawTimestamp);
    if (!isFinite(epochMs) || epochMs <= 0) {
      return NodeOutputBuilder.of('rejected');
    }

    const dispatchEpochMs = TimeNormalizer.toEpochMs(raw.rawDispatchAt);
    const validDispatch = isFinite(dispatchEpochMs) && dispatchEpochMs > 0 ? dispatchEpochMs : epochMs;

    const promisedEpochMs = TimeNormalizer.toEpochMs(raw.rawPromisedDeliveryAt);
    const validPromised = isFinite(promisedEpochMs) && promisedEpochMs > 0 ? promisedEpochMs : validDispatch + 7 * 86_400_000;

    // Local time at the scan's timezone (resolved by geo-context).
    const { localIso, utcOffset } = TimeZoneResolver.localParts(epochMs, state.geoContext.timezone);

    const { carrierId, carrierName } = CarrierRegistry.canonical(raw.carrier);
    const countryIso3 = CountryCodes.toIso3(raw.recipientCountry);
    const weightGrams = Units.toGrams(raw.weight, raw.weightUnit);
    const disruptionHours = Disruptions.hoursFor(raw.disruptionReason);

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
      'weightGrams':      weightGrams,
      // status (lifecycle) / serviceTier / sizeTier are derived by the classify node.
      'status':           'SCAN',
      'serviceTier':      'standard',
      'sizeTier':         'small',
      'lineItems':        raw.lineItems,
      'facilityId':       raw.facilityId,
      'latitude':         raw.latitude,
      'longitude':        raw.longitude,
      'legFromLat':       raw.legFromLat,
      'legFromLng':       raw.legFromLng,
      'originLat':        raw.originLat,
      'originLng':        raw.originLng,
      'destLat':          raw.destLat,
      'destLng':          raw.destLng,
      'recipientName':    raw.recipientName,
      'recipientEmail':   raw.recipientEmail,
      'recipientPhone':   raw.recipientPhone,
      'recipientAddress': raw.recipientAddress,
      'recipientCountry': raw.recipientCountry,
      'marketingConsent': raw.marketingConsent,
      'promisedEpochMs':  validPromised,
      'disruptionHours':  disruptionHours,
      'disruptionReason': raw.disruptionReason,
    };

    return NodeOutputBuilder.of('normalized');
  }
}

export const normalize = new NormalizeNode();
// #endregion normalize-node
