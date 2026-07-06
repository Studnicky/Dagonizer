/**
 * CanonicalEventVariant: the discriminated-union model of the five event types.
 *
 * Each member carries ONLY the fields its `eventType` owns (its `eventType` is
 * pinned via `const`, and its `body` lists exactly that type's fields). The
 * union is the canonical model for enrichment; the five per-type embedded DAGs
 * operate on a narrowed member, never the fat flat shape.
 *
 * Discriminated on `eventType`:
 *   - 'position-ping'         — a moving asset's satellite position fix
 *   - 'facility-scan'         — a parcel scanned at a depot/facility
 *   - 'sensor-reading'        — cold-chain telemetry (temp / humidity / shock)
 *   - 'customs-event'         — a customs clearance / hold event
 *   - 'delivery-confirmation' — proof-of-delivery (the single terminal)
 *
 * Common envelope: `shipmentId`, `eventId`, `epochMs`, `eventType`,
 * `sourceId`, `sourceFormat`, `sourceCompression`.
 *
 * OPTIONAL pre-resolved fields (ingest-boundary; Stage 2 branches on them):
 *   - `geo?`            — RICH sources (JSON API) already carry resolved geo → skip geo-lookup.
 *   - `consentHandled?` — a source that already handled consent/PII → skip redaction.
 *   - `pii?`            — whether the event carries recipient PII at all.
 *
 * `CanonicalEventVariantBuilder.from(partial)` materialises a complete
 * 'position-ping' variant from a partial input, filling every required
 * envelope/body field with a default so the producer never leaves a hole.
 * Defaults live in one place (the module-level constant).
 */

// #region canonical-event-variant-entity
import type { SourcePayload } from './SourcePayload.ts';
import {
  CustomsEventSchema,
  type CustomsEvent,
} from './events/CustomsEvent.ts';
import {
  DeliveryConfirmationEventSchema,
  type DeliveryConfirmationEvent,
} from './events/DeliveryConfirmationEvent.ts';
import {
  FacilityScanEventSchema,
  type FacilityScanEvent,
} from './events/FacilityScanEvent.ts';
import {
  PositionPingEventSchema,
  type PositionPingEvent,
} from './events/PositionPingEvent.ts';
import {
  SensorReadingEventSchema,
  type SensorReadingEvent,
} from './events/SensorReadingEvent.ts';
import { Validator } from '@studnicky/dagonizer/validation';

export const CanonicalEventVariantSchema = {
  '$id':     'https://noocodex.dev/schemas/cartographer/CanonicalEventVariant',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'oneOf': [
    PositionPingEventSchema,
    FacilityScanEventSchema,
    SensorReadingEventSchema,
    CustomsEventSchema,
    DeliveryConfirmationEventSchema,
  ],
} as const;

export type CanonicalEventVariant =
  | PositionPingEvent
  | FacilityScanEvent
  | SensorReadingEvent
  | CustomsEvent
  | DeliveryConfirmationEvent;

const canonicalEventVariantValidator = Validator.compile<CanonicalEventVariant>(CanonicalEventVariantSchema);

// Complete 'position-ping' default. The producer overrides only what it knows;
// every required envelope/body field is present so the consumer never sees a hole.
const POSITION_PING_DEFAULT: PositionPingEvent = {
  'shipmentId': 'unknown',
  'eventId': 'unknown',
  'epochMs': 0,
  'eventType': 'position-ping',
  'sourceId': 'unknown',
  'sourceFormat': 'json',
  'sourceCompression': 'none',
  'body': {
    'scanSeq': 0,
    'latitude': 0,
    'longitude': 0,
    'ipAddress': '',
    'localeTag': '',
    'countryCode': '',
    'legFromLat': 0,
    'legFromLng': 0,
    'originLat': 0,
    'originLng': 0,
    'destLat': 0,
    'destLng': 0,
    'carrier': '',
    'status': '',
    'rawTimestamp': '',
    'address': '',
    'phone': '',
  },
};

// Per-type body defaults for fromSourcePayload. Each constant covers ONLY the
// fields owned by that type. Declaration order matches the schema's `required`
// array for V8 shape stability.

const POSITION_PING_BODY_DEFAULT: PositionPingEvent['body'] = {
  'scanSeq':      0,
  'latitude':     0,
  'longitude':    0,
  'ipAddress':    '',
  'localeTag':    '',
  'countryCode':  '',
  'legFromLat':   0,
  'legFromLng':   0,
  'originLat':    0,
  'originLng':    0,
  'destLat':      0,
  'destLng':      0,
  'carrier':      '',
  'status':       '',
  'rawTimestamp': '',
  'address':      '',
  'phone':        '',
};

