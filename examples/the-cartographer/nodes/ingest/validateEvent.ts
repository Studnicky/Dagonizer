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

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region validate-event-node
export class ValidateEventNode implements NodeInterface<CartographerState, 'validated', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'validate-event';
  readonly 'outputs' = ['validated'] as const;

  private static lawfulBasis(value: unknown): CanonicalEvent['body']['lawfulBasis'] {
    return value === 'contract' || value === 'consent' || value === 'legitimate-interest' || value === 'none'
      ? value
      : 'contract';
  }

  private static specialCategory(value: unknown): CanonicalEvent['body']['specialCategory'] {
    return value === 'health' ? 'health' : 'none';
  }

  private static weightUnit(value: unknown): CanonicalEvent['body']['weightUnit'] {
    return value === 'lb' || value === 'kg' || value === 'g' || value === 'oz' ? value : 'kg';
  }

  private static num(value: unknown): number {
    return typeof value === 'number' && isFinite(value) ? value : 0;
  }

  private static str(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private static bool(value: unknown): boolean {
    return value === true;
  }

  private static lineItems(value: unknown): Array<{ 'productId': string; 'quantity': number }> {
    if (!Array.isArray(value)) return [];
    const out: Array<{ 'productId': string; 'quantity': number }> = [];
    for (const li of value) {
      if (li !== null && typeof li === 'object' && !Array.isArray(li)) {
        const o = li as Record<string, unknown>;
        out.push({ 'productId': ValidateEventNode.str(o['productId']), 'quantity': ValidateEventNode.num(o['quantity']) || 1 });
      }
    }
    return out;
  }

  /** Derive the canonical kind for a record, given the source's primary kind. */
  private static kindFor(sourceKind: CanonicalEvent['kind'], rec: Record<string, unknown>): CanonicalEvent['kind'] {
    // The customs/delivery feed mixes two kinds — a delivered flag distinguishes.
    if (sourceKind === 'customs-event') {
      return ValidateEventNode.bool(rec['delivered']) ? 'delivery-confirmation' : 'customs-event';
    }
    return sourceKind;
  }

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'validated'>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const source = state.currentSource;
    const events: CanonicalEvent[] = [];

    for (const rec of state.mappedRecords) {
      const shipmentId = ValidateEventNode.str(rec['shipmentId']);
      const eventId    = ValidateEventNode.str(rec['eventId']);
      // Reject records lacking the canonical header.
      if (shipmentId.length === 0 || eventId.length === 0) continue;

      const kind = ValidateEventNode.kindFor(source.kind, rec);
      const hasPii = ValidateEventNode.str(rec['recipientName']).length > 0 || ValidateEventNode.str(rec['recipientEmail']).length > 0;

      const event: CanonicalEvent = {
        'shipmentId':        shipmentId,
        'eventId':           eventId,
        'epochMs':           ValidateEventNode.num(rec['epochMs']),
        'kind':              kind,
        'sourceId':          source.sourceId,
        'sourceFormat':      source.format,
        'sourceCompression': source.compression,
        'body': {
          'scanSeq':          ValidateEventNode.num(rec['scanSeq']),
          'latitude':         ValidateEventNode.num(rec['latitude']),
          'longitude':        ValidateEventNode.num(rec['longitude']),
          'ipAddress':        ValidateEventNode.str(rec['ipAddress']),
          'legFromLat':       ValidateEventNode.num(rec['legFromLat']),
          'legFromLng':       ValidateEventNode.num(rec['legFromLng']),
          'originLat':        ValidateEventNode.num(rec['originLat']),
          'originLng':        ValidateEventNode.num(rec['originLng']),
          'destLat':          ValidateEventNode.num(rec['destLat']),
          'destLng':          ValidateEventNode.num(rec['destLng']),
          'carrier':          ValidateEventNode.str(rec['carrier']),
          'facilityId':       ValidateEventNode.str(rec['facilityId']),
          'status':           ValidateEventNode.str(rec['status']),
          'weight':           ValidateEventNode.num(rec['weight']),
          'weightUnit':       ValidateEventNode.weightUnit(rec['weightUnit']),
          'lineItems':        ValidateEventNode.lineItems(rec['lineItems']),
          'rawTimestamp':          ValidateEventNode.str(rec['epochRaw']),
          'rawDispatchAt':         ValidateEventNode.str(rec['dispatchRaw']),
          'rawPromisedDeliveryAt': ValidateEventNode.str(rec['promisedRaw']),
          'disruptionReason':      ValidateEventNode.str(rec['disruptionReason']),
          'tempC':            ValidateEventNode.num(rec['tempC']),
          'humidityPct':      ValidateEventNode.num(rec['humidityPct']),
          'shockG':           ValidateEventNode.num(rec['shockG']),
          'customsStatus':    ValidateEventNode.str(rec['customsStatus']),
          'delivered':        ValidateEventNode.bool(rec['delivered']),
          'recipientName':    ValidateEventNode.str(rec['recipientName']),
          'recipientEmail':   ValidateEventNode.str(rec['recipientEmail']),
          'recipientPhone':   ValidateEventNode.str(rec['recipientPhone']),
          'recipientAddress': ValidateEventNode.str(rec['recipientAddress']),
          'recipientCountry': ValidateEventNode.str(rec['recipientCountry']),
          'marketingConsent': ValidateEventNode.bool(rec['marketingConsent']),
          'lawfulBasis':      ValidateEventNode.lawfulBasis(rec['lawfulBasis']),
          'specialCategory':  ValidateEventNode.specialCategory(rec['specialCategory']),
        },
        'pii': hasPii,
      };

      // RICH sources pre-resolve geo (country/continent/region from the coords).
      const geoCountry   = ValidateEventNode.str(rec['geoCountry']);
      const geoContinent = ValidateEventNode.str(rec['geoContinent']);
      const geoRegion    = ValidateEventNode.str(rec['geoRegion']);
      if (geoCountry.length > 0 && geoRegion.length > 0) {
        event.geo = { 'country': geoCountry, 'continent': geoContinent, 'region': geoRegion };
      }

      events.push(event);
    }

    state.ingestedEvents = events;
    return NodeOutputBuilder.of('validated');
  }
}

export const validateEvent = new ValidateEventNode();
// #endregion validate-event-node
