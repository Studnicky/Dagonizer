/**
 * Unit tests for CartographerPresentation.
 *
 * CartographerPresentation.of() projects CartographerState down to the
 * bounded browser-facing read surface (plans/streaming-wire-state-audit.md
 * §5.4/§6.C). Tests assert:
 *  - the projection carries exactly the seven target fields with the state's
 *    current values
 *  - the projection is a defensive snapshot: later in-place mutation of the
 *    state's ring buffer / Maps does not leak into an already-taken snapshot
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CartographerState } from '../../CartographerState.ts';
import { CartographerPresentation } from '../../app/CartographerPresentation.ts';
import { ErrorRollup } from '../../errors/ErrorRollup.ts';

describe('CartographerPresentation.of', () => {
  it('projects processedCountExact from state', () => {
    const s = new CartographerState();
    s.processedCountExact = 42;
    const p = CartographerPresentation.of(s);
    assert.equal(p.processedCountExact, 42);
  });

  it('projects sampleRecords/sampleRecordsCursor/sampleRecordsWrapped from state', () => {
    const s = new CartographerState();
    s.sampleRecords = [s.enriched];
    s.sampleRecordsCursor = 3;
    s.sampleRecordsWrapped = true;
    const p = CartographerPresentation.of(s);
    assert.equal(p.sampleRecords.length, 1);
    assert.equal(p.sampleRecordsCursor, 3);
    assert.equal(p.sampleRecordsWrapped, true);
  });

  it('projects insights and journeys from state', () => {
    const s = new CartographerState();
    s.insights.set('Europe', {
      'region': 'Europe', 'country': '', 'hub': '',
      'deliveries': 1, 'exceptions': 0, 'onTimeCount': 1, 'lateCount': 0,
      'totalSubtotalUsdMinor': 100, 'totalShippingUsdMinor': 50, 'totalDistanceKm': 500,
      'totalDelayHours': 0, 'consentValid': 1, 'consentMissing': 0, 'consentExpired': 0,
      'sizeTierEnvelope': 0, 'sizeTierSmall': 1, 'sizeTierMedium': 0, 'sizeTierLarge': 0, 'sizeTierFreight': 0,
      'shipmentCount': 1,
    });
    s.journeys.set('SHP-1', {
      'shipmentId': 'SHP-1', 'scans': [], 'scanCount': 2, 'pathKm': 10,
      'firstEpochMs': 0, 'lastEpochMs': 100, 'elapsedHours': 0.03,
      'timezones': [], 'offsets': [], 'jurisdictions': [], 'statusProgression': [],
      'lastStatus': 'SCAN', 'lastHub': '', 'delivered': false, 'onTime': false, 'delayHours': 0,
      'subtotalUsdMinor': 0, 'shippingUsdMinor': 0,
    });
    const p = CartographerPresentation.of(s);
    assert.equal(p.insights.size, 1);
    assert.equal(p.insights.get('Europe')?.shipmentCount, 1);
    assert.equal(p.journeys.size, 1);
    assert.equal(p.journeys.get('SHP-1')?.scanCount, 2);
  });

  it('projects errorRollup total and groups from state', () => {
    const s = new CartographerState();
    ErrorRollup.fold(s.errorRollup, { 'source': 'gps', 'variant': 'RangeError', 'message': 'bad coords', 'input': '' });
    const p = CartographerPresentation.of(s);
    assert.equal(p.errorRollup.total, 1);
    assert.equal(p.errorRollup.groups.size, 1);
  });

  it('sampleRecords is a snapshot: later state mutation does not leak into an earlier projection', () => {
    const s = new CartographerState();
    s.sampleRecords = [s.enriched];
    const p = CartographerPresentation.of(s);
    s.sampleRecords.push(s.enriched);
    assert.equal(p.sampleRecords.length, 1);
  });

  it('insights is a snapshot: later state mutation does not leak into an earlier projection', () => {
    const s = new CartographerState();
    const p = CartographerPresentation.of(s);
    s.insights.set('Asia', {
      'region': 'Asia', 'country': '', 'hub': '',
      'deliveries': 0, 'exceptions': 0, 'onTimeCount': 0, 'lateCount': 0,
      'totalSubtotalUsdMinor': 0, 'totalShippingUsdMinor': 0, 'totalDistanceKm': 0,
      'totalDelayHours': 0, 'consentValid': 0, 'consentMissing': 0, 'consentExpired': 0,
      'sizeTierEnvelope': 0, 'sizeTierSmall': 0, 'sizeTierMedium': 0, 'sizeTierLarge': 0, 'sizeTierFreight': 0,
      'shipmentCount': 0,
    });
    assert.equal(p.insights.size, 0);
  });

  it('errorRollup.groups is a snapshot: later state mutation does not leak into an earlier projection', () => {
    const s = new CartographerState();
    const p = CartographerPresentation.of(s);
    ErrorRollup.fold(s.errorRollup, { 'source': 'gdpr', 'variant': 'TypeError', 'message': 'x', 'input': '' });
    assert.equal(p.errorRollup.groups.size, 0);
    assert.equal(s.errorRollup.total, 1);
  });
});
