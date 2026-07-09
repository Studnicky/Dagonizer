/**
 * Cartographer services: static domain classes following the noun.verb() pattern.
 *
 * GeoLookup        — lat/lng → grid zone → GeoContext (country/region/hub/tz/jurisdiction)
 * TimeZoneResolver — coords → IANA zone (tz-lookup); UTC epoch → local ISO + offset
 * Jurisdictions    — country code/name → privacy regime + strictness + retention
 * GdprRedactor     — location + consent driven PII redaction; coords-as-PII coarsening
 * GeoCoarsener     — precise lat/lng → grid-zone centroid (location-PII coarsening)
 * ShipmentEvents   — deterministic synthetic journey/scan generator (seeded LCG)
 * TimeNormalizer   — multi-format timestamp → epoch ms + ISO-8601
 * CarrierRegistry  — carrier label → canonical carrierId/carrierName
 * CountryCodes     — alpha-2/alpha-3/name → normalized country codes
 * Units            — weight unit conversion to grams
 * EventClassifier  — free-text status → eventType; carrier/weight → service/size tiers
 * FxRates          — currency minor units → USD cents (FX normalisation)
 * PricingCatalog   — productId lookup + basket pricing with FX normalisation
 * ShippingCalculator — haversine distance + carrier rate → ShippingQuote
 * EtaEstimator     — shared transit fn + SLA promise vs disrupted ETA → DeliveryEstimate
 *
 * Determinism: ShipmentEvents uses a seeded LCG (no Date.now/Math.random).
 * tz-lookup and Intl.DateTimeFormat are pure functions of their inputs.
 */

import tzLookupDefault from 'tz-lookup';
import { CoordTimezoneResolver, CountryLocale, Geo, JurisdictionResolver, OfflineGeoResolver } from '@studnicky/geo-resolver';

import CATALOG_RAW from './data/product-catalog.json' with { type: 'json' };
import CARRIER_RATES_RAW from './data/carrier-rates.json' with { type: 'json' };
import FX_RATES_RAW from './data/fx-rates.json' with { type: 'json' };

import type { DeliveryEstimate } from './entities/DeliveryEstimate.ts';
import type { GdprResult } from './entities/GdprResult.ts';
import type { GeoContext } from './entities/GeoContext.ts';
import type { NormalizedShipment } from './entities/NormalizedShipment.ts';
import type { PricedOrder } from './entities/PricedOrder.ts';
import type { RawShipmentEvent } from './entities/RawShipmentEvent.ts';
import type { ShipmentEvent } from './entities/ShipmentEvent.ts';
import type { ShippingQuote } from './entities/ShippingQuote.ts';
import type { SourcePayload } from './entities/SourcePayload.ts';
import type { CanonicalEventVariant } from './entities/index.ts';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';

export type FormatMix = ReadonlyArray<{
  readonly format: 'csv' | 'json' | 'ndjson' | 'yaml';
  readonly compression: 'none' | 'gzip';
  readonly weight: number;
}>;

export type EventTypeConfig = ReadonlyArray<{
  readonly eventType: CanonicalEventVariant['eventType'];
  readonly count: number;
  readonly formatMix: FormatMix;
}>;

export type TypedScan =
  | (RawShipmentEvent & { readonly eventType: 'position-ping' })
  | (RawShipmentEvent & { readonly eventType: 'facility-scan' })
  | (RawShipmentEvent & { readonly eventType: 'sensor-reading'; readonly tempC: number; readonly humidityPct: number; readonly shockG: number })
  | (RawShipmentEvent & { readonly eventType: 'customs-event'; readonly customsStatus: 'held' | 'cleared' | 'inspection' })
  | (RawShipmentEvent & { readonly eventType: 'delivery-confirmation'; readonly delivered: true; readonly podSignature: string; readonly deliveredAt: string });

// ── tz-lookup: CJS package; import-default works under tsx (Node CJS interop)
// and under Vite (with optimizeDeps.include — see docs/.vitepress/config.ts).
const tzLookup = tzLookupDefault;

// ── Data tables (static JSON imports — ESM + Vite compatible; no createRequire)

interface CatalogEntry {
  readonly 'productId': string;
  readonly 'name': string;
  readonly 'category': string;
  readonly 'unitPriceMinor': number;
  readonly 'currency': string;
}

interface CarrierRate {
  readonly 'baseMinorUsd': number;
  readonly 'perKmMinorUsd': number;
  readonly 'perKgMinorUsd': number;
  readonly 'tierMultipliers': { readonly 'express': number; readonly 'standard': number; readonly 'economy': number };
  readonly 'speedKmPerHour': number;
  readonly 'handlingHours': number;
}

export interface JurisdictionEntry {
  readonly 'jurisdiction': GeoContext['jurisdiction'];
  readonly 'strictness': GdprResult['strictness'];
  readonly 'baseRetentionDays': number;
}

const CATALOG: ReadonlyArray<CatalogEntry> = CATALOG_RAW satisfies ReadonlyArray<CatalogEntry>;
const CARRIER_RATES: Record<string, CarrierRate> = CARRIER_RATES_RAW satisfies Record<string, CarrierRate>;
const FX_TABLE: Record<string, number> = FX_RATES_RAW satisfies Record<string, number>;

// #region timezone-resolver-service
/**
 * TimeZoneResolver: location → IANA timezone, and UTC epoch → local time.
 *
 * `zoneFor` uses tz-lookup (offline coords→IANA). `localParts` formats a UTC
 * epoch in a target zone via Intl.DateTimeFormat (Node ICU) — a pure function
 * of (epoch, zone), so determinism holds on a fixed epoch.
 */
export class TimeZoneResolver {
  static zoneFor(lat: number, lng: number): string {
    try {
      return tzLookup(lat, lng);
    } catch {
      // tz-lookup throws for out-of-range coords; use UTC.
      return 'UTC';
    }
  }

  /** Local ISO (YYYY-MM-DDTHH:mm:ss) + UTC offset label (e.g. 'GMT+9') at zone. */
  static localParts(epochMs: number, timeZone: string): { 'localIso': string; 'utcOffset': string } {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      'timeZone':     timeZone,
      'year':         'numeric',
      'month':        '2-digit',
      'day':          '2-digit',
      'hour':         '2-digit',
      'minute':       '2-digit',
      'second':       '2-digit',
      'hour12':       false,
      'timeZoneName': 'shortOffset',
    });
    const parts = fmt.formatToParts(new Date(epochMs));
    const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
    let hour = get('hour');
    if (hour === '24') hour = '00'; // en-CA can emit 24 for midnight
    const localIso = `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}`;
    const utcOffset = get('timeZoneName') || 'GMT';
    return { 'localIso': localIso, 'utcOffset': utcOffset };
  }
}
// #endregion timezone-resolver-service

// #region jurisdictions-service
/**
 * Jurisdictions: country → privacy regime + redaction strictness + base
 * retention days. EU/EEA→GDPR, GB→UK-GDPR, US→CCPA, BR→LGPD, JP→APPI, else
 * baseline. This is COMPLIANCE data (which privacy law governs a country), not a
 * geo-resolution table — the geo APIs resolve WHERE a ping is; this maps that
 * country to its privacy regime. The geo APIs return ISO-2 codes, so the lookup
 * accepts ISO-2 (a tiny code conversion, not a curated location lookup).
 */
const ISO2_TO_ISO3: Record<string, string> = {
  'US': 'USA', 'CA': 'CAN', 'MX': 'MEX', 'GB': 'GBR', 'DE': 'DEU', 'FR': 'FRA',
  'NL': 'NLD', 'IT': 'ITA', 'ES': 'ESP', 'PL': 'POL', 'SE': 'SWE', 'NO': 'NOR',
  'DK': 'DNK', 'FI': 'FIN', 'BE': 'BEL', 'AT': 'AUT', 'CZ': 'CZE', 'HU': 'HUN',
  'PT': 'PRT', 'RO': 'ROU', 'BG': 'BGR', 'GR': 'GRC', 'CH': 'CHE', 'IE': 'IRL',
  'HR': 'HRV', 'SK': 'SVK', 'SI': 'SVN', 'LT': 'LTU', 'LV': 'LVA', 'EE': 'EST',
  'LU': 'LUX', 'CY': 'CYP', 'MT': 'MLT', 'IS': 'ISL', 'LI': 'LIE',
  'RU': 'RUS', 'UA': 'UKR', 'TR': 'TUR', 'CN': 'CHN', 'JP': 'JPN', 'KR': 'KOR',
  'IN': 'IND', 'AU': 'AUS', 'NZ': 'NZL', 'SG': 'SGP', 'TH': 'THA', 'VN': 'VNM',
  'MY': 'MYS', 'ID': 'IDN', 'PH': 'PHL', 'BD': 'BGD', 'PK': 'PAK', 'LK': 'LKA',
  'BR': 'BRA', 'AR': 'ARG', 'CO': 'COL', 'CL': 'CHL', 'PE': 'PER', 'VE': 'VEN',
  'EC': 'ECU', 'BO': 'BOL', 'PY': 'PRY', 'UY': 'URY', 'GY': 'GUY', 'SR': 'SUR',
  'ZA': 'ZAF', 'NG': 'NGA', 'EG': 'EGY', 'SA': 'SAU', 'AE': 'ARE', 'KE': 'KEN',
  'MA': 'MAR', 'DZ': 'DZA', 'TN': 'TUN', 'ET': 'ETH', 'GH': 'GHA', 'TZ': 'TZA',
  'KZ': 'KAZ', 'UZ': 'UZB', 'IR': 'IRN', 'IQ': 'IRQ', 'IL': 'ISR', 'JO': 'JOR',
};

const ISO3_TO_ISO2: Record<string, string> = Object.fromEntries(
  Object.entries(ISO2_TO_ISO3).map(([iso2, iso3]) => [iso3, iso2]),
);

export class Jurisdictions {
  /** Resolve the privacy regime from an ISO-3166-1 alpha-3 country code. */
  static forCountry(countryIso3: string): JurisdictionEntry {
    const iso2 = ISO3_TO_ISO2[countryIso3] ?? '';
    return JurisdictionResolver.forIso2(iso2);
  }

  /** Resolve the privacy regime from a country code or display name. */
  static forIso2(countryIso2: string): JurisdictionEntry {
    const iso2 = CountryCodes.toIso2(countryIso2);
    return JurisdictionResolver.forIso2(iso2);
  }
}
// #endregion jurisdictions-service

// #region continents-service
/**
 * Continents: country code/name → continent name, backed by
 * @studnicky/geo-resolver's global ISO-3166-1 continent table. Unknown
 * codes return 'Unmapped'.
 */
export class Continents {
  /** Resolve a continent name from a country code or display name. Unknown codes → 'Unmapped'. */
  static forIso2(countryIso2: string): string {
    const iso2 = CountryCodes.toIso2(countryIso2);
    return iso2.length > 0 ? Geo.continentForCountry(iso2) : 'Unmapped';
  }
}
// #endregion continents-service

// #region geo-coarsener-service
/**
 * GeoCoarsener: coarsen precise scan coords to a grid-zone centroid.
 *
 * Location is PII; when the jurisdiction is strict OR consent is not valid, the
 * stored coords are snapped to the centre of their ~1° grid cell so the exact
 * scan point is not retained. Deterministic (pure floor/round arithmetic).
 */
export class GeoCoarsener {
  static toCentroid(lat: number, lng: number): { 'lat': number; 'lng': number } {
    // Snap to the centre of a 1°×1° cell.
    const cLat = Math.floor(lat) + 0.5;
    const cLng = Math.floor(lng) + 0.5;
    return { 'lat': Math.round(cLat * 100) / 100, 'lng': Math.round(cLng * 100) / 100 };
  }
}
// #endregion geo-coarsener-service

// #region geo-lookup-service
/**
 * GeoLookup: the skip-geo adapter — materialise a GeoContext from a source's
 * PRE-RESOLVED geo (country/region), the only remaining use after curated tables
 * were removed. The full resolution is performed by the geo-resolve sub-DAG
 * (offline country-coder for GPS + freeipapi.com for IP); this builds the context
 * when a RICH source already carried the resolved location, so the sub-DAG is skipped.
 *
 * The pre-resolved `country` is an ISO-2 code (the country-coder format). tz comes
 * from the coords; jurisdiction (a privacy-regime mapping, not a geo table) from the
 * country. No grid lookup, no curated region/hub maps.
 */
