/**
 * validate-event: shared ingest transform — coerced records → CanonicalEvents.
 *
 * The final shared node in every source's ingest sub-DAG. It assembles each
 * coerced record into the canonical event shape, derives the per-record `kind`
 * (the customs/delivery feed mixes customs-events + delivery-confirmations),
 * attaches the OPTIONAL pre-resolved fields some sources supply (Stage 2 will
 * branch on these), validates the required header + coords, and appends the
 * valid events to state.ingestedEvents. Records missing a shipmentId are dropped
 * (the source's reject path); the node never throws.
 *
 * OPTIONAL pre-resolved fields per source:
 *   - geo            — the JSON API feed carries resolved country/region.
 *   - consentHandled — set when a source pre-handled consent (none in Stage 1
 *                      sources; the field is wired so Stage 2 can populate it).
 *   - pii            — whether the event carries recipient PII (delivery/facility
 *                      scans do; bare position pings may not).
 *
 * Routes 'validated' (always — invalid records are filtered, not routed).
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';
import type { CanonicalEvent } from '../../entities/CanonicalEvent.ts';

import type { NodeInterface } from '@noocodex/dagonizer';

// #region validate-event-node
function lawfulBasis(value: unknown): CanonicalEvent['body']['lawfulBasis'] {
  return value === 'contract' || value === 'consent' || value === 'legitimate-interest' || value === 'none'
    ? value
    : 'contract';
}

function specialCategory(value: unknown): CanonicalEvent['body']['specialCategory'] {
  return value === 'health' ? 'health' : 'none';
}

function weightUnit(value: unknown): CanonicalEvent['body']['weightUnit'] {
  return value === 'lb' || value === 'kg' || value === 'g' || value === 'oz' ? value : 'kg';
}

function num(value: unknown): number {
  return typeof value === 'number' && isFinite(value) ? value : 0;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function bool(value: unknown): boolean {
  return value === true;
}

function lineItems(value: unknown): Array<{ 'productId': string; 'quantity': number }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ 'productId': string; 'quantity': number }> = [];
  for (const li of value) {
    if (li !== null && typeof li === 'object' && !Array.isArray(li)) {
      const o = li as Record<string, unknown>;
      out.push({ 'productId': str(o['productId']), 'quantity': num(o['quantity']) || 1 });
    }
  }
  return out;
}

/** Derive the canonical kind for a record, given the source's primary kind. */
function kindFor(sourceKind: CanonicalEvent['kind'], rec: Record<string, unknown>): CanonicalEvent['kind'] {
  // The customs/delivery feed mixes two kinds — a delivered flag distinguishes.
  if (sourceKind === 'customs-event') {
    return bool(rec['delivered']) ? 'delivery-confirmation' : 'customs-event';
  }
  return sourceKind;
}

export const validateEvent: NodeInterface<CartographerState, 'validated', CartographerServices> = {
  'name': 'validate-event',
  'outputs': ['validated'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const source = state.currentSource;
    const events: CanonicalEvent[] = [];

    for (const rec of state.mappedRecords) {
      const shipmentId = str(rec['shipmentId']);
      const eventId    = str(rec['eventId']);
      // Reject records lacking the canonical header.
      if (shipmentId.length === 0 || eventId.length === 0) continue;

      const kind = kindFor(source.kind, rec);
      const hasPii = str(rec['recipientName']).length > 0 || str(rec['recipientEmail']).length > 0;

      const event: CanonicalEvent = {
        'shipmentId':   shipmentId,
        'eventId':      eventId,
        'epochMs':      num(rec['epochMs']),
        'kind':         kind,
        'sourceId':     source.sourceId,
        'sourceFormat': source.format,
        'body': {
          'scanSeq':          num(rec['scanSeq']),
          'latitude':         num(rec['latitude']),
          'longitude':        num(rec['longitude']),
          'ipAddress':        str(rec['ipAddress']),
          'legFromLat':       num(rec['legFromLat']),
          'legFromLng':       num(rec['legFromLng']),
          'originLat':        num(rec['originLat']),
          'originLng':        num(rec['originLng']),
          'destLat':          num(rec['destLat']),
          'destLng':          num(rec['destLng']),
          'carrier':          str(rec['carrier']),
          'facilityId':       str(rec['facilityId']),
          'status':           str(rec['status']),
          'weight':           num(rec['weight']),
          'weightUnit':       weightUnit(rec['weightUnit']),
          'lineItems':        lineItems(rec['lineItems']),
          'rawTimestamp':          str(rec['epochRaw']),
          'rawDispatchAt':         str(rec['dispatchRaw']),
          'rawPromisedDeliveryAt': str(rec['promisedRaw']),
          'disruptionReason':      str(rec['disruptionReason']),
          'tempC':            num(rec['tempC']),
          'humidityPct':      num(rec['humidityPct']),
          'shockG':           num(rec['shockG']),
          'customsStatus':    str(rec['customsStatus']),
          'delivered':        bool(rec['delivered']),
          'recipientName':    str(rec['recipientName']),
          'recipientEmail':   str(rec['recipientEmail']),
          'recipientPhone':   str(rec['recipientPhone']),
          'recipientAddress': str(rec['recipientAddress']),
          'recipientCountry': str(rec['recipientCountry']),
          'marketingConsent': bool(rec['marketingConsent']),
          'lawfulBasis':      lawfulBasis(rec['lawfulBasis']),
          'specialCategory':  specialCategory(rec['specialCategory']),
        },
        'pii': hasPii,
      };

      // RICH sources pre-resolve geo (country/continent/region from the coords).
      const geoCountry   = str(rec['geoCountry']);
      const geoContinent = str(rec['geoContinent']);
      const geoRegion    = str(rec['geoRegion']);
      if (geoCountry.length > 0 && geoRegion.length > 0) {
        event.geo = { 'country': geoCountry, 'continent': geoContinent, 'region': geoRegion };
      }

      events.push(event);
    }

    state.ingestedEvents = events;
    return { 'output': 'validated' };
  },
};
// #endregion validate-event-node