const FACILITY_SCAN_BODY_DEFAULT: FacilityScanEvent['body'] = {
  'scanSeq':              0,
  'latitude':             0,
  'longitude':            0,
  'ipAddress':            '',
  'localeTag':            '',
  'countryCode':          '',
  'legFromLat':           0,
  'legFromLng':           0,
  'originLat':            0,
  'originLng':            0,
  'destLat':              0,
  'destLng':              0,
  'carrier':              '',
  'status':               '',
  'rawTimestamp':         '',
  'facilityId':           '',
  'weight':               0,
  'weightUnit':           'kg',
  'lineItems':            [],
  'rawDispatchAt':        '',
  'rawPromisedDeliveryAt': '',
  'disruptionReason':     '',
  'recipientName':        '',
  'recipientEmail':       '',
  'recipientPhone':       '',
  'recipientAddress':     '',
  'recipientCountry':     '',
  'marketingConsent':     false,
  'lawfulBasis':          'contract',
  'specialCategory':      'none',
  'address':              '',
  'phone':                '',
};

const SENSOR_READING_BODY_DEFAULT: SensorReadingEvent['body'] = {
  'scanSeq':      0,
  'latitude':     0,
  'longitude':    0,
  'ipAddress':    '',
  'localeTag':    '',
  'countryCode':  '',
  'legFromLat':   0,
  'legFromLng':   0,
  'originLat':    0,
  'originLng':    0,
  'destLat':      0,
  'destLng':      0,
  'carrier':      '',
  'status':       '',
  'rawTimestamp': '',
  'tempC':        0,
  'humidityPct':  0,
  'shockG':       0,
  'address':      '',
  'phone':        '',
};

const CUSTOMS_EVENT_BODY_DEFAULT: CustomsEvent['body'] = {
  'scanSeq':       0,
  'latitude':      0,
  'longitude':     0,
  'ipAddress':     '',
  'localeTag':     '',
  'countryCode':   '',
  'legFromLat':    0,
  'legFromLng':    0,
  'originLat':     0,
  'originLng':     0,
  'destLat':       0,
  'destLng':       0,
  'carrier':       '',
  'status':        '',
  'rawTimestamp':  '',
  'customsStatus': '',
  'address':      '',
  'phone':        '',
};

const DELIVERY_BODY_DEFAULT: DeliveryConfirmationEvent['body'] = {
  'scanSeq':               0,
  'latitude':              0,
  'longitude':             0,
  'ipAddress':             '',
  'localeTag':             '',
  'countryCode':           '',
  'legFromLat':            0,
  'legFromLng':            0,
  'originLat':             0,
  'originLng':             0,
  'destLat':               0,
  'destLng':               0,
  'carrier':               '',
  'status':                '',
  'rawTimestamp':          '',
  'delivered':             false,
  'rawPromisedDeliveryAt': '',
  'disruptionReason':      '',
  'recipientName':         '',
  'recipientEmail':        '',
  'recipientPhone':        '',
  'recipientAddress':      '',
  'recipientCountry':      '',
  'marketingConsent':      false,
  'lawfulBasis':           'contract',
  'specialCategory':       'none',
  'address':               '',
  'phone':                 '',
};

interface FromSourcePayloadContext {
  readonly envelope: {
    readonly shipmentId: string;
    readonly eventId: string;
    readonly epochMs: number;
    readonly sourceId: string;
    readonly sourceFormat: PositionPingEvent['sourceFormat'];
    readonly sourceCompression: PositionPingEvent['sourceCompression'];
  };
  readonly decoded: Record<string, unknown>;
  readonly sharedGeo: {
    readonly scanSeq: number;
    readonly latitude: number;
    readonly longitude: number;
    readonly ipAddress: string;
    readonly localeTag: string;
    readonly countryCode: string;
    readonly legFromLat: number;
    readonly legFromLng: number;
    readonly originLat: number;
    readonly originLng: number;
    readonly destLat: number;
    readonly destLng: number;
    readonly carrier: string;
    readonly status: string;
    readonly rawTimestamp: string;
    readonly address: string;
    readonly phone: string;
  };
  readonly preResolvedGeo: { readonly country: string; readonly continent: string; readonly region: string } | undefined;
}