export class GeoLookup {
  static fromResolved(country: string, continent: string, region: string, lat: number, lng: number): GeoContext {
    const timezone = TimeZoneResolver.zoneFor(lat, lng);
    const iso2 = CountryCodes.toIso2(country);
    // A pre-resolved MARITIME marker → maritime context (high-seas, no regime).
    if (country === 'INTL' || country.length === 0) {
      return {
        'gridZone':     'API',
        'country':      'INTL',
        'continent':    'International Waters / Maritime',
        'countries':    [],
        'region':       region || 'In Transit / Maritime',
        'hub':          region || 'International Waters',
        'status':       'water',
        'waterBodies':  [region || 'International Waters'],
        'timezone':     timezone,
        'jurisdiction': 'international-waters',
      };
    }
    if (iso2.length === 0) {
      return {
        'gridZone':     'API',
        'country':      'UNK',
        'continent':    'Unmapped',
        'countries':    [],
        'region':       region || 'Unmapped',
        'hub':          region || country,
        'status':       'unmapped',
        'waterBodies':  [],
        'timezone':     timezone,
        'jurisdiction': 'baseline',
      };
    }
    const jurisdiction = Jurisdictions.forIso2(iso2).jurisdiction;
    return {
      'gridZone':     'API',
      'country':      iso2,
      'continent':    continent || Continents.forIso2(iso2),
      'countries':    [iso2],
      'region':       region,
      'hub':          region || iso2,
      'status':       'land',
      'waterBodies':  [],
      'timezone':     timezone,
      'jurisdiction': jurisdiction,
    };
  }
}
// #endregion geo-lookup-service

// #region gdpr-redactor-service
/**
 * GdprRedactor: location- and consent-driven PII redaction.
 *
 * Redaction strictness is `max(jurisdiction baseline, consent-implied)`:
 *   - strict (GDPR / UK-GDPR / LGPD, or consent not valid): irreversible
 *     redaction (Anon_/hash_), coords coarsened to a grid-zone centroid,
 *     short retention.
 *   - moderate (CCPA / APPI with valid consent): reversible pseudonym, coords
 *     coarsened only when consent is not valid, medium retention.
 *   - light (baseline with valid consent): reversible pseudonym, precise coords
 *     retained, longer retention.
 *
 * coords-as-PII: precise scan lat/lng are coarsened to a 1° grid centroid when
 * the jurisdiction is strict OR consent is missing/expired — only valid-consent
 * + light-jurisdiction keeps precise coords.
 *
 * Processing a delivery is always lawful under the contract basis, so a shipment
 * is never dropped for lack of marketing consent. The only drop is the rare
 * special-category-without-lawful-basis violation.
 */
export class GdprRedactor {
  static classify(_event: ShipmentEvent): Pick<GdprResult, 'personalDataFields' | 'sensitiveDataFields'> {
    return {
      'personalDataFields':  ['recipientName', 'recipientEmail', 'recipientPhone', 'recipientAddress', 'scanCoords'],
      'sensitiveDataFields': ['recipientCountry'],
    };
  }

  /**
   * A record is unlawful to process only when it carries special-category
   * (Article 9) data with no lawful basis. Everything else is processable
   * under the contract basis.
   */
  static hasLawfulBasis(lawfulBasis: GdprResult['lawfulBasis'], specialCategory: string): boolean {
    if (specialCategory !== 'none') {
      return lawfulBasis !== 'none';
    }
    return true;
  }

  /**
   * Effective strictness = max(jurisdiction baseline, consent-implied).
   * A strict jurisdiction is strict regardless of consent; a non-strict
   * jurisdiction is escalated to strict when consent is missing/expired.
   */
  static strictnessFor(
    jurisdictionStrictness: GdprResult['strictness'],
    consentStatus: GdprResult['consentStatus'],
  ): GdprResult['strictness'] {
    if (jurisdictionStrictness === 'strict') return 'strict';
    if (consentStatus !== 'valid') return 'strict';
    return jurisdictionStrictness; // 'moderate' or 'light' with valid consent
  }

  /** Whether the scan's precise coords must be coarsened (location-as-PII). */
  static mustCoarsenCoords(
    jurisdictionStrictness: GdprResult['strictness'],
    consentStatus: GdprResult['consentStatus'],
  ): boolean {
    return jurisdictionStrictness === 'strict' || consentStatus !== 'valid';
  }

  static async redact(
    event: ShipmentEvent,
    consentStatus: GdprResult['consentStatus'],
    lawfulBasis: GdprResult['lawfulBasis'],
    jurisdiction: GeoContext['jurisdiction'],
    jurisdictionStrictness: GdprResult['strictness'],
    baseRetentionDays: number,
  ): Promise<{ redacted: Partial<ShipmentEvent>; result: GdprResult }> {
    const now = new Date('2026-06-04T00:00:00Z');
    const strictness = GdprRedactor.strictnessFor(jurisdictionStrictness, consentStatus);
    const irreversible = strictness === 'strict';
    const hasValidConsent = consentStatus === 'valid';

    // Retention: jurisdiction base × consent. Valid consent extends; missing/
    // expired shortens to a 30-day floor.
    const retentionDays = hasValidConsent ? baseRetentionDays : Math.min(30, baseRetentionDays);
    const retainUntil = new Date(now.getTime() + retentionDays * 86_400_000).toISOString().slice(0, 10);

    const emailHashBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(event.recipientEmail));
    const emailHash = Array.from(new Uint8Array(emailHashBytes)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    const redactedEmail = irreversible
      ? `hash_${emailHash}@redacted.invalid`
      : `pseudo_${emailHash}@redacted.invalid`;

    const nameHashBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(event.recipientName));
    const nameHash = Array.from(new Uint8Array(nameHashBytes)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
    const redactedName = irreversible ? `Anon_${nameHash}` : `Pseudo_${nameHash}`;

    const addressParts = event.recipientAddress.split(',');
    const redactedAddress = addressParts[addressParts.length - 1]?.trim() ?? 'REDACTED';

    const redacted: Partial<ShipmentEvent> = {
      'recipientName':    redactedName,
      'recipientEmail':   redactedEmail,
      'recipientPhone':   '(XXX) XXX-XXXX',
      'recipientAddress': redactedAddress,
    };

    const coordsCoarsened = GdprRedactor.mustCoarsenCoords(jurisdictionStrictness, consentStatus);

    // complianceScore is a reported metric, not a gate.
    const complianceScore = consentStatus === 'valid' ? 95 : consentStatus === 'expired' ? 70 : 55;

    const result: GdprResult = {
      'personalDataFields':  ['recipientName', 'recipientEmail', 'recipientPhone', 'recipientAddress', 'scanCoords'],
      'sensitiveDataFields': ['recipientCountry'],
      'consentStatus':    consentStatus,
      'lawfulBasis':      lawfulBasis,
      'jurisdiction':     jurisdiction,
      'strictness':       strictness,
      'complianceScore':  complianceScore,
      'retention': {
        'retainUntil': retainUntil,
        'autoDelete':  !hasValidConsent,
      },
      'redactionApplied': true,
      'marketingAnalyticsEligible': hasValidConsent,
      'coordsCoarsened':  coordsCoarsened,
    };

    return { redacted, result };
  }
}
// #endregion gdpr-redactor-service

// #region time-normalizer-service
/**
 * TimeNormalizer: handles 5 messy timestamp formats → epoch ms + ISO-8601.
 *
 * Supported formats:
 *   1. ISO-8601  (2026-01-15T08:30:00Z or with offset)
 *   2. MM/DD/YYYY HH:mm
 *   3. Unix epoch seconds as string ("1735990200")
 *   4. YYYY-MM-DD date-only
 *   5. RFC-2822-ish ("Wed, 04 Jun 2026 12:30:00 GMT")
 *
 * Returns NaN for unparseable input so the node can route to 'rejected'.
 */
export class TimeNormalizer {
  // Match MM/DD/YYYY HH:mm
  private static readonly RE_MDY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/;
  // Match date-only YYYY-MM-DD (no T, no colon after the year-month-day)
  private static readonly RE_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
  // Match unix epoch seconds string (9-10 digits, no hyphens/slashes)
  private static readonly RE_UNIX_S = /^\d{9,11}$/;

  static toEpochMs(raw: string): number {
    const trimmed = raw.trim();

    // 1. Unix epoch seconds as plain digits
    if (TimeNormalizer.RE_UNIX_S.test(trimmed)) {
      const seconds = parseInt(trimmed, 10);
      return seconds * 1000;
    }

    // 2. MM/DD/YYYY HH:mm
    const mdyMatch = TimeNormalizer.RE_MDY.exec(trimmed);
    if (mdyMatch !== null) {
      const [, mm, dd, yyyy, hh, min] = mdyMatch;
      const iso = `${yyyy}-${(mm ?? '00').padStart(2, '0')}-${(dd ?? '00').padStart(2, '0')}T${(hh ?? '00').padStart(2, '0')}:${(min ?? '00').padStart(2, '0')}:00Z`;
      const ms = new Date(iso).getTime();
      return ms;
    }

    // 3. Date-only YYYY-MM-DD
    if (TimeNormalizer.RE_DATE_ONLY.test(trimmed)) {
      const ms = new Date(`${trimmed}T00:00:00Z`).getTime();
      return ms;
    }

    // 4. ISO-8601 and RFC-2822-ish: let Date parse them
    const ms = new Date(trimmed).getTime();
    return ms;
  }

  static toIso(epochMs: number): string {
    return new Date(epochMs).toISOString();
  }
}
// #endregion time-normalizer-service

// #region carrier-registry-service
/**
 * CarrierRegistry: resolves carrier labels to canonical carrierId/carrierName pairs.
 */
const CARRIER_LABEL_MAP: Record<string, { 'carrierId': string; 'carrierName': string }> = {
  'FEDEX':            { 'carrierId': 'fedex',      'carrierName': 'FedEx' },
  'FEDEX GROUND':     { 'carrierId': 'fedex',      'carrierName': 'FedEx' },
  'FEDEX EXPRESS':    { 'carrierId': 'fedex',      'carrierName': 'FedEx' },
  'FEDERAL EXPRESS':  { 'carrierId': 'fedex',      'carrierName': 'FedEx' },
  'FEDEX CORP':       { 'carrierId': 'fedex',      'carrierName': 'FedEx' },
  'UPS':              { 'carrierId': 'ups',        'carrierName': 'UPS' },
  'UNITED PARCEL SERVICE': { 'carrierId': 'ups',   'carrierName': 'UPS' },
  'UPS GROUND':       { 'carrierId': 'ups',        'carrierName': 'UPS' },
  'DHL':              { 'carrierId': 'dhl',        'carrierName': 'DHL' },
  'DHL EXPRESS':      { 'carrierId': 'dhl',        'carrierName': 'DHL' },
  'DHL ECOMMERCE':    { 'carrierId': 'dhl',        'carrierName': 'DHL' },
  'USPS':             { 'carrierId': 'usps',       'carrierName': 'USPS' },
  'UNITED STATES POSTAL SERVICE': { 'carrierId': 'usps', 'carrierName': 'USPS' },
  'ROYAL MAIL':       { 'carrierId': 'royal-mail', 'carrierName': 'Royal Mail' },
  'ROYAL MAIL GROUP': { 'carrierId': 'royal-mail', 'carrierName': 'Royal Mail' },
  'DPD':              { 'carrierId': 'dpd',        'carrierName': 'DPD' },
  'DPD GROUP':        { 'carrierId': 'dpd',        'carrierName': 'DPD' },
  'DPD UK':           { 'carrierId': 'dpd',        'carrierName': 'DPD' },
};

export class CarrierRegistry {
  static canonical(raw: string): { 'carrierId': string; 'carrierName': string } {
    const key = raw.trim().toUpperCase();
    return CARRIER_LABEL_MAP[key] ?? { 'carrierId': 'unknown', 'carrierName': raw };
  }
}
// #endregion carrier-registry-service

// #region country-codes-service
/**
 * CountryCodes: resolves alpha-2, alpha-3, and full country names to normalized
 * ISO country codes for canonical shipment and geo-resolution paths.
 */
