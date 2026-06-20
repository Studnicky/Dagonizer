/**
 * Unit tests for the pure service classes in services.ts.
 *
 * All services are deterministic and stateless — no DAG, no network, no disk.
 * Tests assert behavioral outputs, not internal implementation details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TimeNormalizer,
  TimeZoneResolver,
  Jurisdictions,
  GeoCoarsener,
  GdprRedactor,
  CarrierRegistry,
  CountryCodes,
  Units,
  EventClassifier,
  FxRates,
  PricingCatalog,
  ShippingCalculator,
  EtaEstimator,
  ColdChain,
  Customs,
  Consent,
  Disruptions,
  GeoLookup,
} from '../../services.ts';

// ── TimeNormalizer ─────────────────────────────────────────────────────────────

describe('TimeNormalizer', () => {
  it('parses ISO-8601 with Z suffix', () => {
    const ms = TimeNormalizer.toEpochMs('2026-01-15T08:30:00Z');
    assert.equal(ms, new Date('2026-01-15T08:30:00Z').getTime());
  });

  it('parses MM/DD/YYYY HH:mm format', () => {
    const ms = TimeNormalizer.toEpochMs('01/15/2026 08:30');
    // Should parse as 2026-01-15T08:30:00Z
    assert.ok(Number.isFinite(ms));
    const d = new Date(ms);
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCMonth(), 0); // January
    assert.equal(d.getUTCDate(), 15);
    assert.equal(d.getUTCHours(), 8);
    assert.equal(d.getUTCMinutes(), 30);
  });

  it('parses unix epoch seconds string (10 digits)', () => {
    const ms = TimeNormalizer.toEpochMs('1735990200');
    assert.equal(ms, 1735990200 * 1000);
  });

  it('parses date-only YYYY-MM-DD as midnight UTC', () => {
    const ms = TimeNormalizer.toEpochMs('2026-03-01');
    assert.equal(ms, new Date('2026-03-01T00:00:00Z').getTime());
  });

  it('parses RFC-2822-ish date string', () => {
    const ms = TimeNormalizer.toEpochMs('Wed, 04 Jun 2026 12:30:00 GMT');
    assert.ok(Number.isFinite(ms));
    const d = new Date(ms);
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCMonth(), 5); // June
    assert.equal(d.getUTCDate(), 4);
  });

  it('returns NaN for truly unparseable input', () => {
    const ms = TimeNormalizer.toEpochMs('not-a-date-at-all-xyz');
    assert.ok(Number.isNaN(ms));
  });

  it('toIso round-trips an epoch back to ISO string', () => {
    const epoch = new Date('2026-06-04T00:00:00.000Z').getTime();
    assert.equal(TimeNormalizer.toIso(epoch), '2026-06-04T00:00:00.000Z');
  });
});

// ── TimeZoneResolver ───────────────────────────────────────────────────────────

describe('TimeZoneResolver', () => {
  it('resolves New York coords to US Eastern zone', () => {
    const tz = TimeZoneResolver.zoneFor(40.7, -74.0);
    assert.match(tz, /America\/New_York/);
  });

  it('resolves Tokyo coords to Asia/Tokyo zone', () => {
    const tz = TimeZoneResolver.zoneFor(35.7, 139.7);
    assert.equal(tz, 'Asia/Tokyo');
  });

  it('falls back to UTC for out-of-range coords', () => {
    // tz-lookup throws for coords outside WGS-84; the service catches and returns UTC.
    const tz = TimeZoneResolver.zoneFor(95, 200);
    assert.equal(tz, 'UTC');
  });

  it('localParts returns localIso and utcOffset for a fixed epoch + zone', () => {
    const epoch = new Date('2026-06-04T12:00:00Z').getTime();
    const parts = TimeZoneResolver.localParts(epoch, 'Asia/Tokyo');
    // Tokyo is UTC+9 — local time is 21:00
    assert.match(parts.localIso, /2026-06-04T21:00:00/);
    assert.ok(parts.utcOffset.length > 0);
  });
});

// ── Jurisdictions ──────────────────────────────────────────────────────────────

describe('Jurisdictions', () => {
  it('resolves DE (Germany) to GDPR jurisdiction', () => {
    const j = Jurisdictions.forIso2('DE');
    assert.equal(j.jurisdiction, 'GDPR');
    assert.equal(j.strictness, 'strict');
  });

  it('resolves GB to UK-GDPR jurisdiction', () => {
    const j = Jurisdictions.forIso2('GB');
    assert.equal(j.jurisdiction, 'UK-GDPR');
  });

  it('resolves US to CCPA jurisdiction', () => {
    const j = Jurisdictions.forIso2('US');
    assert.equal(j.jurisdiction, 'CCPA');
  });

  it('resolves BR to LGPD jurisdiction', () => {
    const j = Jurisdictions.forIso2('BR');
    assert.equal(j.jurisdiction, 'LGPD');
  });

  it('resolves JP to APPI jurisdiction', () => {
    const j = Jurisdictions.forIso2('JP');
    assert.equal(j.jurisdiction, 'APPI');
  });

  it('returns baseline for unknown country', () => {
    const j = Jurisdictions.forIso2('ZZ');
    assert.equal(j.jurisdiction, 'baseline');
  });

  it('forCountry accepts ISO-3 codes', () => {
    const j = Jurisdictions.forCountry('DEU');
    assert.equal(j.jurisdiction, 'GDPR');
  });
});

// ── GeoCoarsener ───────────────────────────────────────────────────────────────

describe('GeoCoarsener', () => {
  it('snaps coords to the centre of their 1-degree cell', () => {
    const { lat, lng } = GeoCoarsener.toCentroid(51.509, -0.118);
    // floor(51.509) + 0.5 = 51.5; floor(-0.118) + 0.5 = -0.5 → round to 2dp
    assert.equal(lat, 51.5);
    assert.equal(lng, -0.5);
  });

  it('is idempotent when applied twice to a centroid', () => {
    const first  = GeoCoarsener.toCentroid(48.8, 2.3);
    const second = GeoCoarsener.toCentroid(first.lat, first.lng);
    assert.equal(second.lat, first.lat);
    assert.equal(second.lng, first.lng);
  });

  it('handles negative coordinates', () => {
    const { lat, lng } = GeoCoarsener.toCentroid(-33.86, 151.21);
    assert.equal(lat, -33.5);
    assert.equal(lng, 151.5);
  });
});

// ── GdprRedactor (static pure methods) ────────────────────────────────────────

describe('GdprRedactor', () => {
  it('classify returns the expected PII and sensitive-data field lists', () => {
    const result = GdprRedactor.classify({} as Parameters<typeof GdprRedactor.classify>[0]);
    assert.ok(result.personalDataFields.includes('recipientEmail'));
    assert.ok(result.personalDataFields.includes('scanCoords'));
    assert.ok(result.sensitiveDataFields.includes('recipientCountry'));
  });

  it('hasLawfulBasis returns true when no special category', () => {
    assert.equal(GdprRedactor.hasLawfulBasis('none', 'none'), true);
  });

  it('hasLawfulBasis returns false for special category with no lawful basis', () => {
    assert.equal(GdprRedactor.hasLawfulBasis('none', 'health'), false);
  });

  it('hasLawfulBasis returns true for special category with valid basis', () => {
    assert.equal(GdprRedactor.hasLawfulBasis('consent', 'health'), true);
  });

  it('strictnessFor escalates light jurisdiction to strict when consent missing', () => {
    const s = GdprRedactor.strictnessFor('light', 'missing');
    assert.equal(s, 'strict');
  });

  it('strictnessFor keeps strict jurisdiction strict regardless of consent', () => {
    const s = GdprRedactor.strictnessFor('strict', 'valid');
    assert.equal(s, 'strict');
  });

  it('strictnessFor returns moderate for moderate jurisdiction + valid consent', () => {
    const s = GdprRedactor.strictnessFor('moderate', 'valid');
    assert.equal(s, 'moderate');
  });

  it('mustCoarsenCoords returns true for strict jurisdiction', () => {
    assert.equal(GdprRedactor.mustCoarsenCoords('strict', 'valid'), true);
  });

  it('mustCoarsenCoords returns true when consent expired regardless of regime', () => {
    assert.equal(GdprRedactor.mustCoarsenCoords('light', 'expired'), true);
  });

  it('mustCoarsenCoords returns false for light regime with valid consent', () => {
    assert.equal(GdprRedactor.mustCoarsenCoords('light', 'valid'), false);
  });
});

// ── CarrierRegistry ────────────────────────────────────────────────────────────

describe('CarrierRegistry', () => {
  it('resolves FEDEX to canonical carrierId', () => {
    const result = CarrierRegistry.canonical('FEDEX');
    assert.equal(result.carrierId, 'fedex');
    assert.equal(result.carrierName, 'FedEx');
  });

  it('resolves DHL EXPRESS (mixed case) to dhl', () => {
    const result = CarrierRegistry.canonical('DHL Express');
    assert.equal(result.carrierId, 'dhl');
  });

  it('resolves USPS', () => {
    const result = CarrierRegistry.canonical('USPS');
    assert.equal(result.carrierId, 'usps');
  });

  it('falls back to unknown for unrecognised carrier', () => {
    const result = CarrierRegistry.canonical('AcmeCourier');
    assert.equal(result.carrierId, 'unknown');
    assert.equal(result.carrierName, 'AcmeCourier');
  });

  it('trims whitespace before lookup', () => {
    const result = CarrierRegistry.canonical('  UPS  ');
    assert.equal(result.carrierId, 'ups');
  });
});

// ── CountryCodes ───────────────────────────────────────────────────────────────

describe('CountryCodes', () => {
  it('converts alpha-2 US to USA', () => {
    assert.equal(CountryCodes.toIso3('US'), 'USA');
  });

  it('converts alpha-2 DE to DEU', () => {
    assert.equal(CountryCodes.toIso3('DE'), 'DEU');
  });

  it('converts full name to ISO-3', () => {
    assert.equal(CountryCodes.toIso3('Germany'), 'DEU');
  });

  it('passes through an already ISO-3 code that is known', () => {
    // DEU maps to DEU via the map
    const result = CountryCodes.toIso3('DEU');
    assert.equal(result, 'DEU');
  });
});

// ── Units ──────────────────────────────────────────────────────────────────────

describe('Units', () => {
  it('converts kg to grams', () => {
    assert.equal(Units.toGrams(1, 'kg'), 1000);
  });

  it('converts lb to grams (453.592 per lb)', () => {
    const g = Units.toGrams(1, 'lb');
    assert.ok(Math.abs(g - 453.592) < 0.001);
  });

  it('converts oz to grams', () => {
    const g = Units.toGrams(16, 'oz');
    assert.ok(Math.abs(g - 16 * 28.3495) < 0.001);
  });

  it('passes through grams unchanged', () => {
    assert.equal(Units.toGrams(500, 'g'), 500);
  });

  it('passes through unknown unit value unchanged', () => {
    assert.equal(Units.toGrams(100, 'unknown'), 100);
  });
});

// ── EventClassifier ────────────────────────────────────────────────────────────

describe('EventClassifier', () => {
  it('classifies "out for delivery" as OUT_FOR_DELIVERY (before DELIVERED match)', () => {
    assert.equal(EventClassifier.eventType('out for delivery'), 'OUT_FOR_DELIVERY');
  });

  it('classifies "delivered" as DELIVERED', () => {
    assert.equal(EventClassifier.eventType('delivered'), 'DELIVERED');
  });

  it('classifies "exception - address" as EXCEPTION', () => {
    assert.equal(EventClassifier.eventType('exception - address'), 'EXCEPTION');
  });

  it('classifies "arrival scan" as ARRIVAL', () => {
    assert.equal(EventClassifier.eventType('arrival scan'), 'ARRIVAL');
  });

  it('classifies "departed facility" as DEPARTURE', () => {
    assert.equal(EventClassifier.eventType('departed facility'), 'DEPARTURE');
  });

  it('classifies "in transit" as SCAN', () => {
    assert.equal(EventClassifier.eventType('in transit'), 'SCAN');
  });

  it('defaults to SCAN for unrecognised status', () => {
    assert.equal(EventClassifier.eventType('unknown-foobar'), 'SCAN');
  });

  it('serviceTier returns express for FedEx with light parcel', () => {
    assert.equal(EventClassifier.serviceTier('fedex', 4000), 'express');
  });

  it('serviceTier returns standard for FedEx with heavy parcel', () => {
    assert.equal(EventClassifier.serviceTier('fedex', 6000), 'standard');
  });

  it('serviceTier returns economy for USPS heavy parcel', () => {
    assert.equal(EventClassifier.serviceTier('usps', 1000), 'economy');
  });

  it('sizeTier returns envelope below 50g', () => {
    assert.equal(EventClassifier.sizeTier(49), 'envelope');
  });

  it('sizeTier returns small for 50–499g', () => {
    assert.equal(EventClassifier.sizeTier(499), 'small');
  });

  it('sizeTier returns medium for 500–4999g', () => {
    assert.equal(EventClassifier.sizeTier(4999), 'medium');
  });

  it('sizeTier returns large for 5000–29999g', () => {
    assert.equal(EventClassifier.sizeTier(29999), 'large');
  });

  it('sizeTier returns freight for 30000g+', () => {
    assert.equal(EventClassifier.sizeTier(30000), 'freight');
  });
});

// ── FxRates ────────────────────────────────────────────────────────────────────

describe('FxRates', () => {
  it('returns 1.0 for USD (no conversion needed)', () => {
    assert.equal(FxRates.rate('USD'), 1.0);
  });

  it('returns 1.0 for unknown currency (fallback)', () => {
    assert.equal(FxRates.rate('ZZZ'), 1.0);
  });

  it('toUsdMinor converts EUR minor units to USD minor units', () => {
    const rate = FxRates.rate('EUR');
    const result = FxRates.toUsdMinor(100, 'EUR');
    assert.equal(result, Math.round(100 * rate));
  });

  it('toUsdMinor rounds fractional results', () => {
    // Result must be an integer
    const result = FxRates.toUsdMinor(1, 'EUR');
    assert.equal(result, Math.floor(result)); // integer check
  });
});

// ── PricingCatalog ─────────────────────────────────────────────────────────────

describe('PricingCatalog', () => {
  it('priceFor returns zero-cost Unknown Product for unknown productId', () => {
    const p = PricingCatalog.priceFor('DOES-NOT-EXIST');
    assert.equal(p.name, 'Unknown Product');
    assert.equal(p.unitPriceMinor, 0);
  });

  it('catalogIds returns a non-empty array of known product IDs', () => {
    const ids = PricingCatalog.catalogIds();
    assert.ok(ids.length > 0);
    // Each ID should be a non-empty string
    for (const id of ids) {
      assert.equal(typeof id, 'string');
      assert.ok(id.length > 0);
    }
  });

  it('order with a known product returns a positive subtotal', () => {
    const ids = PricingCatalog.catalogIds();
    const firstId = ids[0];
    if (firstId === undefined) throw new Error('No catalog products available');

    const result = PricingCatalog.order([{ 'productId': firstId, 'quantity': 2 }]);
    assert.ok(result.subtotalMinor >= 0);
    assert.ok(result.lines.length === 1);
    assert.equal(result.lines[0]?.quantity, 2);
  });

  it('order with unknown product returns subtotal 0 and pipeline continues', () => {
    const result = PricingCatalog.order([{ 'productId': 'UNKNOWN', 'quantity': 1 }]);
    assert.equal(result.subtotalMinor, 0);
    assert.equal(result.subtotalUsdMinor, 0);
  });

  it('order with multiple line items sums them all', () => {
    const ids = PricingCatalog.catalogIds();
    const a = ids[0];
    const b = ids[1];
    if (a === undefined || b === undefined) throw new Error('Not enough catalog entries');

    const single = PricingCatalog.order([{ 'productId': a, 'quantity': 1 }]);
    const multi  = PricingCatalog.order([{ 'productId': a, 'quantity': 1 }, { 'productId': b, 'quantity': 1 }]);
    // Multi must have at least as large a subtotal (b may be USD 0 but that's still >=)
    assert.ok(multi.subtotalUsdMinor >= single.subtotalUsdMinor);
  });
});

// ── ShippingCalculator ─────────────────────────────────────────────────────────

describe('ShippingCalculator', () => {
  it('distance between same coords is the minimum (1 km)', () => {
    const d = ShippingCalculator.distanceKm(51.5, -0.1, 51.5, -0.1);
    assert.equal(d, 1); // minimum clamp
  });

  it('distance London → Tokyo is approximately 9600 km', () => {
    const d = ShippingCalculator.distanceKm(51.5, -0.1, 35.7, 139.7);
    assert.ok(d > 9000 && d < 10000, `Expected ~9600, got ${d}`);
  });

  it('distance is symmetric', () => {
    const ab = ShippingCalculator.distanceKm(40.7, -74.0, 51.5, -0.1);
    const ba = ShippingCalculator.distanceKm(51.5, -0.1, 40.7, -74.0);
    assert.ok(Math.abs(ab - ba) < 0.01);
  });

  it('quote returns a ShippingQuote with positive costUsdMinor for known carrier', () => {
    const q = ShippingCalculator.quote(1000, 2000, 'standard', 'ups');
    assert.ok(q.costUsdMinor > 0);
    assert.equal(q.distanceKm, 1000);
    assert.ok(q.breakdown.baseMinor >= 0);
    assert.ok(q.breakdown.perKmMinor >= 0);
    assert.ok(q.breakdown.tierMultiplier > 0);
  });

  it('express tier costs more than economy for the same route', () => {
    const express = ShippingCalculator.quote(500, 1000, 'express', 'ups');
    const economy = ShippingCalculator.quote(500, 1000, 'economy', 'ups');
    assert.ok(express.costUsdMinor >= economy.costUsdMinor);
  });

  it('quote falls back to a default rate for unknown carrier', () => {
    // Unknown carriers should still return a quote (not throw)
    const q = ShippingCalculator.quote(100, 500, 'standard', 'non-existent-carrier');
    assert.ok(q.costUsdMinor > 0);
  });
});

// ── EtaEstimator ──────────────────────────────────────────────────────────────

describe('EtaEstimator', () => {
  it('transitHours is positive for any valid distance + carrier', () => {
    const h = EtaEstimator.transitHours(1000, 'ups', 'standard');
    assert.ok(h > 0);
  });

  it('express tier produces shorter transit than economy for same route', () => {
    const express = EtaEstimator.transitHours(1000, 'ups', 'express');
    const economy = EtaEstimator.transitHours(1000, 'ups', 'economy');
    assert.ok(express < economy);
  });

  it('estimate returns onTime true when ETA is before promised date', () => {
    const dispatch = new Date('2026-01-01T00:00:00Z').getTime();
    const promised = dispatch + 10 * 24 * 3_600_000; // 10 days away
    const estimate = EtaEstimator.estimate(100, 'ups', 'standard', dispatch, promised, 0);
    assert.equal(estimate.onTime, true);
    assert.equal(estimate.delayHours, 0);
  });

  it('estimate returns onTime false and delayHours > 0 when disrupted past promise', () => {
    const dispatch = new Date('2026-01-01T00:00:00Z').getTime();
    const promised = dispatch + 2 * 3_600_000; // only 2 hours slack — guaranteed late with disruption
    const estimate = EtaEstimator.estimate(5000, 'ups', 'economy', dispatch, promised, 96);
    assert.equal(estimate.onTime, false);
    assert.ok(estimate.delayHours > 0);
  });

  it('delayHours is always non-negative', () => {
    const dispatch = new Date('2026-01-01T00:00:00Z').getTime();
    const promised = dispatch + 10 * 24 * 3_600_000;
    const estimate = EtaEstimator.estimate(100, 'ups', 'express', dispatch, promised, 0);
    assert.ok(estimate.delayHours >= 0);
  });

  it('etaIso is a valid ISO string', () => {
    const dispatch = new Date('2026-01-01T00:00:00Z').getTime();
    const promised = dispatch + 48 * 3_600_000;
    const estimate = EtaEstimator.estimate(200, 'fedex', 'express', dispatch, promised, 0);
    assert.ok(estimate.etaIso.includes('T'));
    assert.ok(!Number.isNaN(new Date(estimate.etaIso).getTime()));
  });
});

// ── ColdChain ─────────────────────────────────────────────────────────────────

describe('ColdChain', () => {
  it('breached returns false for in-range temp and safe shock', () => {
    assert.equal(ColdChain.breached(5, 1.0), false);
  });

  it('breached returns true for temp below minimum (2°C)', () => {
    assert.equal(ColdChain.breached(1.9, 0), true);
  });

  it('breached returns true for temp above maximum (8°C)', () => {
    assert.equal(ColdChain.breached(8.1, 0), true);
  });

  it('breached returns true for shock exceeding 2.5g', () => {
    assert.equal(ColdChain.breached(5, 2.6), true);
  });

  it('breached returns false at boundary (2°C, 2.5g)', () => {
    // Boundaries are inclusive for min/max temp; shock > 2.5 only
    assert.equal(ColdChain.breached(2, 2.5), false);
    assert.equal(ColdChain.breached(8, 2.5), false);
  });
});

// ── Customs ───────────────────────────────────────────────────────────────────

describe('Customs', () => {
  it('dwellHours for held shipment is 18', () => {
    assert.equal(Customs.dwellHours('held'), 18);
  });

  it('dwellHours for cleared shipment is 2', () => {
    assert.equal(Customs.dwellHours('cleared'), 2);
  });

  it('dwellHours defaults to 4 for unknown status', () => {
    assert.equal(Customs.dwellHours('inspection'), 4);
    assert.equal(Customs.dwellHours(''), 4);
  });
});

// ── Consent ───────────────────────────────────────────────────────────────────

describe('Consent', () => {
  it('returns missing when marketingConsent is false', () => {
    assert.equal(Consent.statusFor('SHP-001', false), 'missing');
  });

  it('returns valid for consented shipment not at the expired slice', () => {
    // SHP-001 → index 1, 1 % 10 !== 0 → valid
    assert.equal(Consent.statusFor('SHP-001', true), 'valid');
  });

  it('returns expired for the 10% slice (index % 10 === 0)', () => {
    // SHP-010 → index 10, 10 % 10 === 0 → expired
    assert.equal(Consent.statusFor('SHP-010', true), 'expired');
    assert.equal(Consent.statusFor('SHP-000', true), 'expired');
  });

  it('returns valid for non-multiples-of-10', () => {
    assert.equal(Consent.statusFor('SHP-011', true), 'valid');
    assert.equal(Consent.statusFor('SHP-099', true), 'valid');
  });
});

// ── Disruptions ───────────────────────────────────────────────────────────────

describe('Disruptions', () => {
  it('customs hold adds 18 hours', () => {
    assert.equal(Disruptions.hoursFor('customs hold'), 18);
  });

  it('mechanical delay adds 30 hours', () => {
    assert.equal(Disruptions.hoursFor('mechanical delay'), 30);
  });

  it('empty string (no disruption) adds 0 hours', () => {
    assert.equal(Disruptions.hoursFor(''), 0);
  });

  it('unknown reason falls back to 0', () => {
    assert.equal(Disruptions.hoursFor('solar flare'), 0);
  });
});

// ── GeoLookup ─────────────────────────────────────────────────────────────────

describe('GeoLookup', () => {
  it('fromResolved with a land country produces a land GeoContext', () => {
    const ctx = GeoLookup.fromResolved('DE', 'Europe', 'Central Europe', 52.5, 13.4);
    assert.equal(ctx.status, 'land');
    assert.equal(ctx.country, 'DE');
    assert.equal(ctx.continent, 'Europe');
    assert.ok(ctx.timezone.length > 0);
    assert.notEqual(ctx.jurisdiction, 'international-waters');
  });

  it('fromResolved with INTL country produces maritime context', () => {
    const ctx = GeoLookup.fromResolved('INTL', 'International Waters / Maritime', 'Atlantic', 20.0, -30.0);
    assert.equal(ctx.status, 'water');
    assert.equal(ctx.jurisdiction, 'international-waters');
    assert.equal(ctx.country, 'INTL');
  });

  it('fromResolved with empty country also produces maritime context', () => {
    const ctx = GeoLookup.fromResolved('', '', '', 0.0, 0.0);
    assert.equal(ctx.jurisdiction, 'international-waters');
  });

  it('derives jurisdiction for UK (GB ISO-2) as UK-GDPR', () => {
    const ctx = GeoLookup.fromResolved('GB', 'Europe', 'Western Europe', 51.5, -0.1);
    assert.equal(ctx.jurisdiction, 'UK-GDPR');
  });
});