export class CanonicalEventVariantBuilder {
  private static readonly fromSourcePayloadDispatch: Readonly<Record<string, (ctx: FromSourcePayloadContext) => CanonicalEventVariant>> = {
    'position-ping': ({ envelope, sharedGeo, preResolvedGeo }) => {
      const body: PositionPingEvent['body'] = {
        'scanSeq':      sharedGeo.scanSeq,
        'latitude':     sharedGeo.latitude,
        'longitude':    sharedGeo.longitude,
        'ipAddress':    sharedGeo.ipAddress,
        'localeTag':    sharedGeo.localeTag,
        'countryCode':  sharedGeo.countryCode,
        'legFromLat':   sharedGeo.legFromLat,
        'legFromLng':   sharedGeo.legFromLng,
        'originLat':    sharedGeo.originLat,
        'originLng':    sharedGeo.originLng,
        'destLat':      sharedGeo.destLat,
        'destLng':      sharedGeo.destLng,
        'carrier':      sharedGeo.carrier,
        'status':       sharedGeo.status,
        'rawTimestamp': sharedGeo.rawTimestamp.length > 0 ? sharedGeo.rawTimestamp : POSITION_PING_BODY_DEFAULT.rawTimestamp,
        'address':      sharedGeo.address,
        'phone':        sharedGeo.phone,
      };
      return { ...envelope, 'eventType': 'position-ping', 'body': body, ...(preResolvedGeo !== undefined && { 'geo': preResolvedGeo }) };
    },
    'facility-scan': ({ envelope, decoded, sharedGeo, preResolvedGeo }) => {
      const body: FacilityScanEvent['body'] = {
        'scanSeq':               sharedGeo.scanSeq,
        'latitude':              sharedGeo.latitude,
        'longitude':             sharedGeo.longitude,
        'ipAddress':             sharedGeo.ipAddress,
        'localeTag':             sharedGeo.localeTag,
        'countryCode':           sharedGeo.countryCode,
        'legFromLat':            sharedGeo.legFromLat,
        'legFromLng':            sharedGeo.legFromLng,
        'originLat':             sharedGeo.originLat,
        'originLng':             sharedGeo.originLng,
        'destLat':               sharedGeo.destLat,
        'destLng':               sharedGeo.destLng,
        'carrier':               sharedGeo.carrier,
        'status':                sharedGeo.status,
        'rawTimestamp':          sharedGeo.rawTimestamp.length > 0 ? sharedGeo.rawTimestamp : FACILITY_SCAN_BODY_DEFAULT.rawTimestamp,
        'facilityId':            CanonicalEventVariantBuilder.str(decoded['facilityId']),
        'weight':                CanonicalEventVariantBuilder.num(decoded['weight']),
        'weightUnit':            CanonicalEventVariantBuilder.weightUnit(decoded['weightUnit']),
        'lineItems':             CanonicalEventVariantBuilder.lineItems(decoded['lineItems']),
        'rawDispatchAt':         CanonicalEventVariantBuilder.str(decoded['dispatchRaw']),
        'rawPromisedDeliveryAt': CanonicalEventVariantBuilder.str(decoded['promisedRaw']),
        'disruptionReason':      CanonicalEventVariantBuilder.str(decoded['disruptionReason']),
        'recipientName':         CanonicalEventVariantBuilder.str(decoded['recipientName']),
        'recipientEmail':        CanonicalEventVariantBuilder.str(decoded['recipientEmail']),
        'recipientPhone':        CanonicalEventVariantBuilder.str(decoded['recipientPhone']),
        'recipientAddress':      CanonicalEventVariantBuilder.str(decoded['recipientAddress']),
        'recipientCountry':      CanonicalEventVariantBuilder.str(decoded['recipientCountry']),
        'marketingConsent':      CanonicalEventVariantBuilder.bool(decoded['marketingConsent']),
        'lawfulBasis':           CanonicalEventVariantBuilder.lawfulBasis(decoded['lawfulBasis']),
        'specialCategory':       CanonicalEventVariantBuilder.specialCategory(decoded['specialCategory']),
        'address':               sharedGeo.address,
        'phone':                 sharedGeo.phone,
      };
      return { ...envelope, 'eventType': 'facility-scan', 'body': body, ...(preResolvedGeo !== undefined && { 'geo': preResolvedGeo }) };
    },
    'sensor-reading': ({ envelope, decoded, sharedGeo, preResolvedGeo }) => {
      const body: SensorReadingEvent['body'] = {
        'scanSeq':      sharedGeo.scanSeq,
        'latitude':     sharedGeo.latitude,
        'longitude':    sharedGeo.longitude,
        'ipAddress':    sharedGeo.ipAddress,
        'localeTag':    sharedGeo.localeTag,
        'countryCode':  sharedGeo.countryCode,
        'legFromLat':   sharedGeo.legFromLat,
        'legFromLng':   sharedGeo.legFromLng,
        'originLat':    sharedGeo.originLat,
        'originLng':    sharedGeo.originLng,
        'destLat':      sharedGeo.destLat,
        'destLng':      sharedGeo.destLng,
        'carrier':      sharedGeo.carrier,
        'status':       sharedGeo.status,
        'rawTimestamp': sharedGeo.rawTimestamp.length > 0 ? sharedGeo.rawTimestamp : SENSOR_READING_BODY_DEFAULT.rawTimestamp,
        'tempC':        CanonicalEventVariantBuilder.num(decoded['tempC']),
        'humidityPct':  CanonicalEventVariantBuilder.num(decoded['humidityPct']),
        'shockG':       CanonicalEventVariantBuilder.num(decoded['shockG']),
        'address':      sharedGeo.address,
        'phone':        sharedGeo.phone,
      };
      return { ...envelope, 'eventType': 'sensor-reading', 'body': body, ...(preResolvedGeo !== undefined && { 'geo': preResolvedGeo }) };
    },
    'customs-event': ({ envelope, decoded, sharedGeo, preResolvedGeo }) => {
      const body: CustomsEvent['body'] = {
        'scanSeq':       sharedGeo.scanSeq,
        'latitude':      sharedGeo.latitude,
        'longitude':     sharedGeo.longitude,
        'ipAddress':     sharedGeo.ipAddress,
        'localeTag':     sharedGeo.localeTag,
        'countryCode':   sharedGeo.countryCode,
        'legFromLat':    sharedGeo.legFromLat,
        'legFromLng':    sharedGeo.legFromLng,
        'originLat':     sharedGeo.originLat,
        'originLng':     sharedGeo.originLng,
        'destLat':       sharedGeo.destLat,
        'destLng':       sharedGeo.destLng,
        'carrier':       sharedGeo.carrier,
        'status':        sharedGeo.status,
        'rawTimestamp':  sharedGeo.rawTimestamp.length > 0 ? sharedGeo.rawTimestamp : CUSTOMS_EVENT_BODY_DEFAULT.rawTimestamp,
        'customsStatus': CanonicalEventVariantBuilder.str(decoded['customsStatus']),
        'address':       sharedGeo.address,
        'phone':         sharedGeo.phone,
      };
      return { ...envelope, 'eventType': 'customs-event', 'body': body, ...(preResolvedGeo !== undefined && { 'geo': preResolvedGeo }) };
    },
    'delivery-confirmation': ({ envelope, decoded, sharedGeo, preResolvedGeo }) => {
      const body: DeliveryConfirmationEvent['body'] = {
        'scanSeq':               sharedGeo.scanSeq,
        'latitude':              sharedGeo.latitude,
        'longitude':             sharedGeo.longitude,
        'ipAddress':             sharedGeo.ipAddress,
        'localeTag':             sharedGeo.localeTag,
        'countryCode':           sharedGeo.countryCode,
        'legFromLat':            sharedGeo.legFromLat,
        'legFromLng':            sharedGeo.legFromLng,
        'originLat':             sharedGeo.originLat,
        'originLng':             sharedGeo.originLng,
        'destLat':               sharedGeo.destLat,
        'destLng':               sharedGeo.destLng,
        'carrier':               sharedGeo.carrier,
        'status':                sharedGeo.status,
        'rawTimestamp':          sharedGeo.rawTimestamp.length > 0 ? sharedGeo.rawTimestamp : DELIVERY_BODY_DEFAULT.rawTimestamp,
        'delivered':             CanonicalEventVariantBuilder.bool(decoded['delivered']),
        'rawPromisedDeliveryAt': CanonicalEventVariantBuilder.str(decoded['promisedRaw']),
        'disruptionReason':      CanonicalEventVariantBuilder.str(decoded['disruptionReason']),
        'recipientName':         CanonicalEventVariantBuilder.str(decoded['recipientName']),
        'recipientEmail':        CanonicalEventVariantBuilder.str(decoded['recipientEmail']),
        'recipientPhone':        CanonicalEventVariantBuilder.str(decoded['recipientPhone']),
        'recipientAddress':      CanonicalEventVariantBuilder.str(decoded['recipientAddress']),
        'recipientCountry':      CanonicalEventVariantBuilder.str(decoded['recipientCountry']),
        'marketingConsent':      CanonicalEventVariantBuilder.bool(decoded['marketingConsent']),
        'lawfulBasis':           CanonicalEventVariantBuilder.lawfulBasis(decoded['lawfulBasis']),
        'specialCategory':       CanonicalEventVariantBuilder.specialCategory(decoded['specialCategory']),
        'address':               sharedGeo.address,
        'phone':                 sharedGeo.phone,
      };
      return { ...envelope, 'eventType': 'delivery-confirmation', 'body': body, ...(preResolvedGeo !== undefined && { 'geo': preResolvedGeo }) };
    },
  };
  /**
   * Type-guard for CanonicalEventVariant. Narrows `unknown` to the discriminated
   * union by verifying the object shape and eventType discriminant.
  */
  static is(value: unknown): value is CanonicalEventVariant {
    return canonicalEventVariantValidator.is(value);
  }