const COUNTRY_CODE_MAP: Record<string, string> = {
  // Alpha-2 → ISO-3
  'US': 'USA', 'CA': 'CAN', 'MX': 'MEX', 'GB': 'GBR', 'DE': 'DEU',
  'FR': 'FRA', 'NL': 'NLD', 'IT': 'ITA', 'ES': 'ESP', 'PL': 'POL',
  'SE': 'SWE', 'NO': 'NOR', 'DK': 'DNK', 'FI': 'FIN', 'BE': 'BEL',
  'CH': 'CHE', 'AT': 'AUT', 'CZ': 'CZE', 'HU': 'HUN', 'PT': 'PRT',
  'RO': 'ROU', 'BG': 'BGR', 'GR': 'GRC', 'CN': 'CHN', 'JP': 'JPN',
  'KR': 'KOR', 'AU': 'AUS', 'NZ': 'NZL', 'SG': 'SGP', 'IN': 'IND',
  'TH': 'THA', 'VN': 'VNM', 'MY': 'MYS', 'ID': 'IDN', 'PH': 'PHL',
  'BR': 'BRA', 'AR': 'ARG', 'CO': 'COL', 'CL': 'CHL', 'PE': 'PER',
  'VE': 'VEN', 'ZA': 'ZAF', 'NG': 'NGA', 'EG': 'EGY', 'SA': 'SAU',
  'AE': 'ARE', 'KE': 'KEN', 'MA': 'MAR', 'TR': 'TUR', 'RU': 'RUS',
  'UA': 'UKR',
  // Full names → ISO-3
  'UNITED STATES': 'USA', 'UNITED STATES OF AMERICA': 'USA',
  'CANADA': 'CAN', 'MEXICO': 'MEX',
  'UNITED KINGDOM': 'GBR', 'UK': 'GBR', 'GREAT BRITAIN': 'GBR',
  'GERMANY': 'DEU', 'FRANCE': 'FRA', 'NETHERLANDS': 'NLD',
  'ITALY': 'ITA', 'SPAIN': 'ESP', 'POLAND': 'POL', 'SWEDEN': 'SWE',
  'NORWAY': 'NOR', 'DENMARK': 'DNK', 'FINLAND': 'FIN', 'BELGIUM': 'BEL',
  'SWITZERLAND': 'CHE', 'AUSTRIA': 'AUT', 'CZECH REPUBLIC': 'CZE',
  'HUNGARY': 'HUN', 'PORTUGAL': 'PRT', 'ROMANIA': 'ROU', 'BULGARIA': 'BGR',
  'GREECE': 'GRC', 'CHINA': 'CHN', 'JAPAN': 'JPN', 'SOUTH KOREA': 'KOR',
  'AUSTRALIA': 'AUS', 'NEW ZEALAND': 'NZL', 'SINGAPORE': 'SGP', 'INDIA': 'IND',
  'THAILAND': 'THA', 'VIETNAM': 'VNM', 'MALAYSIA': 'MYS', 'INDONESIA': 'IDN',
  'PHILIPPINES': 'PHL', 'BRAZIL': 'BRA', 'ARGENTINA': 'ARG', 'COLOMBIA': 'COL',
  'CHILE': 'CHL', 'PERU': 'PER', 'VENEZUELA': 'VEN', 'SOUTH AFRICA': 'ZAF',
  'NIGERIA': 'NGA', 'EGYPT': 'EGY', 'SAUDI ARABIA': 'SAU',
  'UNITED ARAB EMIRATES': 'ARE', 'UAE': 'ARE', 'KENYA': 'KEN', 'MOROCCO': 'MAR',
  'TURKEY': 'TUR', 'RUSSIA': 'RUS', 'UKRAINE': 'UKR',
};

export class CountryCodes {
  private static key(raw: string): string {
    return raw.trim().toUpperCase();
  }

  private static knownIso3(key: string): string {
    const fromIso2 = ISO2_TO_ISO3[key];
    if (fromIso2 !== undefined) return fromIso2;
    if (ISO3_TO_ISO2[key] !== undefined) return key;
    return COUNTRY_CODE_MAP[key] ?? '';
  }

  static toIso3(raw: string): string {
    const key = CountryCodes.key(raw);
    if (key.length === 0) return '';
    const iso3 = CountryCodes.knownIso3(key);
    if (iso3.length > 0) return iso3;
    return key.length === 3 && /^[A-Z]{3}$/.test(key) ? key : raw.slice(0, 3).toUpperCase();
  }

  static toIso2(raw: string): string {
    const direct = Geo.normalizeCountryCode(raw);
    if (direct !== null) return direct;
    // Ingest-side normalization: raw event data carries colloquial country
    // names (e.g. "United States", "Great Britain") geo-resolver's global
    // lookup doesn't recognize. Resolve to the canonical ISO-3 form first,
    // then defer to geo-resolver for the actual code resolution.
    const canonicalIso3 = COUNTRY_CODE_MAP[CountryCodes.key(raw)];
    return canonicalIso3 !== undefined ? Geo.normalizeCountryCode(canonicalIso3) ?? '' : '';
  }

  static toGeoSignalIso2(countryCode: string, recipientCountry: string): string {
    const direct = CountryCodes.toIso2(countryCode);
    return direct.length > 0 ? direct : CountryCodes.toIso2(recipientCountry);
  }
}
// #endregion country-codes-service

// #region units-service
/**
 * Units: weight conversion to grams.
 */
export class Units {
  private static readonly toGramsDispatch: Readonly<Record<string, (value: number) => number>> = {
    'g':  (value) => value,
    'kg': (value) => value * 1000,
    'lb': (value) => value * 453.592,
    'oz': (value) => value * 28.3495,
  };

  static toGrams(value: number, unit: string): number {
    return (Units.toGramsDispatch[unit] ?? ((v: number) => v))(value);
  }
}
// #endregion units-service

// #region event-classifier-service
/**
 * EventClassifier: maps free-text statuses and carrier/weight to canonical enums.
 */
// Order matters: the more specific 'out for delivery' must be tested BEFORE the
// generic 'deliver' (which 'out for delivery' also contains), or an OFD scan
// would be mis-classified as the DELIVERED terminal.
const STATUS_DISPATCH: Array<{ 'pattern': RegExp; 'status': NormalizedShipment['status'] }> = [
  { 'pattern': /out.?for.?delivery|out_for_delivery/i, 'status': 'OUT_FOR_DELIVERY' },
  { 'pattern': /deliver/i,                           'status': 'DELIVERED' },
  { 'pattern': /exception|address|hold|customs|delay|damage/i, 'status': 'EXCEPTION' },
  { 'pattern': /arrival|arrived|arrival.scan/i,      'status': 'ARRIVAL' },
  { 'pattern': /depart|departed|dispatch/i,          'status': 'DEPARTURE' },
  { 'pattern': /scan|transit|in.transit|picked.?up|pickup/i, 'status': 'SCAN' },
];

export class EventClassifier {
  static eventType(rawStatus: string): NormalizedShipment['status'] {
    for (const { pattern, status } of STATUS_DISPATCH) {
      if (pattern.test(rawStatus)) return status;
    }
    return 'SCAN'; // default for unrecognised but non-exceptional statuses
  }

  static serviceTier(carrierId: string, weightGrams: number): NormalizedShipment['serviceTier'] {
    // Express: premium carriers at any weight, or light parcels via any carrier
    if (carrierId === 'fedex' || carrierId === 'dhl') {
      return weightGrams < 5000 ? 'express' : 'standard';
    }
    if (carrierId === 'usps' || carrierId === 'royal-mail') {
      return weightGrams < 500 ? 'standard' : 'economy';
    }
    // ups, dpd: standard for typical weights
    return weightGrams > 20_000 ? 'economy' : 'standard';
  }

  static sizeTier(weightGrams: number): NormalizedShipment['sizeTier'] {
    if (weightGrams < 50)       return 'envelope';
    if (weightGrams < 500)      return 'small';
    if (weightGrams < 5_000)    return 'medium';
    if (weightGrams < 30_000)   return 'large';
    return 'freight';
  }
}
// #endregion event-classifier-service

// #region fx-rates-service
/**
 * FxRates: currency → USD conversion for integer minor units.
 */
export class FxRates {
  static rate(currency: string): number {
    return FX_TABLE[currency.toUpperCase()] ?? 1.0;
  }

  static toUsdMinor(amountMinor: number, currency: string): number {
    const rate = FxRates.rate(currency);
    return Math.round(amountMinor * rate);
  }
}
// #endregion fx-rates-service

// #region pricing-catalog-service
/**
 * PricingCatalog: product lookup and basket pricing with FX normalisation.
 */
const CATALOG_MAP = new Map<string, CatalogEntry>(CATALOG.map((e) => [e.productId, e]));
const CATALOG_IDS = CATALOG.map((e) => e.productId);

export class PricingCatalog {
  static priceFor(productId: string): { 'name': string; 'category': string; 'unitPriceMinor': number; 'currency': string } {
    const entry = CATALOG_MAP.get(productId);
    if (entry === undefined) {
      return { 'name': 'Unknown Product', 'category': 'Unknown', 'unitPriceMinor': 0, 'currency': 'USD' };
    }
    return { 'name': entry.name, 'category': entry.category, 'unitPriceMinor': entry.unitPriceMinor, 'currency': entry.currency };
  }

  static catalogIds(): string[] {
    return CATALOG_IDS;
  }

  static order(lineItems: Array<{ 'productId': string; 'quantity': number }>): PricedOrder {
    const lines = lineItems.map((item) => {
      const product = PricingCatalog.priceFor(item.productId);
      return {
        'productId':      item.productId,
        'name':           product.name,
        'category':       product.category,
        'quantity':       item.quantity,
        'unitPriceMinor': product.unitPriceMinor,
        'currency':       product.currency,
        'lineTotalMinor': product.unitPriceMinor * item.quantity,
      };
    });

    // Group by currency; use the first line's currency as the order currency
    const currency = lines[0]?.currency ?? 'USD';

    // Sum all lines in their native currencies, then FX-normalize each to USD
    let subtotalMinor = 0;
    let subtotalUsdMinor = 0;
    for (const line of lines) {
      subtotalMinor += line.lineTotalMinor;
      subtotalUsdMinor += FxRates.toUsdMinor(line.lineTotalMinor, line.currency);
    }

    const fxRate = FxRates.rate(currency);

    return {
      'lines':            lines,
      'subtotalMinor':    subtotalMinor,
      'currency':         currency,
      'subtotalUsdMinor': subtotalUsdMinor,
      'fxRate':           fxRate,
    };
  }
}
// #endregion pricing-catalog-service

// #region shipping-calculator-service
/**
 * ShippingCalculator: haversine distance and carrier rate → ShippingQuote.
 */
export class ShippingCalculator {
  private static readonly EARTH_RADIUS_KM = 6371;

  static distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
    const toRad = (deg: number): number => (deg * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const raw = ShippingCalculator.EARTH_RADIUS_KM * c;
    // Minimum meaningful distance (same-city): 1 km
    return Math.max(raw, 1);
  }

  static quote(
    distanceKm: number,
    weightGrams: number,
    serviceTier: NormalizedShipment['serviceTier'],
    carrierId: string,
  ): ShippingQuote {
    const rate = CARRIER_RATES[carrierId] ?? CARRIER_RATES['ups'];
    if (rate === undefined) {
      return {
        'distanceKm':   distanceKm,
        'costUsdMinor': 999,
        'breakdown': { 'baseMinor': 999, 'perKmMinor': 0, 'perKgMinor': 0, 'tierMultiplier': 1.0 },
      };
    }
    const multiplier = rate.tierMultipliers[serviceTier];
    const weightKg = weightGrams / 1000;
    const baseMinor   = rate.baseMinorUsd;
    const perKmMinor  = Math.round(rate.perKmMinorUsd * distanceKm);
    const perKgMinor  = Math.round(rate.perKgMinorUsd * weightKg);
    const costUsdMinor = Math.round((baseMinor + perKmMinor + perKgMinor) * multiplier);

    return {
      'distanceKm':   distanceKm,
      'costUsdMinor': costUsdMinor,
      'breakdown': {
        'baseMinor':      baseMinor,
        'perKmMinor':     perKmMinor,
        'perKgMinor':     perKgMinor,
        'tierMultiplier': multiplier,
      },
    };
  }
}
// #endregion shipping-calculator-service

// #region eta-estimator-service
/**
 * EtaEstimator: nominal transit + disruptions → actual ETA vs the SLA promise.
 *
 * `transitHours` is the single source of truth for NOMINAL transit duration:
 * both the generator (sizing the promised SLA and the disrupted ETA) and
 * `estimate` (computing the actual ETA) call it.
 *
 * The promise is an SLA commitment set at dispatch, not a function of transit.
 * Disruptions (breakdown, customs hold, mis-sort, weather) make actual delays
 * routinely EXCEED nominal transit — realistic, not a bug. The only hard
 * invariant is promised ≥ dispatch. The generator carries the disruption hours
 * forward implicitly through the scan timestamps; `estimate` adds the scan's
 * own disruption hours so etaEpochMs = depart + (nominalTransit + disruption).
 */
