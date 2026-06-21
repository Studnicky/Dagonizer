/**
 * Unit tests for CartographerState.
 *
 * CartographerState manages the mutable clipboard threaded through every node.
 * Tests assert:
 *  - clone() produces deep-independent copies (mutations do not alias back)
 *  - defaultRouting() returns the expected all-false shape
 *  - unresolvedCandidate() returns a well-formed GeoCandidate
 *  - the 'variant' discriminant on CanonicalEventVariant is used (not 'kind')
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CartographerState } from '../../CartographerState.ts';
import { CanonicalEventVariantBuilder } from '../../entities/CanonicalEvent.ts';

// ── defaultRouting ─────────────────────────────────────────────────────────────

describe('CartographerState.defaultRouting', () => {
  it('returns a routing object with all boolean flags false', () => {
    const r = CartographerState.defaultRouting();
    assert.equal(r.geoLookupRun,      false);
    assert.equal(r.geoLookupSkipped,  false);
    assert.equal(r.reverseGeocodeRun, false);
    assert.equal(r.ipGeolocateRun,    false);
    assert.equal(r.ipGeolocateSkipped, false);
    assert.equal(r.redactionRun,      false);
    assert.equal(r.redactionSkipped,  false);
    assert.equal(r.pricingRun,        false);
    assert.equal(r.pricingSkipped,    false);
    assert.equal(r.etaRun,            false);
    assert.equal(r.etaSkipped,        false);
    assert.equal(r.coldChainRun,      false);
    assert.equal(r.customsDwellRun,   false);
  });

  it('returns geoConfidence 0 and empty geoModalities array', () => {
    const r = CartographerState.defaultRouting();
    assert.equal(r.geoConfidence, 0);
    assert.deepEqual(r.geoModalities, []);
  });

  it('returns path "order" as default', () => {
    const r = CartographerState.defaultRouting();
    assert.equal(r.path, 'order');
  });
});

// ── unresolvedCandidate ────────────────────────────────────────────────────────

describe('CartographerState.unresolvedCandidate', () => {
  it('returns a GeoCandidate with resolved false for gps modality', () => {
    const c = CartographerState.unresolvedCandidate('gps');
    assert.equal(c.modality, 'gps');
    assert.equal(c.resolved, false);
    assert.equal(c.country, '');
    assert.equal(c.lat, 0);
    assert.equal(c.lng, 0);
    assert.equal(c.water, false);
  });

  it('returns a GeoCandidate with resolved false for ip modality', () => {
    const c = CartographerState.unresolvedCandidate('ip');
    assert.equal(c.modality, 'ip');
    assert.equal(c.resolved, false);
  });
});

// ── CartographerState.clone ────────────────────────────────────────────────────

describe('CartographerState#clone', () => {
  it('produces a different object instance', () => {
    const s = new CartographerState();
    const c = s.clone();
    assert.ok(c !== s);
  });

  it('copies eventCount to clone', () => {
    const s = new CartographerState();
    s.eventCount = 77;
    const c = s.clone();
    assert.equal(c.eventCount, 77);
  });

  it('mutating clone.eventCount does not affect original', () => {
    const s = new CartographerState();
    s.eventCount = 10;
    const c = s.clone();
    c.eventCount = 99;
    assert.equal(s.eventCount, 10);
  });

  it('clone.sources array is a separate array (not shared reference)', () => {
    const s = new CartographerState();
    s.sources = [
      { 'sourceId': 'a', 'format': 'json', 'compression': 'none', 'mappingKey': 'k', 'eventType': 'position-ping', 'payload': '' },
    ];
    const c = s.clone();
    assert.ok(Array.isArray(c.sources), 'clone.sources should be an array');
    assert.ok(Array.isArray(s.sources), 's.sources should be an array');
    c.sources.push({ 'sourceId': 'b', 'format': 'json', 'compression': 'none', 'mappingKey': 'k', 'eventType': 'position-ping', 'payload': '' });
    assert.equal(s.sources.length, 1);
  });

  it('clone.raw lineItems are a separate array', () => {
    const s = new CartographerState();
    s.raw.lineItems = [{ 'productId': 'P1', 'quantity': 1 }, { 'productId': 'P2', 'quantity': 2 }];
    const c = s.clone();
    c.raw.lineItems[0]!.productId = 'MUTATED';
    assert.equal(s.raw.lineItems[0]?.productId, 'P1');
  });

  it('clone.normalized lineItems are a separate array', () => {
    const s = new CartographerState();
    s.normalized.lineItems = [{ 'productId': 'P3', 'quantity': 3 }];
    const c = s.clone();
    c.normalized.lineItems[0]!.productId = 'MUTATED';
    assert.equal(s.normalized.lineItems[0]?.productId, 'P3');
  });

  it('clone.geoContext.countries is a separate array', () => {
    const s = new CartographerState();
    s.geoContext.countries = ['DE', 'FR'];
    const c = s.clone();
    c.geoContext.countries.push('GB');
    assert.equal(s.geoContext.countries.length, 2);
  });

  it('parent scatter accumulators are reset to defaults in the clone', () => {
    const s = new CartographerState();
    s.records = [s.enriched];
    s.insights.set('Europe', {
      'region': 'Europe', 'country': '', 'hub': '',
      'deliveries': 1, 'exceptions': 0, 'onTimeCount': 1, 'lateCount': 0,
      'totalSubtotalUsdMinor': 100, 'totalShippingUsdMinor': 50, 'totalDistanceKm': 500,
      'totalDelayHours': 0, 'consentValid': 1, 'consentMissing': 0, 'consentExpired': 0,
      'sizeTierEnvelope': 0, 'sizeTierSmall': 1, 'sizeTierMedium': 0, 'sizeTierLarge': 0, 'sizeTierFreight': 0,
      'shipmentCount': 1,
    });
    const c = s.clone();
    // Child clones should not carry parent accumulators (memory optimisation documented in CartographerState.clone)
    assert.equal(c.records.length, 0);
    assert.equal(c.insights.size, 0);
  });

  it('clone.routing.geoModalities is a separate array', () => {
    const s = new CartographerState();
    s.routing = { ...CartographerState.defaultRouting(), 'geoModalities': ['gps', 'ip'] };
    const c = s.clone();
    c.routing.geoModalities.push('cell');
    assert.equal(s.routing.geoModalities.length, 2);
  });

  it('clone.gdprResult.personalDataFields is a separate array', () => {
    const s = new CartographerState();
    s.gdprResult.personalDataFields = ['recipientName', 'recipientEmail'];
    const c = s.clone();
    c.gdprResult.personalDataFields.push('phone');
    assert.equal(s.gdprResult.personalDataFields.length, 2);
  });
});

// ── CanonicalEventVariantBuilder ───────────────────────────────────────────────

describe('CanonicalEventVariantBuilder', () => {
  it('from empty partial produces a position-ping variant with eventType discriminant', () => {
    const v = CanonicalEventVariantBuilder.from({});
    assert.equal(v.eventType, 'position-ping');
  });

  it('produced variant uses eventType field (not kind)', () => {
    const v = CanonicalEventVariantBuilder.from({});
    // The discriminant field is `eventType` — there must be no `kind` field
    assert.ok(!('kind' in v), 'variant must not have a "kind" field');
    assert.ok('eventType' in v);
  });

  it('from with shipmentId override fills that field', () => {
    const v = CanonicalEventVariantBuilder.from({ 'shipmentId': 'SHP-CUSTOM' });
    assert.equal(v.shipmentId, 'SHP-CUSTOM');
  });

  it('body fields are initialized to safe defaults', () => {
    const v = CanonicalEventVariantBuilder.from({});
    assert.equal(v.body.latitude, 0);
    assert.equal(v.body.longitude, 0);
    assert.equal(v.body.carrier, '');
  });

  it('geo and pii optional fields start absent (undefined)', () => {
    const v = CanonicalEventVariantBuilder.from({});
    // Optional pre-resolved fields are absent on a default-built variant
    assert.equal(v.geo, undefined);
    assert.equal(v.pii, undefined);
    assert.equal(v.consentHandled, undefined);
  });
});