  static from(partial: Partial<PositionPingEvent> = {}): CanonicalEventVariant {
    return {
      ...POSITION_PING_DEFAULT,
      ...partial,
      'eventType': 'position-ping',
      'body': { ...POSITION_PING_DEFAULT.body, ...partial.body },
    };
  }

  // Private coercion helpers — mirror coerce-types node semantics without
  // importing the node. Defined locally so defaults live in one place.

  private static str(v: unknown): string {
    return typeof v === 'string' ? v : '';
  }

  private static num(v: unknown): number {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string') { const n = Number(v); return isFinite(n) ? n : 0; }
    return 0;
  }

  private static bool(v: unknown): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v === 'true' || v === '1';
    return false;
  }

  private static lawfulBasis(v: unknown): DeliveryConfirmationEvent['body']['lawfulBasis'] {
    return v === 'contract' || v === 'consent' || v === 'legitimate-interest' || v === 'none'
      ? v : 'contract';
  }

  private static specialCategory(v: unknown): DeliveryConfirmationEvent['body']['specialCategory'] {
    return v === 'health' ? 'health' : 'none';
  }

  private static weightUnit(v: unknown): FacilityScanEvent['body']['weightUnit'] {
    return v === 'lb' || v === 'kg' || v === 'g' || v === 'oz' ? v : 'kg';
  }

  private static lineItems(v: unknown): Array<{ 'productId': string; 'quantity': number }> {
    if (!Array.isArray(v)) return [];
    const out: Array<{ 'productId': string; 'quantity': number }> = [];
    for (const li of v) {
      if (li !== null && typeof li === 'object' && !Array.isArray(li)) {
        const o: Record<string, unknown> = { ...li };
        out.push({
          'productId': CanonicalEventVariantBuilder.str(o['productId']),
          'quantity':  CanonicalEventVariantBuilder.num(o['quantity']) || 1,
        });
      }
    }
    return out;
  }

  /**
   * Build a CanonicalEventVariant from a SourcePayload and its decoded canonical
   * record. Switches on payload.eventType (the authoritative type) and constructs
   * ONLY the variant member for that type, populating each owned body field from
   * the decoded record with a default for any genuinely absent field.
   *
   * Envelope fields (shipmentId, eventId, epochMs) come from the decoded record.
   * Provenance (sourceId, sourceFormat, sourceCompression) comes from the payload.
   * The rawTimestamp body field is decoded.epochRaw (the raw timestamp string).
   */
  static fromSourcePayload(
    payload: SourcePayload,
    decoded: Record<string, unknown>,
  ): CanonicalEventVariant {
    const shipmentId = CanonicalEventVariantBuilder.str(decoded['shipmentId']);
    const eventId    = CanonicalEventVariantBuilder.str(decoded['eventId']);
    const epochMs    = CanonicalEventVariantBuilder.num(decoded['epochMs']);

    const envelope = {
      'shipmentId':        shipmentId.length > 0 ? shipmentId : 'unknown',
      'eventId':           eventId.length > 0 ? eventId : 'unknown',
      'epochMs':           epochMs,
      'sourceId':          payload.sourceId,
      'sourceFormat':      payload.format,
      'sourceCompression': payload.compression,
    } as const;

    // Shared geometry fields present on every variant.
    const scanSeq    = CanonicalEventVariantBuilder.num(decoded['scanSeq']);
    const latitude   = CanonicalEventVariantBuilder.num(decoded['latitude']);
    const longitude  = CanonicalEventVariantBuilder.num(decoded['longitude']);
    const ipAddress   = CanonicalEventVariantBuilder.str(decoded['ipAddress']);
    const localeTag   = CanonicalEventVariantBuilder.str(decoded['localeTag']);
    const countryCode = CanonicalEventVariantBuilder.str(decoded['countryCode']);
    const legFromLat  = CanonicalEventVariantBuilder.num(decoded['legFromLat']);
    const legFromLng = CanonicalEventVariantBuilder.num(decoded['legFromLng']);
    const originLat  = CanonicalEventVariantBuilder.num(decoded['originLat']);
    const originLng  = CanonicalEventVariantBuilder.num(decoded['originLng']);
    const destLat    = CanonicalEventVariantBuilder.num(decoded['destLat']);
    const destLng    = CanonicalEventVariantBuilder.num(decoded['destLng']);
    const carrier    = CanonicalEventVariantBuilder.str(decoded['carrier']);
    const status     = CanonicalEventVariantBuilder.str(decoded['status']);
    const rawTimestamp = CanonicalEventVariantBuilder.str(decoded['epochRaw']);
    const address    = CanonicalEventVariantBuilder.str(decoded['address']);
    const phone      = CanonicalEventVariantBuilder.str(decoded['phone']);

    // Pre-resolved geo from RICH sources (JSON/YAML API with offline country-coder).
    // Present when the encoder set geoCountry / geoContinent / geoRegion on the record.
    // All three must be non-empty for the geo block to be valid; absent otherwise.
    const geoCountry   = CanonicalEventVariantBuilder.str(decoded['geoCountry']);
    const geoContinent = CanonicalEventVariantBuilder.str(decoded['geoContinent']);
    const geoRegion    = CanonicalEventVariantBuilder.str(decoded['geoRegion']);
    const preResolvedGeo = geoCountry.length > 0 && geoContinent.length > 0 && geoRegion.length > 0
      ? { 'country': geoCountry, 'continent': geoContinent, 'region': geoRegion }
      : undefined;

    return CanonicalEventVariantBuilder.resolveFromSourcePayloadHandler(payload.eventType)({
      envelope,
      decoded,
      sharedGeo: {
        scanSeq, latitude, longitude, ipAddress, localeTag, countryCode,
        legFromLat, legFromLng, originLat, originLng,
        destLat, destLng, carrier, status, rawTimestamp, address, phone,
      },
      preResolvedGeo,
    });
  }

  private static resolveFromSourcePayloadHandler(eventType: string): (ctx: FromSourcePayloadContext) => CanonicalEventVariant {
    const positionPingHandler = CanonicalEventVariantBuilder.fromSourcePayloadDispatch['position-ping'];
    const fallback = (ctx: FromSourcePayloadContext): CanonicalEventVariant => {
      const body: PositionPingEvent['body'] = {
        'scanSeq':      ctx.sharedGeo.scanSeq,
        'latitude':     ctx.sharedGeo.latitude,
        'longitude':    ctx.sharedGeo.longitude,
        'ipAddress':    ctx.sharedGeo.ipAddress,
        'localeTag':    ctx.sharedGeo.localeTag,
        'countryCode':  ctx.sharedGeo.countryCode,
        'legFromLat':   ctx.sharedGeo.legFromLat,
        'legFromLng':   ctx.sharedGeo.legFromLng,
        'originLat':    ctx.sharedGeo.originLat,
        'originLng':    ctx.sharedGeo.originLng,
        'destLat':      ctx.sharedGeo.destLat,
        'destLng':      ctx.sharedGeo.destLng,
        'carrier':      ctx.sharedGeo.carrier,
        'status':       ctx.sharedGeo.status,
        'rawTimestamp': ctx.sharedGeo.rawTimestamp.length > 0 ? ctx.sharedGeo.rawTimestamp : POSITION_PING_BODY_DEFAULT.rawTimestamp,
        'address':      ctx.sharedGeo.address,
        'phone':        ctx.sharedGeo.phone,
      };
      return { ...ctx.envelope, 'eventType': 'position-ping', 'body': body, ...(ctx.preResolvedGeo !== undefined && { 'geo': ctx.preResolvedGeo }) };
    };
    return CanonicalEventVariantBuilder.fromSourcePayloadDispatch[eventType] ?? positionPingHandler ?? fallback;
  }
}
// #endregion canonical-event-variant-entity