export class EtaEstimator {
  /**
   * Transit hours = distance / speed + handling, scaled by a tier factor.
   * Non-express tiers add a modest sortation/consolidation overhead.
   */
  static transitHours(
    distanceKm: number,
    carrierId: string,
    serviceTier: NormalizedShipment['serviceTier'],
  ): number {
    const rate = CARRIER_RATES[carrierId] ?? CARRIER_RATES['ups'];
    const speedKmH = rate?.speedKmPerHour ?? 500;
    const handlingH = rate?.handlingHours ?? 4;
    const tierFactor = serviceTier === 'express' ? 1.0 : serviceTier === 'standard' ? 1.25 : 1.6;
    return (distanceKm / speedKmH + handlingH) * tierFactor;
  }

  static estimate(
    distanceKm: number,
    carrierId: string,
    serviceTier: NormalizedShipment['serviceTier'],
    departEpochMs: number,
    promisedEpochMs: number,
    disruptionHours: number,
  ): DeliveryEstimate {
    // transitHours reports the NOMINAL transit; actual ETA adds disruptions.
    const transitHours = EtaEstimator.transitHours(distanceKm, carrierId, serviceTier);

    const etaEpochMs = departEpochMs + Math.round((transitHours + disruptionHours) * 3_600_000);
    // Invariant: promised >= dispatch is enforced by the generator. Late delays
    // MAY exceed nominal transit when a disruption struck. onTime is DERIVED from
    // the (rounded) delay so the two are always consistent — a sub-hour overrun
    // rounds to 0 delay and counts as on-time, never "late with 0 delay".
    const delayHours = Math.max(0, Math.round((etaEpochMs - promisedEpochMs) / 3_600_000));
    const onTime = delayHours === 0;

    return {
      'transitHours':    transitHours,
      'etaEpochMs':      etaEpochMs,
      'etaIso':          TimeNormalizer.toIso(etaEpochMs),
      'promisedEpochMs': promisedEpochMs,
      'onTime':          onTime,
      'delayHours':      delayHours,
    };
  }
}
// #endregion eta-estimator-service

// #region disruptions-service
/**
 * Disruptions: maps a journey's disruption reason to its extra delivery hours.
 *
 * The generator stamps a reason on every scan of a disrupted journey; the
 * pipeline's enrich-eta converts the reason back to hours so the actual ETA
 * (and the resulting delay, which MAY exceed nominal transit) is reproduced
 * deterministically from the carried reason alone.
 */
const DISRUPTION_HOURS: Record<string, number> = {
  '':                 0,
  'customs hold':     18,
  'mechanical delay': 30,
  'weather hold':     12,
  'mis-sort':         48,
  'lost in transit':  96,
};

export class Disruptions {
  static hoursFor(reason: string): number {
    return DISRUPTION_HOURS[reason] ?? 0;
  }
}
// #endregion disruptions-service

// #region cold-chain-service
/**
 * ColdChain: evaluates a sensor-reading's telemetry against cold-chain limits.
 *
 * A breach is a temperature outside the 2–8°C window or a shock event above 2.5g.
 * Pure deterministic thresholds — only `sensor-reading` events carry telemetry,
 * so this check runs ONLY on the sensor lane (the per-event-type skip showcase).
 */
const COLD_CHAIN_MIN_C = 2;
const COLD_CHAIN_MAX_C = 8;
const COLD_CHAIN_MAX_SHOCK_G = 2.5;

export class ColdChain {
  static breached(tempC: number, shockG: number): boolean {
    return tempC < COLD_CHAIN_MIN_C || tempC > COLD_CHAIN_MAX_C || shockG > COLD_CHAIN_MAX_SHOCK_G;
  }
}
// #endregion cold-chain-service

// #region customs-service
/**
 * Customs: maps a customs-event's status to its clearance dwell hours.
 *
 * A held shipment dwells longer than a cleared one. Pure deterministic lookup —
 * runs ONLY on the customs lane (pricing/eta are skipped for customs events).
 */
const CUSTOMS_DWELL_HOURS: Record<string, number> = {
  'held':    18,
  'cleared': 2,
};

export class Customs {
  static dwellHours(customsStatus: string): number {
    return CUSTOMS_DWELL_HOURS[customsStatus] ?? 4;
  }
}
// #endregion customs-service

// #region consent-service
/**
 * Consent: resolves the deterministic marketing consent status for a scan.
 *
 * Marketing consent → 'valid' normally, 'expired' for a deterministic 10% slice
 * (shipment index % 10 === 0), 'missing' when not consented. The same derivation
 * is used by the redaction routing decision and the GDPR consent-gate, so they
 * never disagree.
 */
export class Consent {
  static statusFor(shipmentId: string, marketingConsent: boolean): GdprResult['consentStatus'] {
    if (!marketingConsent) return 'missing';
    const index = parseInt(shipmentId.replace('SHP-', ''), 10);
    return Number.isFinite(index) && index % 10 === 0 ? 'expired' : 'valid';
  }
}
// #endregion consent-service

// #region shipment-events-service
/**
 * ShipmentEvents: deterministic synthetic journey/scan generator.
 *
 * Each entity (shipmentId) has a JOURNEY: an ordered sequence of M~2–5 scans
 * moving origin → destination with monotonically increasing timestamps and
 * coords along the path. Scans from many journeys are interleaved in time order
 * (a real feed); one scan per scatter item. The status progression is
 * DEPARTURE → SCAN/ARRIVAL → OUT_FOR_DELIVERY → DELIVERED, with a disrupted
 * scan flagged EXCEPTION. Seeded LCG (Knuth params) — no Date.now/Math.random;
 * tz-lookup + Intl are pure on the fixed epochs.
 *
 * Memory model:
 *   journeyGenerator() yields ONE journey at a time (a small RawShipmentEvent[]).
 *   Peak memory is O(1 journey) regardless of how many journeys are consumed.
 *   typedScansGenerator consumes journeyGenerator lazily — no full-feed array.
 *   buildRawScans(n) pulls n journeys, collects then time-sorts — O(n journeys).
 */
interface TypedScanContext {
  readonly scan: RawShipmentEvent;
  readonly pickCustoms: () => 'held' | 'cleared' | 'inspection';
}

export class ShipmentEvents {
  private static readonly typedScanDispatch: Readonly<Record<string, (ctx: TypedScanContext) => TypedScan>> = {
    'sensor-reading': ({ scan }) => {
      const h = ShipmentEvents.fnv1a(`${scan.shipmentId}:${scan.scanSeq}:sensor`);
      const b0 = (h >>> 24) & 0xff;
      const b1 = (h >>> 16) & 0xff;
      const b2 = (h >>> 8)  & 0xff;
      return {
        ...scan,
        'eventType':   'sensor-reading',
        'tempC':       Math.round((2 + (b0 / 255) * 6) * 10) / 10,
        'humidityPct': Math.round(40 + (b1 / 255) * 40),
        'shockG':      Math.round((b2 / 255) * 30) / 10,
      };
    },
    'customs-event': ({ scan, pickCustoms }) => ({
      ...scan,
      'eventType':     'customs-event',
      'customsStatus': pickCustoms(),
    }),
    'delivery-confirmation': ({ scan }) => {
      const dh = ShipmentEvents.fnv1a(`${scan.shipmentId}:${scan.scanSeq}:delivery`);
      const deliveredAtMs = 1735689600000 + (dh % 31_536_000_000); // within 2026
      return {
        ...scan,
        'eventType':    'delivery-confirmation',
        'delivered':    true,
        'podSignature': `SIG-${scan.shipmentId}-${scan.scanSeq}`,
        'deliveredAt':  new Date(deliveredAtMs).toISOString(),
      };
    },
    'position-ping':  ({ scan }) => ({ ...scan, 'eventType': 'position-ping' }),
    'facility-scan':  ({ scan }) => ({ ...scan, 'eventType': 'facility-scan' }),
  };

  private static lcg(seed: number): () => number {
    let state = seed >>> 0;
    return (): number => {
      state = ((state * 1664525 + 1013904223) >>> 0);
      return state / 4294967296;
    };
  }

  // ── Canonical timestamp formats (5 variants, cycle by index % 5) ──────────
  private static formatTimestamp(epochMs: number, variant: number): string {
    const d = new Date(epochMs);
    switch (variant % 5) {
      case 0:
        // ISO-8601 with Z
        return d.toISOString();
      case 1: {
        // MM/DD/YYYY HH:mm
        const mm  = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd  = String(d.getUTCDate()).padStart(2, '0');
        const yyyy = String(d.getUTCFullYear());
        const hh  = String(d.getUTCHours()).padStart(2, '0');
        const min = String(d.getUTCMinutes()).padStart(2, '0');
        return `${mm}/${dd}/${yyyy} ${hh}:${min}`;
      }
      case 2:
        // Unix epoch seconds as string
        return String(Math.floor(epochMs / 1000));
      case 3:
        // YYYY-MM-DD date-only
        return d.toISOString().slice(0, 10);
      default: {
        // RFC-2822-ish: "Wed, 04 Jun 2026 12:30:00 GMT"
        const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
        const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
        const dayName   = DAYS[d.getUTCDay()] ?? 'Mon';
        const monthName = MONTHS[d.getUTCMonth()] ?? 'Jan';
        const dd  = String(d.getUTCDate()).padStart(2, '0');
        const yyyy = String(d.getUTCFullYear());
        const hh  = String(d.getUTCHours()).padStart(2, '0');
        const min = String(d.getUTCMinutes()).padStart(2, '0');
        const sec = String(d.getUTCSeconds()).padStart(2, '0');
        return `${dayName}, ${dd} ${monthName} ${yyyy} ${hh}:${min}:${sec} GMT`;
      }
    }
  }

  // SLA committed window per tier (hours), plus deterministic variance.
  private static slaBaseHours(serviceTier: NormalizedShipment['serviceTier']): number {
    return serviceTier === 'express' ? 24 : serviceTier === 'standard' ? 72 : 120;
  }

  // Disruption reasons (heavy-tailed extra hours). Index 0 = clean (most scans).
  private static readonly DISRUPTIONS: Array<{ 'reason': string; 'hours': number }> = [
    { 'reason': '',                 'hours': 0 },
    { 'reason': 'customs hold',     'hours': 18 },
    { 'reason': 'mechanical delay', 'hours': 30 },
    { 'reason': 'weather hold',     'hours': 12 },
    { 'reason': 'mis-sort',         'hours': 48 },
    { 'reason': 'lost in transit',  'hours': 96 },
  ];

  // Static lookup tables shared by journeyGenerator and buildRawScans.
  private static readonly CARRIERS: Array<{ 'label': string; 'carrierId': string }> = [
    { 'label': 'FEDEX',                  'carrierId': 'fedex' },
    { 'label': 'FedEx',                  'carrierId': 'fedex' },
    { 'label': 'Federal Express',        'carrierId': 'fedex' },
    { 'label': 'fedex ground',           'carrierId': 'fedex' },
    { 'label': 'UPS',                    'carrierId': 'ups' },
    { 'label': 'United Parcel Service',  'carrierId': 'ups' },
    { 'label': 'DHL Express',            'carrierId': 'dhl' },
    { 'label': 'DHL',                    'carrierId': 'dhl' },
    { 'label': 'USPS',                   'carrierId': 'usps' },
    { 'label': 'Royal Mail',             'carrierId': 'royal-mail' },
    { 'label': 'DPD',                    'carrierId': 'dpd' },
  ];

  private static readonly REGIONS: Array<{ 'lat': number; 'lng': number; 'country': string; 'countryVariants': string[]; 'gatewayIp': string }> = [
    { 'lat':  39.9,  'lng':  -75.2, 'country': 'USA',  'countryVariants': ['US', 'USA', 'United States'],        'gatewayIp': '8.8.8.8' },
    { 'lat':  51.5,  'lng':   -0.1, 'country': 'GBR',  'countryVariants': ['GB', 'GBR', 'United Kingdom'],       'gatewayIp': '212.58.244.1' },
    { 'lat':  48.9,  'lng':    2.3, 'country': 'FRA',  'countryVariants': ['FR', 'FRA', 'France'],               'gatewayIp': '80.67.169.12' },
    { 'lat':  52.5,  'lng':   13.4, 'country': 'DEU',  'countryVariants': ['DE', 'DEU', 'Germany'],              'gatewayIp': '194.150.168.168' },
    { 'lat':  35.7,  'lng':  139.7, 'country': 'JPN',  'countryVariants': ['JP', 'JPN', 'Japan'],                'gatewayIp': '210.130.1.1' },
    { 'lat':  31.2,  'lng':  121.5, 'country': 'CHN',  'countryVariants': ['CN', 'CHN', 'China'],                'gatewayIp': '114.114.114.114' },
    { 'lat': -33.9,  'lng':  151.2, 'country': 'AUS',  'countryVariants': ['AU', 'AUS', 'Australia'],            'gatewayIp': '1.1.1.1' },
    { 'lat': -23.5,  'lng':  -46.6, 'country': 'BRA',  'countryVariants': ['BR', 'BRA', 'Brazil'],               'gatewayIp': '200.160.2.3' },
    { 'lat':  19.4,  'lng':  -99.1, 'country': 'MEX',  'countryVariants': ['MX', 'MEX', 'Mexico'],               'gatewayIp': '200.33.146.249' },
    { 'lat':  28.6,  'lng':   77.2, 'country': 'IND',  'countryVariants': ['IN', 'IND', 'India'],                'gatewayIp': '49.44.79.1' },
    { 'lat':  25.2,  'lng':   55.3, 'country': 'ARE',  'countryVariants': ['AE', 'ARE', 'United Arab Emirates'], 'gatewayIp': '94.200.200.200' },
    { 'lat': -26.2,  'lng':   28.0, 'country': 'ZAF',  'countryVariants': ['ZA', 'ZAF', 'South Africa'],         'gatewayIp': '196.4.160.4' },
  ];

  private static readonly ORIGIN_HUBS: Array<{ 'lat': number; 'lng': number; 'name': string }> = [
    { 'lat':  35.0,  'lng':  -89.9, 'name': 'Memphis' },
    { 'lat':  51.4,  'lng':   12.2, 'name': 'Leipzig' },
    { 'lat':  22.3,  'lng':  113.9, 'name': 'Hong Kong' },
    { 'lat':  25.3,  'lng':   55.4, 'name': 'Dubai' },
    { 'lat':  40.6,  'lng':  -73.8, 'name': 'New York' },
    { 'lat':  -3.1,  'lng':  -38.5, 'name': 'Fortaleza' },
  ];

  private static readonly NAMES: string[] = [
    'Alice Müller', 'Bob Chen', 'Carol Smith', 'David García', 'Eve Johnson',
    'Frank Kim', 'Grace Lee', 'Henry Brown', 'Isabelle Dubois', 'Jack Okonkwo',
  ];

  private static readonly DOMAINS: string[] = [
    'example.com', 'test.org', 'mail.net', 'inbox.io', 'post.co',
  ];

  private static readonly STATUS_DEPARTURE: string[] = ['departed facility', 'dispatch', 'picked up'];
  private static readonly STATUS_TRANSIT:   string[] = ['in transit', 'arrival scan', 'arrived at hub', 'en route'];
  private static readonly STATUS_OFD:       string[] = ['out for delivery'];
  private static readonly STATUS_DELIVERED: string[] = ['delivered', 'DELIVERED'];
  private static readonly STATUS_EXCEPTION: string[] = ['exception - address', 'customs hold'];

  private static readonly WEIGHT_UNITS: Array<RawShipmentEvent['weightUnit']> = ['lb', 'kg', 'g', 'oz'];
  private static readonly BASE_EPOCH_MS = 1735689600000; // 2026-01-01T00:00:00Z
  private static readonly FORMAT_CYCLE = [0, 1, 2, 4] as const;

  // FNV-1a 32-bit hash — deterministic sensor channel sharding for typedScansGenerator.
  private static fnv1a(key: string): number {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
      h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
    }
    return h;
  }

  /**
   * Lazy per-journey generator. Yields one journey (a small RawShipmentEvent[],
   * 2–5 scans) at a time using the same seeded LCG (seed 42) and construction
   * logic as buildRawScans. Peak memory is O(1 journey) — journeys are NOT
   * interleaved by time here; the caller decides ordering.
   *
   * The shared `rand` and `formatIdxBox` are advanced identically to
   * buildRawScans so that the first N journeys from journeyGenerator are
   * byte-identical to the first N journeys produced by buildRawScans before
   * the final time-sort.
   *
   * @param rand        Seeded LCG function (call ShipmentEvents.lcg(42) externally).
   * @param formatIdxBox Mutable box { v: number } for the per-scan format cycle counter.
   * @param journeyIndex The ordinal of this journey (0-based) — used for shipmentId
   *                    and the lossless timestamp format selector.
   */
  private static buildJourney(
    rand: () => number,
    formatIdxBox: { v: number },
    journeyIndex: number,
  ): RawShipmentEvent[] {
    const pick = <T>(arr: readonly T[]): T => {
      const el = arr[Math.floor(rand() * arr.length)];
      if (el !== undefined) return el;
      const last = arr[arr.length - 1];
      if (last !== undefined) return last;
      throw new Error('pick: empty array');
    };

    const dest = pick(ShipmentEvents.REGIONS);
    const hasGatewayIp = rand() < 0.8;
    const gatewayIp = hasGatewayIp ? dest.gatewayIp : '';
    const destLat = dest.lat + (rand() - 0.5) * 4;
    const destLng = dest.lng + (rand() - 0.5) * 4;

    const hub = pick(ShipmentEvents.ORIGIN_HUBS);
    const originLat = hub.lat + (rand() - 0.5) * 4;
    const originLng = hub.lng + (rand() - 0.5) * 4;

    const carrierEntry = pick(ShipmentEvents.CARRIERS);
    const carrier   = carrierEntry.label;
    const carrierId = carrierEntry.carrierId;

    const name       = pick(ShipmentEvents.NAMES);
    const domain     = pick(ShipmentEvents.DOMAINS);
    const localPart  = `user${journeyIndex}`;
    const countryRaw = pick(dest.countryVariants);

    const weightValue = 10 + Math.floor(rand() * 3490) / 10;
    const weightUnit  = pick(ShipmentEvents.WEIGHT_UNITS);
    const weightGrams = Units.toGrams(weightValue, weightUnit);
    const serviceTier = EventClassifier.serviceTier(carrierId, weightGrams);

    const shipDistanceKm = ShippingCalculator.distanceKm(originLat, originLng, destLat, destLng);
    const nominalTransitH = EtaEstimator.transitHours(shipDistanceKm, carrierId, serviceTier);

    const slaBase = ShipmentEvents.slaBaseHours(serviceTier);
    const tightRoll = rand();
    const tightSla = tightRoll < 0.5;
    const slaHours = tightSla
      ? Math.max(nominalTransitH + 1, nominalTransitH * (1.0 + rand() * 0.1))
      : Math.max(nominalTransitH + 1, nominalTransitH + 6 + rand() * Math.min(slaBase, 36));

    const disruptProb = shipDistanceKm > 8000 ? 0.42 : 0.32;
    const disrupted = rand() < disruptProb;
    const cleanDisruption = ShipmentEvents.DISRUPTIONS[0] ?? { 'reason': '', 'hours': 0 };
    const disruptionPick = disrupted
      ? (ShipmentEvents.DISRUPTIONS[1 + Math.floor(rand() * (ShipmentEvents.DISRUPTIONS.length - 1))] ?? cleanDisruption)
      : cleanDisruption;
    const disruptionHours  = disruptionPick.hours;
    const disruptionReason = disruptionPick.reason;

    const daysOffset  = Math.floor(rand() * 60);
    const hoursOffset = Math.floor(rand() * 24);
    const dispatchEpochMs = ShipmentEvents.BASE_EPOCH_MS + daysOffset * 86_400_000 + hoursOffset * 3_600_000;

    const promisedMs = dispatchEpochMs + Math.round(slaHours * 3_600_000);
    const i = journeyIndex;
    const rawPromisedDeliveryAt = ShipmentEvents.formatTimestamp(promisedMs, i % 2 === 0 ? 0 : 2);
    const rawDispatchAt = ShipmentEvents.formatTimestamp(dispatchEpochMs, i % 2 === 0 ? 2 : 0);

    const consent = rand() < 0.6;
    const violationRoll = rand();
    const isViolation = violationRoll < 0.02;
    const lawfulBasis: RawShipmentEvent['lawfulBasis'] = isViolation ? 'none' : 'contract';
    const specialCategory: RawShipmentEvent['specialCategory'] = isViolation ? 'health' : 'none';

    const catalogIds = PricingCatalog.catalogIds();
    const lineCount = 1 + Math.floor(rand() * 4);
    const lineItems: Array<{ 'productId': string; 'quantity': number }> = [];
    for (let j = 0; j < lineCount; j++) {
      const productId = catalogIds[Math.floor(rand() * catalogIds.length)] ?? 'PROD-001';
      const quantity  = 1 + Math.floor(rand() * 3);
      lineItems.push({ 'productId': productId, 'quantity': quantity });
    }
    const phonePrefix = 100 + Math.floor(rand() * 900);
    const phoneMid    = 100 + Math.floor(rand() * 900);
    const phoneSuffix = 1000 + Math.floor(rand() * 9000);
    const recipientEmail   = `${localPart}@${domain}`;
    const recipientPhone   = `+1-${phonePrefix}-${phoneMid}-${phoneSuffix}`;
    const recipientAddress = `${1000 + Math.floor(rand() * 8000)} Main St, ${dest.country}`;
    const facilityId       = `FAC-${hub.name.replace(/\s+/g, '').toUpperCase().slice(0, 3)}-${String(Math.floor(rand() * 100)).padStart(3, '0')}`;

    const scanCount = 2 + Math.floor(rand() * 4);
    const journeyFails = rand() < 0.12;
    const disruptScanIdx = disrupted && scanCount > 2
      ? 1 + Math.floor(rand() * (scanCount - 2))
      : -1;

    const scans: RawShipmentEvent[] = [];
    let prevLat = originLat;
    let prevLng = originLng;
    let cursorMs = dispatchEpochMs;

    for (let s = 0; s < scanCount; s++) {
      const t = scanCount === 1 ? 0 : s / (scanCount - 1);
      const lat = originLat + (destLat - originLat) * t;
      const lng = originLng + (destLng - originLng) * t;

      if (s > 0) {
        const legShare = nominalTransitH / (scanCount - 1);
        let legHours = legShare;
        if (s === disruptScanIdx) legHours += disruptionHours;
        cursorMs += Math.round(legHours * 3_600_000);
      }

      const isLast  = s === scanCount - 1;
      const isFirst = s === 0;
      const isTransientException = s === disruptScanIdx;

      const rawStatus = isLast
          ? (journeyFails ? pick(ShipmentEvents.STATUS_EXCEPTION) : pick(ShipmentEvents.STATUS_DELIVERED))
        : isFirst ? pick(ShipmentEvents.STATUS_DEPARTURE)
        : isTransientException ? pick(ShipmentEvents.STATUS_EXCEPTION)
        : (s === scanCount - 2) ? pick(ShipmentEvents.STATUS_OFD)
        : pick(ShipmentEvents.STATUS_TRANSIT);

      // The interpolated lat/lng are always valid WGS-84 (REGION/HUB anchors ±2°).
      // A real GPS feed almost never emits an out-of-range fix; reserve a tiny
      // fraction (~0.3%) for a genuinely-malformed sensor reading so the error
      // sink has a realistic trickle to report — but DON'T fabricate out-of-range
      // coords for 6% of the feed (that was synthetic noise, not real-world data).
      const invalid = rand() < 0.003;
      const finalLat = invalid ? 95 + rand() * 10  : lat;
      const finalLng = invalid ? 185 + rand() * 10 : lng;

      const variant = ShipmentEvents.FORMAT_CYCLE[formatIdxBox.v % ShipmentEvents.FORMAT_CYCLE.length] ?? 0;
      const rawTimestamp = ShipmentEvents.formatTimestamp(cursorMs, variant);
      formatIdxBox.v++;

      scans.push({
        'shipmentId':            `SHP-${String(i).padStart(6, '0')}`,
        'scanSeq':               s,
        'rawTimestamp':          rawTimestamp,
        'rawDispatchAt':         rawDispatchAt,
        'rawStatus':             rawStatus,
        'carrier':               carrier,
        'ipAddress':             gatewayIp,
        'localeTag':             '',
        'countryCode':           '',
        'latitude':              finalLat,
        'longitude':             finalLng,
        'legFromLat':            prevLat,
        'legFromLng':            prevLng,
        'originLat':             originLat,
        'originLng':             originLng,
        'destLat':               destLat,
        'destLng':               destLng,
        'weight':                weightValue,
        'weightUnit':            weightUnit,
        'recipientName':         name,
        'recipientEmail':        recipientEmail,
        'recipientPhone':        recipientPhone,
        'recipientAddress':      recipientAddress,
        'recipientCountry':      countryRaw,
        'marketingConsent':      consent,
        'rawPromisedDeliveryAt': rawPromisedDeliveryAt,
        'lineItems':             lineItems.map((li) => ({ ...li })),
        'facilityId':            facilityId,
        'lawfulBasis':           lawfulBasis,
        'specialCategory':       specialCategory,
        'disruptionReason':      disruptionReason,
      });

      prevLat = lat;
      prevLng = lng;
    }

    return scans;
  }

  /**
   * Lazy per-journey generator. Yields one journey (RawShipmentEvent[], 2–5 scans)
   * at a time. Uses the same seeded LCG (seed 42) and construction logic as
   * buildRawScans. Peak memory is O(1 journey) regardless of total journeys consumed.
   *
   * Scans within each journey are in scanSeq order (0..M-1). Journeys are NOT
   * time-sorted across each other — the caller applies ordering if needed.
   * buildRawScans collects all journeys then sorts by epoch; typedScansGenerator
   * processes journeys in emission order (no cross-journey sort required).
   */
  static * journeyGenerator(): Generator<RawShipmentEvent[]> {
    const rand = ShipmentEvents.lcg(42);
    const formatIdxBox = { v: 0 };
    for (let i = 0; ; i++) {
      yield ShipmentEvents.buildJourney(rand, formatIdxBox, i);
    }
  }

  /**
   * Typed generator: yields one TypedScan at a time, INTERLEAVED across all
   * EventTypeConfig entries using a deterministic fractional-accumulator scheduler
   * (coin-sorter / weighted round-robin). Each type's total scan count equals
   * entry.count exactly. Types are mixed throughout the stream so the feed looks
   * like a live heterogeneous source rather than sequential blocks.
   *
   * Scheduler: each active entry holds an accumulator initialised to 0. On every
   * step, all accumulators advance by (entry.count / totalCount). The entry with
   * the highest accumulator wins, has 1.0 subtracted, and yields its next scan.
   * Ties are broken by config order (stable, deterministic). This is Bresenham
   * line-drawing applied to type selection — no randomness, no floating-point
   * drift beyond per-step addition.
   *
   * Memory: O(numTypes) — one journeyGenerator iterator per active type, each
   * buffering at most one journey (2–5 scans) at a time. No full-feed array is
   * materialised regardless of entry.count.
   *
   * Per-type fields:
   *   - sensor-reading → tempC, humidityPct, shockG (fnv1a-sharded)
   *   - customs-event  → customsStatus ('held' | 'cleared' | 'inspection')
   *   - delivery-confirmation → delivered: true, podSignature, deliveredAt
   *   - position-ping / facility-scan → no extra fields beyond the base
   *
   * Terminal/non-terminal selection: delivery-confirmation takes the LAST scan of
   * each journey; all other types take the NON-terminal scans (everything except
   * the last) — identical semantics to the previous sequential implementation.
   */
  static * typedScansGenerator(config: EventTypeConfig): Generator<TypedScan> {
    const CUSTOMS_STATUSES: Array<'held' | 'cleared' | 'inspection'> = ['held', 'cleared', 'inspection'];
    // Independent LCG for customs-status picks — does not share state with
    // journeyGenerator's encapsulated LCG (seed 42 inside journeyGenerator).
    const customsRand = ShipmentEvents.lcg(42);
    const pickCustoms = (): 'held' | 'cleared' | 'inspection' =>
      CUSTOMS_STATUSES[Math.floor(customsRand() * CUSTOMS_STATUSES.length)] ?? 'held';

    // ── Build per-type sub-iterators ──────────────────────────────────────────
    // Each slot holds the state for one config entry. journeyIter is a fresh
    // independent journeyGenerator() per type so journey-LCG state is not shared
    // across types. candidateBuffer holds the remaining scans of the current
    // journey being drained for this type.
    interface TypeSlot {
      readonly entryIdx: number;
      readonly eventType: EventTypeConfig[number]['eventType'];
      readonly terminalOnly: boolean;
      remaining: number;
      accumulator: number;
      journeyIter: Iterator<RawShipmentEvent[]>;
      candidateBuffer: RawShipmentEvent[];
    }

    const totalCount = config.reduce((s, e) => s + e.count, 0);
    if (totalCount <= 0) return;

    const activeSlots: TypeSlot[] = [];
    for (let i = 0; i < config.length; i++) {
      const entry = config[i];
      if (entry === undefined || entry.count <= 0) continue;
      activeSlots.push({
        entryIdx:       i,
        eventType:      entry.eventType,
        terminalOnly:   entry.eventType === 'delivery-confirmation',
        remaining:      entry.count,
        accumulator:    0,
        journeyIter:    ShipmentEvents.journeyGenerator(),
        candidateBuffer: [],
      });
    }

    if (activeSlots.length === 0) return;

    // ── Fractional accumulator scheduler ─────────────────────────────────────
    // step() advances all accumulators by their weight (entry.count / totalCount),
    // then returns the index into activeSlots of the winner (highest accumulator,
    // ties broken by slot order). The winner's accumulator is decremented by 1.0.
    const weights: number[] = activeSlots.map((s) => {
      const entry = config[s.entryIdx];
      return entry !== undefined ? entry.count / totalCount : 0;
    });

    const stepWinner = (): number => {
      for (let i = 0; i < activeSlots.length; i++) {
        const slot = activeSlots[i];
        const w = weights[i];
        if (slot !== undefined && w !== undefined) slot.accumulator += w;
      }
      let best = 0;
      for (let i = 1; i < activeSlots.length; i++) {
        const slotI = activeSlots[i];
        const slotBest = activeSlots[best];
        if (slotI !== undefined && slotBest !== undefined && slotI.accumulator > slotBest.accumulator) best = i;
      }
      const winner = activeSlots[best];
      if (winner !== undefined) winner.accumulator -= 1.0;
      return best;
    };

    // ── Emit loop ─────────────────────────────────────────────────────────────
    // Drain activeSlots until all types are exhausted. After each yield the slot
    // remains active (accumulator keeps accumulating); when remaining hits 0 the
    // slot is spliced out and its weight rebalanced across the survivors.
    while (activeSlots.length > 0) {
      const winnerIdx = stepWinner();
      const slot = activeSlots[winnerIdx];
      if (slot === undefined) break;

      // Fill candidate buffer for this type if it is empty.
      while (slot.candidateBuffer.length === 0 && slot.remaining > 0) {
        const step = slot.journeyIter.next();
        if (step.done === true) break;
        const journey = step.value;
        const lastScan = journey[journey.length - 1];
        const candidates: RawShipmentEvent[] = slot.terminalOnly
          ? (lastScan !== undefined ? [lastScan] : [])
          : journey.length > 1
            ? journey.slice(0, -1)
            : journey;
        for (const c of candidates) slot.candidateBuffer.push(c);
      }

      if (slot.candidateBuffer.length === 0) {
        // This type has no more scans — remove it from active set.
        activeSlots.splice(winnerIdx, 1);
        weights.splice(winnerIdx, 1);
        continue;
      }

      const scan = slot.candidateBuffer.shift();
      if (scan === undefined) continue;

      // Materialise the typed scan with per-type fields.
      const handler = ShipmentEvents.typedScanDispatch[slot.eventType] ?? (({ scan: s }) => ({ ...s, 'eventType': 'position-ping' as const }));
      const typed: TypedScan = handler({ scan, pickCustoms });

      // Apply geo signal overrides per event type (spread to preserve immutability).
      let geoTyped: TypedScan = typed;
      if (slot.eventType === 'position-ping') {
        geoTyped = { ...typed, 'ipAddress': '' };
      } else if (slot.eventType === 'customs-event') {
        const { country } = CoordTimezoneResolver.resolve(typed.latitude, typed.longitude);
        geoTyped = { ...typed, 'countryCode': country, 'latitude': 0, 'longitude': 0, 'ipAddress': '' };
      } else if (slot.eventType === 'delivery-confirmation') {
        const { country } = CoordTimezoneResolver.resolve(typed.latitude, typed.longitude);
        const locale = CountryLocale.forIso2(country);
        geoTyped = { ...typed, 'localeTag': locale, 'latitude': 0, 'longitude': 0, 'ipAddress': '' };
      }
      // facility-scan and sensor-reading keep both coords and ipAddress unchanged.

      yield geoTyped;
      slot.remaining--;

      if (slot.remaining <= 0) {
        // Type quota exhausted — remove from active set.
        activeSlots.splice(winnerIdx, 1);
        weights.splice(winnerIdx, 1);
      }
    }
  }

  /**
   * Build the deterministic raw scan feed: N journeys, each M~2–5 scans, all
   * scans interleaved by timestamp. This is the single source of truth for the
   * synthetic data; the multi-format `Sources` encode a partition of it.
   *
   * Pulls from journeyGenerator() for the first n journeys, collects all scans,
   * then time-sorts — identical observable behaviour to the original implementation.
   */
  static buildRawScans(n: number): RawShipmentEvent[] {
    const allScans: RawShipmentEvent[] = [];
    let journeyCount = 0;
    for (const journey of ShipmentEvents.journeyGenerator()) {
      for (const scan of journey) {
        allScans.push(scan);
      }
      journeyCount++;
      if (journeyCount >= n) break;
    }

    // Interleave all scans by their UTC epoch (the real feed: many journeys'
    // scans arrive in time order). Stable sort on the parsed epoch.
    allScans.sort((a, b) =>
      TimeNormalizer.toEpochMs(a.rawTimestamp) - TimeNormalizer.toEpochMs(b.rawTimestamp));

    return allScans;
  }
}
// #endregion shipment-events-service

// #region field-mappings-service
/**
 * FieldMappings: per-source field-name → canonical-body-field maps.
 *
 * Each source feed names its columns/keys differently (the heterogeneity the
 * format-specific normalize nodes resolve). A mapping is `{ canonicalBodyField:
 * sourceFieldName }`; each normalize node reads the source record's `sourceFieldName`
 * and writes the value under `canonicalBodyField`. Both the generator (encoding)
 * and the ingest pipeline (decoding) use the SAME mapping, so they cannot drift.
 *
 * The canonical body fields are the union the enrichment needs; a source that
 * does not carry a field simply omits its column (the `coerce-types` node fills
 * the canonical default).
 */
export type FieldMap = Readonly<Record<string, string>>;

const FIELD_MAPPINGS: Readonly<Record<string, FieldMap>> = {
  // JSON API feed (position-pings). RICH: camelCase keys, includes resolved geo.
  'json-position': {
    'shipmentId':       'asset_id',
    'eventId':          'ping_id',
    'scanSeq':          'seq',
    'epochRaw':         'observed_at',
    'dispatchRaw':      'dispatched_at',
    'promisedRaw':      'promised_at',
    'status':           'movement',
    'ipAddress':        'gateway_ip',
    'latitude':         'lat',
    'longitude':        'lon',
    'legFromLat':       'prev_lat',
    'legFromLng':       'prev_lon',
    'originLat':        'origin_lat',
    'originLng':        'origin_lon',
    'destLat':          'dest_lat',
    'destLng':          'dest_lon',
    'carrier':          'carrier',
    'facilityId':       'facility',
    'weight':           'weight',
    'weightUnit':       'weight_unit',
    'lineItems':        'basket',
    'recipientName':    'recipient_name',
    'recipientEmail':   'recipient_email',
    'recipientPhone':   'recipient_phone',
    'recipientAddress': 'recipient_address',
    'recipientCountry': 'recipient_country',
    'marketingConsent': 'consent',
    'lawfulBasis':      'lawful_basis',
    'specialCategory':  'special_category',
    'localeTag':        'locale_tag',
    'countryCode':      'country_code',
    'disruptionReason': 'disruption',
    'geoCountry':       'geo_country',
    'geoContinent':     'geo_continent',
    'geoRegion':        'geo_region',
  },
  // CSV dump (facility-scans). RAW: snake_case headers, raw recipient PII.
  'csv-facility': {
    'shipmentId':       'SHIPMENT_ID',
    'eventId':          'SCAN_ID',
    'scanSeq':          'SEQ',
    'epochRaw':         'SCAN_TS',
    'dispatchRaw':      'DISPATCH_TS',
    'promisedRaw':      'PROMISE_TS',
    'status':           'STATUS',
    'ipAddress':        'GATEWAY_IP',
    'latitude':         'LAT',
    'longitude':        'LNG',
    'legFromLat':       'FROM_LAT',
    'legFromLng':       'FROM_LNG',
    'originLat':        'ORIG_LAT',
    'originLng':        'ORIG_LNG',
    'destLat':          'DEST_LAT',
    'destLng':          'DEST_LNG',
    'carrier':          'CARRIER',
    'facilityId':       'FACILITY',
    'weight':           'WEIGHT',
    'weightUnit':       'WEIGHT_UNIT',
    'lineItems':        'BASKET',
    'recipientName':    'RCPT_NAME',
    'recipientEmail':   'RCPT_EMAIL',
    'recipientPhone':   'RCPT_PHONE',
    'recipientAddress': 'RCPT_ADDR',
    'recipientCountry': 'RCPT_COUNTRY',
    'marketingConsent': 'CONSENT',
    'lawfulBasis':      'LAWFUL_BASIS',
    'specialCategory':  'SPECIAL_CATEGORY',
    'localeTag':        'LOCALE_TAG',
    'countryCode':      'COUNTRY_CODE',
    'disruptionReason': 'DISRUPTION',
  },
  // Gzipped NDJSON (sensor-readings). Cold-chain telemetry + position.
  'ndjson-sensor': {
    'shipmentId':       'sid',
    'eventId':          'rid',
    'scanSeq':          'n',
    'epochRaw':         'ts',
    'dispatchRaw':      'dts',
    'promisedRaw':      'pts',
    'status':           'st',
    'ipAddress':        'gw',
    'latitude':         'la',
    'longitude':        'lo',
    'legFromLat':       'fla',
    'legFromLng':       'flo',
    'originLat':        'ola',
    'originLng':        'olo',
    'destLat':          'dla',
    'destLng':          'dlo',
    'carrier':          'crr',
    'facilityId':       'fac',
    'weight':           'wt',
    'weightUnit':       'wu',
    'lineItems':        'bsk',
    'recipientName':    'rn',
    'recipientEmail':   're',
    'recipientPhone':   'rp',
    'recipientAddress': 'ra',
    'recipientCountry': 'rc',
    'marketingConsent': 'cns',
    'lawfulBasis':      'lb',
    'specialCategory':  'sc',
    'localeTag':        'lt',
    'countryCode':      'cc',
    'disruptionReason': 'dis',
    'tempC':            'temp_c',
    'humidityPct':      'humidity',
    'shockG':           'shock_g',
  },
  // YAML sequence feed (position-pings). RICH: same fields as json-position.
  'yaml-position': {
    'shipmentId':       'asset_id',
    'eventId':          'ping_id',
    'scanSeq':          'seq',
    'epochRaw':         'observed_at',
    'dispatchRaw':      'dispatched_at',
    'promisedRaw':      'promised_at',
    'status':           'movement',
    'ipAddress':        'gateway_ip',
    'latitude':         'lat',
    'longitude':        'lon',
    'legFromLat':       'prev_lat',
    'legFromLng':       'prev_lon',
    'originLat':        'origin_lat',
    'originLng':        'origin_lon',
    'destLat':          'dest_lat',
    'destLng':          'dest_lon',
    'carrier':          'carrier',
    'facilityId':       'facility',
    'weight':           'weight',
    'weightUnit':       'weight_unit',
    'lineItems':        'basket',
    'recipientName':    'recipient_name',
    'recipientEmail':   'recipient_email',
    'recipientPhone':   'recipient_phone',
    'recipientAddress': 'recipient_address',
    'recipientCountry': 'recipient_country',
    'marketingConsent': 'consent',
    'lawfulBasis':      'lawful_basis',
    'specialCategory':  'special_category',
    'localeTag':        'locale_tag',
    'countryCode':      'country_code',
    'disruptionReason': 'disruption',
    'geoCountry':       'geo_country',
    'geoContinent':     'geo_continent',
    'geoRegion':        'geo_region',
  },
};

export class FieldMappings {
  static forKey(mappingKey: string): FieldMap {
    return FIELD_MAPPINGS[mappingKey] ?? FIELD_MAPPINGS['json-position'] ?? {};
  }
}
// #endregion field-mappings-service

// #region sources-service
/**
 * Sources: deterministically encode the raw scan feed into a few heterogeneous
 * on-the-wire source feeds (the multi-format fan-in showcase).
 *
 * The single raw feed (ShipmentEvents.buildRawScans) is partitioned by each
 * scan's assigned SourcePayload `variant`, then each partition is encoded in its
 * source's native format under that source's field-name mapping:
 *   - position-ping        → JSON API array string         (RICH: carries geo)
 *   - facility-scan        → CSV string (header + rows)     (RAW PII)
 *   - sensor-reading       → gzip(NDJSON) bytes, base64'd   (cold-chain)
 *   - customs/delivery     → JSON array string              (customs + POD)
 *
 * Gzip output is base64-encoded so the payload is a JSON-safe string that
 * round-trips through state snapshot/restore; the `decompress` ingest node
 * reverses it (base64 → gunzip → text).
 *
 * Deterministic: a pure function of `n` (the raw feed is seeded; partitioning
 * is by SourcePayload variant; no Date.now/Math.random).
 */
export class Sources {
  /** A CSV cell: quote and escape embedded quotes/commas/newlines. */
  private static csvCell(value: string): string {
    if (/[",\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /** Build the wire record (canonical-field → value) for a scan. */
  private static wireRecord(scan: RawShipmentEvent, withGeo: boolean): Record<string, unknown> {
    const record: Record<string, unknown> = {
      'shipmentId':       scan.shipmentId,
      'eventId':          `${scan.shipmentId}-${scan.scanSeq}`,
      'scanSeq':          scan.scanSeq,
      'epochRaw':         scan.rawTimestamp,
      'dispatchRaw':      scan.rawDispatchAt,
      'promisedRaw':      scan.rawPromisedDeliveryAt,
      'status':           scan.rawStatus,
      'ipAddress':        scan.ipAddress,
      'localeTag':        scan.localeTag,
      'countryCode':      scan.countryCode,
      'latitude':         scan.latitude,
      'longitude':        scan.longitude,
      'legFromLat':       scan.legFromLat,
      'legFromLng':       scan.legFromLng,
      'originLat':        scan.originLat,
      'originLng':        scan.originLng,
      'destLat':          scan.destLat,
      'destLng':          scan.destLng,
      'carrier':          scan.carrier,
      'facilityId':       scan.facilityId,
      'weight':           scan.weight,
      'weightUnit':       scan.weightUnit,
      'lineItems':        JSON.stringify(scan.lineItems),
      'recipientName':    scan.recipientName,
      'recipientEmail':   scan.recipientEmail,
      'recipientPhone':   scan.recipientPhone,
      'recipientAddress': scan.recipientAddress,
      'recipientCountry': scan.recipientCountry,
      'marketingConsent': scan.marketingConsent,
      'lawfulBasis':      scan.lawfulBasis,
      'specialCategory':  scan.specialCategory,
      'disruptionReason': scan.disruptionReason,
    };
    if (withGeo) {
      // RICH source pre-resolves geo via the offline country-coder (sync, universal).
      // No fixture dependency — country-coder is deterministic across environments.
      const cand = OfflineGeoResolver.resolve(scan.latitude, scan.longitude).candidate;
      if (cand.resolved && !cand.water && cand.country.length > 0) {
        record['geoCountry']   = cand.country;
        record['geoContinent'] = cand.continent;
        record['geoRegion']    = cand.region || cand.locality || cand.countryName;
      }
    }
    return record;
  }

  /** Encode an array of wire records as a JSON array string under a mapping. */
  private static encodeJson(records: Array<Record<string, unknown>>, map: FieldMap): string {
    const rows = records.map((rec) => {
      const out: Record<string, unknown> = {};
      for (const [canonical, sourceKey] of Object.entries(map)) {
        if (canonical in rec) out[sourceKey] = rec[canonical];
      }
      return out;
    });
    return JSON.stringify(rows);
  }

  /** Encode wire records as a CSV string (header + rows), values stringified. */
  private static encodeCsv(records: Array<Record<string, unknown>>, map: FieldMap): string {
    const entries = Object.entries(map);
    const header = entries.map(([, sourceKey]) => sourceKey).join(',');
    const lines = records.map((rec) =>
      entries
        .map(([canonical]) => Sources.csvCell(String(rec[canonical] ?? '')))
        .join(','),
    );
    return [header, ...lines].join('\n');
  }

  /**
   * Encode wire records as plain NDJSON (one JSON object per line, no compression).
   * Compression is applied orthogonally by maybeGzip.
   */
  private static encodeNdjson(records: Array<Record<string, unknown>>, map: FieldMap): string {
    return records.map((rec) => {
      const out: Record<string, unknown> = {};
      for (const [canonical, sourceKey] of Object.entries(map)) {
        if (canonical in rec) out[sourceKey] = rec[canonical];
      }
      return JSON.stringify(out);
    }).join('\n');
  }

  /**
   * Encode wire records as a YAML sequence of mappings under the given FieldMap.
   * Source keys (not canonical keys) are used as YAML mapping keys — mirrors the
   * other encoder pattern so map-fields aligns by header NAME, not position.
   */
  private static encodeYaml(records: Array<Record<string, unknown>>, map: FieldMap): string {
    const rows = records.map((rec) => {
      const out: Record<string, unknown> = {};
      for (const [canonical, sourceKey] of Object.entries(map)) {
        if (canonical in rec) out[sourceKey] = rec[canonical];
      }
      return out;
    });
    return yamlStringify(rows);
  }

  /**
   * Apply optional gzip compression. Returns text unchanged for 'none'; for
   * 'gzip' returns base64(gzip(text)) using the Web Streams CompressionStream
   * API (Node 18+ and browser compatible — no Node-only imports).
   */
  static async maybeGzip(text: string, compression: 'none' | 'gzip'): Promise<string> {
    if (compression === 'none') return text;

    const encoded = new TextEncoder().encode(text);
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    const write = writer.write(encoded);
    const close = writer.close();

    const chunks: Uint8Array[] = [];
    const reader = cs.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    await write;
    await close;

    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }

    let binary = '';
    for (let i = 0; i < merged.length; i++) binary += String.fromCharCode(merged[i] ?? 0);
    return btoa(binary);
  }

  /**
   * FNV-1a 32-bit hash of a string → integer.
   * Deterministic, synchronous, no external dep — used for sensor telemetry sharding.
   */
  private static fnv1a(key: string): number {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
      h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
    }
    return h;
  }

  /**
   * Encode a single RawShipmentEvent into a SourcePayload.
   *
   * The payload contains exactly one record encoded in the requested format.
   * For CSV the header row is always included so each payload is self-describing
   * and can be fed directly to the normalize-csv node unchanged.
   *
   * For the CSV path the shuffled-column order (header-alignment proof) is
   * derived deterministically from the FieldMap so it is consistent with the
   * full-batch encoder above.
   *
   * `scanIndex` is the global scan counter used to pick the sensor telemetry
   * shard (fnv1a key) and to form the CSV column shuffle — it must increment
   * monotonically across calls from a single stream so per-record determinism
   * holds across the generator sequence.
   */
  static async buildPayloadFromScan(
    scan: RawShipmentEvent & Partial<{ tempC: number; humidityPct: number; shockG: number; customsStatus: string; delivered: boolean; podSignature: string; deliveredAt: string }>,
    format: 'csv' | 'json' | 'ndjson' | 'yaml',
    compression: 'none' | 'gzip',
    scanIndex: number,
    eventType: CanonicalEventVariant['eventType'],
  ): Promise<SourcePayload> {
    const FORMAT_MAP_KEY: Record<string, string> = {
      'json':   'json-position',
      'csv':    'csv-facility',
      'ndjson': 'ndjson-sensor',
      'yaml':   'yaml-position',
    };

    const mapKey = FORMAT_MAP_KEY[format] ?? 'json-position';
    const map = FieldMappings.forKey(mapKey);
    const eventVariant = eventType;
    const withGeo = format === 'json' || format === 'yaml';

    const rec = Sources.wireRecord(scan, withGeo);

    // Sensor telemetry for ndjson entries or when explicit sensor fields are present.
    if (format === 'ndjson' || scan.tempC !== undefined) {
      if (scan.tempC !== undefined && scan.humidityPct !== undefined && scan.shockG !== undefined) {
        rec['tempC']       = scan.tempC;
        rec['humidityPct'] = scan.humidityPct;
        rec['shockG']      = scan.shockG;
      } else if (format === 'ndjson') {
        const h = Sources.fnv1a(`${scan.shipmentId}:${scan.scanSeq}:sensor`);
        const b0 = (h >>> 24) & 0xff;
        const b1 = (h >>> 16) & 0xff;
        const b2 = (h >>> 8)  & 0xff;
        rec['tempC']       = Math.round((2 + (b0 / 255) * 6) * 10) / 10;
        rec['humidityPct'] = Math.round(40 + (b1 / 255) * 40);
        rec['shockG']      = Math.round((b2 / 255) * 30) / 10;
      }
    }

    // Build augmented map to pass typed extra fields through the encoder.
    // Extra fields use canonical name as the source key (identity mapping).
    const extraEntries: Array<[string, string]> = [];
    if (scan.customsStatus !== undefined) { rec['customsStatus'] = scan.customsStatus; extraEntries.push(['customsStatus', 'customsStatus']); }
    if (scan.delivered !== undefined)     { rec['delivered']     = scan.delivered;     extraEntries.push(['delivered',     'delivered']);     }
    if (scan.podSignature !== undefined)  { rec['podSignature']  = scan.podSignature;  extraEntries.push(['podSignature',  'podSignature']);  }
    if (scan.deliveredAt !== undefined)   { rec['deliveredAt']   = scan.deliveredAt;   extraEntries.push(['deliveredAt',   'deliveredAt']);   }

    const effectiveMap: FieldMap = extraEntries.length > 0
      ? { ...map, ...Object.fromEntries(extraEntries) }
      : map;

    let text: string;
    if (format === 'json') {
      // Single-element JSON array — self-describing for the parseJson node.
      text = Sources.encodeJson([rec], effectiveMap);
    } else if (format === 'yaml') {
      text = Sources.encodeYaml([rec], effectiveMap);
    } else if (format === 'ndjson') {
      text = Sources.encodeNdjson([rec], effectiveMap);
    } else {
      // CSV: header + single data row using the same shuffled column order as the
      // batch encoder so header-alignment remains consistent.
      const entries = Object.entries(effectiveMap).reverse();
      const swapped: Array<[string, string]> = [];
      for (let i = 0; i < entries.length; i += 2) {
        const cur = entries[i];
        const next = entries[i + 1];
        if (cur === undefined) continue;
        if (next !== undefined) {
          swapped.push(next, cur);
        } else {
          swapped.push(cur);
        }
      }
      const shuffledMap: FieldMap = Object.fromEntries(swapped);
      text = Sources.encodeCsv([rec], shuffledMap);
    }

    const payload = await Sources.maybeGzip(text, compression);
    // sourceId encodes format, compression, and the scan's global index so each
    // yielded payload has a distinct ID in the stream.
    const sourceId = `${format}-${compression}-${scanIndex}`;

    return {
      'sourceId':    sourceId,
      'format':      format,
      'compression': compression,
      'mappingKey':  mapKey,
      'eventType':   eventVariant,
      'payload':     payload,
    };
  }

  /**
   * Build source payloads from an EventTypeConfig. Each entry generates exactly
   * entry.count typed scans (via ShipmentEvents.typedScansGenerator), encodes each
   * scan in a format chosen from entry.formatMix by cumulative weight thresholds, and
   * returns one SourcePayload per scan. The eventType on each payload is the
   * entry's authoritative eventType from the EventTypeConfig entry.
   *
   * Format selection is deterministic: weight → proportional threshold; local scan
   * index 0..count-1 maps to a {format, compression} via ascending limit thresholds.
   * The last mix item absorbs the remainder so all count scans are covered.
   */
  static async buildTypedFeed(config: EventTypeConfig): Promise<SourcePayload[]> {
    const results: SourcePayload[] = [];
    let globalIndex = 0;

    for (const entry of config) {
      if (entry.count <= 0) continue;

      // Build per-entry format thresholds from formatMix weights.
      const totalWeight = entry.formatMix.reduce((sum, m) => sum + m.weight, 0);
      const mixThresholds: Array<{ format: 'csv' | 'json' | 'ndjson' | 'yaml'; compression: 'none' | 'gzip'; limit: number }> = [];
      let allocated = 0;
      for (let mi = 0; mi < entry.formatMix.length; mi++) {
        const mix = entry.formatMix[mi];
        if (mix === undefined) continue;
        const isLast = mi === entry.formatMix.length - 1;
        const count = isLast
          ? Math.max(0, entry.count - allocated)
          : totalWeight > 0
            ? Math.round((mix.weight / totalWeight) * entry.count)
            : 0;
        allocated += count;
        if (count > 0) {
          mixThresholds.push({ format: mix.format, compression: mix.compression, limit: allocated });
        }
      }

      // Pull exactly entry.count typed scans from a single-entry config.
      const scansGen = ShipmentEvents.typedScansGenerator([entry]);
      let localIndex = 0;
      for (const scan of scansGen) {
        // Determine format from thresholds.
        let format: 'csv' | 'json' | 'ndjson' | 'yaml' = entry.formatMix[0]?.format ?? 'json';
        let compression: 'none' | 'gzip' = entry.formatMix[0]?.compression ?? 'none';
        for (const threshold of mixThresholds) {
          if (localIndex < threshold.limit) {
            format = threshold.format;
            compression = threshold.compression;
            break;
          }
        }

        const sourceId = `${entry.eventType}-${format}-${compression}-${globalIndex}`;
        const payload = await Sources.buildPayloadFromScan(scan, format, compression, globalIndex, entry.eventType);

        results.push({ ...payload, 'sourceId': sourceId, 'eventType': entry.eventType });

        localIndex++;
        globalIndex++;
      }
    }

    return results;
  }

}
// #endregion sources-service

// #region typed-payload-decoder-service
/**
 * TypedPayloadDecoder: decodes a typed SourcePayload into a canonical-field
 * record suitable for CanonicalEventVariantBuilder.fromSourcePayload.
 *
 * Decode is type-aware: the payload's authoritative eventType determines which
 * identity-mapped extra fields are picked up from the parsed wire record after
 * the FieldMap normalization step. The FieldMap itself is selected by format
 * (matching the encoder's FORMAT_MAP_KEY), and type-owned extra fields injected
 * by the encoder via identity mapping are recovered by checking for their
 * canonical key directly in the parsed record.
 *
 * Coercion mirrors the coerce-types node: numeric fields → number, boolean
 * fields → boolean, epochRaw → epochMs, lineItems string → parsed array.
 */

/** Maps format → the FieldMap key the encoder used. */
const DECODER_FORMAT_MAP_KEY: Readonly<Record<string, string>> = {
  'json':   'json-position',
  'csv':    'csv-facility',
  'ndjson': 'ndjson-sensor',
  'yaml':   'yaml-position',
} as const;

/** Canonical names that the encoder identity-maps as extras per eventType. */
export const IDENTITY_EXTRAS_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  'customs-event':         ['customsStatus'],
  'delivery-confirmation': ['delivered', 'podSignature', 'deliveredAt'],
  'sensor-reading':        ['tempC', 'humidityPct', 'shockG'],
  'position-ping':         [],
  'facility-scan':         [],
} as const;

const DECODER_NUMERIC_FIELDS: readonly string[] = [
  'scanSeq', 'latitude', 'longitude', 'legFromLat', 'legFromLng',
  'originLat', 'originLng', 'destLat', 'destLng', 'weight',
  'tempC', 'humidityPct', 'shockG',
] as const;

const DECODER_BOOLEAN_FIELDS: readonly string[] = [
  'marketingConsent', 'delivered',
] as const;

export class TypedPayloadDecoder {
  /**
   * Select the FieldMap key used by the encoder for the given format.
   * This matches Sources.buildPayloadFromScan's FORMAT_MAP_KEY.
   */
  static mapKeyFor(format: SourcePayload['format']): string {
    return DECODER_FORMAT_MAP_KEY[format] ?? 'json-position';
  }

  /** Gunzip base64-encoded gzip text → plain text string. */
  private static async gunzip(base64: string): Promise<string> {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    const write = writer.write(bytes);
    const close = writer.close();
    const chunks: Uint8Array[] = [];
    const reader = ds.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    await write;
    await close;
    let total = 0;
    for (const c of chunks) total += c.length;
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    return new TextDecoder().decode(merged);
  }

  /** Split one CSV line into cells, honouring double-quoted fields. */
  private static splitCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { current += '"'; i++; }
          else { inQuotes = false; }
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current);
    return cells;
  }

  /** Parse the raw text for the given format into an array of source-keyed records. */
  private static parseText(text: string, format: SourcePayload['format']): Array<Record<string, unknown>> {
    if (format === 'json') {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      const records: Array<Record<string, unknown>> = [];
      for (const row of parsed) {
        if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
          records.push({ ...row });
        }
      }
      return records;
    }
    if (format === 'ndjson') {
      const lines = text.split('\n').filter((l) => l.trim().length > 0);
      const records: Array<Record<string, unknown>> = [];
      for (const line of lines) {
        try {
          const parsed: unknown = JSON.parse(line);
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            records.push({ ...parsed });
          }
        } catch {
          // Skip malformed lines.
        }
      }
      return records;
    }
    if (format === 'csv') {
      const lines = text.split('\n').filter((l) => l.length > 0);
      const headerLine = lines[0];
      if (headerLine === undefined) return [];
      const header = TypedPayloadDecoder.splitCsvLine(headerLine);
      const records: Array<Record<string, unknown>> = [];
      for (let i = 1; i < lines.length; i++) {
        const cells = TypedPayloadDecoder.splitCsvLine(lines[i] ?? '');
        const record: Record<string, unknown> = {};
        for (let c = 0; c < header.length; c++) {
          record[header[c] ?? `col${c}`] = cells[c] ?? '';
        }
        records.push(record);
      }
      return records;
    }
    // yaml
    const parsed: unknown = yamlParse(text);
    if (!Array.isArray(parsed)) return [];
    const records: Array<Record<string, unknown>> = [];
    for (const row of parsed) {
      if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
        records.push({ ...row });
      }
    }
    return records;
  }

  /** Apply FieldMap normalization: source-keyed record → canonical-keyed record. */
  private static applyMap(sourceRecord: Record<string, unknown>, map: FieldMap): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [canonical, sourceKey] of Object.entries(map)) {
      if (sourceKey in sourceRecord) out[canonical] = sourceRecord[sourceKey];
    }
    return out;
  }

  /**
   * Pick up identity-mapped extra fields the encoder injected under their
   * canonical name directly. These are type-owned fields the format's base
   * FieldMap does not cover (e.g. customsStatus on a json-position payload).
   * For ndjson sensor-reading the ndjson-sensor map already decodes the sensor
   * channels (temp_c→tempC etc.), so this step is a no-op for that combo.
   */
  private static pickIdentityExtras(
    sourceRecord: Record<string, unknown>,
    mapped: Record<string, unknown>,
    eventType: SourcePayload['eventType'],
  ): void {
    const extras = IDENTITY_EXTRAS_BY_TYPE[eventType] ?? [];
    for (const canonical of extras) {
      if (!(canonical in mapped) && canonical in sourceRecord) {
        mapped[canonical] = sourceRecord[canonical];
      }
    }
  }

  /** Coerce canonical-keyed record fields to their expected types. */
  private static coerce(rec: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...rec };
    for (const field of DECODER_NUMERIC_FIELDS) {
      if (field in out) {
        const v = out[field];
        if (typeof v === 'number') {
          out[field] = v;
        } else if (typeof v === 'string') {
          const n = Number(v);
          out[field] = isFinite(n) ? n : 0;
        } else {
          out[field] = 0;
        }
      }
    }
    for (const field of DECODER_BOOLEAN_FIELDS) {
      if (field in out) {
        const v = out[field];
        if (typeof v === 'boolean') {
          out[field] = v;
        } else if (typeof v === 'string') {
          out[field] = v === 'true' || v === '1';
        } else {
          out[field] = false;
        }
      }
    }
    if ('epochRaw' in out) {
      out['epochMs'] = TimeNormalizer.toEpochMs(String(out['epochRaw'] ?? ''));
    }
    if ('lineItems' in out && typeof out['lineItems'] === 'string') {
      try {
        out['lineItems'] = JSON.parse(out['lineItems']);
      } catch {
        out['lineItems'] = [];
      }
    }
    return out;
  }

  /**
   * Decode a single SourcePayload into a canonical-field record.
   *
   * Decompresses gzip if needed, parses the format, applies the format-driven
   * FieldMap, picks up identity-mapped extras the encoder injected for the
   * payload's authoritative eventType, then coerces types. Returns the first
   * decoded record (typed payloads carry exactly one scan per payload).
   */
  static async decode(payload: SourcePayload): Promise<Record<string, unknown>> {
    const text = payload.compression === 'gzip'
      ? await TypedPayloadDecoder.gunzip(payload.payload)
      : payload.payload;

    const sourceRecords = TypedPayloadDecoder.parseText(text, payload.format);
    const sourceRecord = sourceRecords[0] ?? {};

    const mapKey = TypedPayloadDecoder.mapKeyFor(payload.format);
    const map = FieldMappings.forKey(mapKey);
    const mapped = TypedPayloadDecoder.applyMap(sourceRecord, map);

    TypedPayloadDecoder.pickIdentityExtras(sourceRecord, mapped, payload.eventType);

    return TypedPayloadDecoder.coerce(mapped);
  }
}
// #endregion typed-payload-decoder-service
