/**
 * Unit tests for SignalWeight and ScoreSignalsNode (score-signals).
 *
 * Verifies:
 *  - SignalWeight.for returns exact values and ordering holds
 *  - ScoreSignalsNode emits the right descriptors for various body shapes
 *  - Invalid coords (0,0 or out-of-bounds) produce no coords descriptor
 *  - Unparseable phone produces no phone descriptor; parseable US phone does
 *  - All-empty body emits an empty geoSignals array
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { Batch } from '@studnicky/dagonizer';
import type { MonadicNode, NodeContextType } from '@studnicky/dagonizer';
import { CartographerState } from '../../CartographerState.ts';
import { CanonicalEventVariantBuilder } from '../../entities/CanonicalEvent.ts';
import { SignalWeight } from '../../entities/SignalWeight.ts';
import { ScoreSignalsNode } from '../../nodes/geo/scoreSignals.ts';

// ── helpers ────────────────────────────────────────────────────────────────────

/** Builds a CartographerState with a position-ping canonical event. */
class CartographerStateFixture {
  static with(bodyOverride: Partial<{
    latitude:    number;
    longitude:   number;
    ipAddress:   string;
    localeTag:   string;
    countryCode: string;
    address:     string;
    phone:       string;
  }>): CartographerState {
    const state = new CartographerState();
    // CanonicalEventVariantBuilder.from merges partial over the full default body,
    // so passing the geo-signal fields here is sufficient; all other body fields
    // keep their zero-value defaults.
    state.canonical = CanonicalEventVariantBuilder.from({
      'body': {
        'scanSeq':      0,
        'latitude':     bodyOverride.latitude    ?? 0,
        'longitude':    bodyOverride.longitude   ?? 0,
        'ipAddress':    bodyOverride.ipAddress   ?? '',
        'localeTag':    bodyOverride.localeTag   ?? '',
        'countryCode':  bodyOverride.countryCode ?? '',
        'legFromLat':   0,
        'legFromLng':   0,
        'originLat':    0,
        'originLng':    0,
        'destLat':      0,
        'destLng':      0,
        'carrier':      '',
        'status':       '',
        'rawTimestamp': '',
        'address':      bodyOverride.address ?? '',
        'phone':        bodyOverride.phone   ?? '',
      },
    });
    return state;
  }
}

const CTX: NodeContextType = {
  'dagName': 'test',
  'nodeName': 'score-signals',
  'signal': new AbortController().signal,
  'validateOutputs': false,
  'outputSchemaValidator': null,
};

async function executeSingle<TOutput extends string>(
  node: MonadicNode<CartographerState, TOutput>,
  state: CartographerState,
): Promise<TOutput> {
  const routed = await node.execute(Batch.of(state), CTX);
  for (const [output, batch] of routed) {
    if (batch.size > 0) return output;
  }
  throw new Error(`Node ${node.name} did not route the test item`);
}

// ── SignalWeight.for ───────────────────────────────────────────────────────────

describe('SignalWeight.for', () => {
  it('returns 1.0 for coords', () => {
    assert.equal(SignalWeight.for('coords'), 1.0);
  });

  it('returns 0.8 for address', () => {
    assert.equal(SignalWeight.for('address'), 0.8);
  });

  it('returns 0.55 for ip', () => {
    assert.equal(SignalWeight.for('ip'), 0.55);
  });

  it('returns 0.35 for code', () => {
    assert.equal(SignalWeight.for('code'), 0.35);
  });

  it('returns 0.30 for phone', () => {
    assert.equal(SignalWeight.for('phone'), 0.30);
  });

  it('returns 0.2 for locale', () => {
    assert.equal(SignalWeight.for('locale'), 0.2);
  });

  it('ordering: coords > address > ip > code > phone > locale', () => {
    assert.ok(SignalWeight.for('coords')  > SignalWeight.for('address'), 'coords > address');
    assert.ok(SignalWeight.for('address') > SignalWeight.for('ip'),      'address > ip');
    assert.ok(SignalWeight.for('ip')      > SignalWeight.for('code'),    'ip > code');
    assert.ok(SignalWeight.for('code')    > SignalWeight.for('phone'),   'code > phone');
    assert.ok(SignalWeight.for('phone')   > SignalWeight.for('locale'),  'phone > locale');
  });

  it('COMPOSITE_CODE_LOCALE is 0.45', () => {
    assert.equal(SignalWeight.COMPOSITE_CODE_LOCALE, 0.45);
  });
});

// ── ScoreSignalsNode ──────────────────────────────────────────────────────────

describe('ScoreSignalsNode', () => {
  const node = new ScoreSignalsNode();

  describe('valid coords + ip + locale body', () => {
    let state: CartographerState;

    before(async () => {
      state = CartographerStateFixture.with({
        'latitude':  51.5074,
        'longitude': -0.1278,
        'ipAddress': '203.0.113.42',
        'localeTag': 'en-GB',
      });
      await executeSingle(node, state);
    });

    it('emits 3 descriptors', () => {
      assert.equal(state.geoSignals.length, 3);
    });

    it('emitted kinds are coords, ip, locale (in that order)', () => {
      const kinds = state.geoSignals.map((d) => d.kind);
      assert.deepEqual(kinds, ['coords', 'ip', 'locale']);
    });

    it('coords descriptor carries the correct weight', () => {
      const coords = state.geoSignals.find((d) => d.kind === 'coords');
      assert.ok(coords !== undefined);
      assert.equal(coords.weight, SignalWeight.for('coords'));
    });

    it('ip descriptor carries the correct weight', () => {
      const ip = state.geoSignals.find((d) => d.kind === 'ip');
      assert.ok(ip !== undefined);
      assert.equal(ip.weight, SignalWeight.for('ip'));
    });

    it('locale descriptor carries the correct weight', () => {
      const locale = state.geoSignals.find((d) => d.kind === 'locale');
      assert.ok(locale !== undefined);
      assert.equal(locale.weight, SignalWeight.for('locale'));
    });
  });

  describe('coords at (0, 0) are excluded', () => {
    let state: CartographerState;

    before(async () => {
      state = CartographerStateFixture.with({ 'latitude': 0, 'longitude': 0 });
      await executeSingle(node, state);
    });

    it('emits no coords descriptor for (0, 0)', () => {
      const hasCoords = state.geoSignals.some((d) => d.kind === 'coords');
      assert.equal(hasCoords, false);
    });
  });

  describe('out-of-bounds lat=200 is excluded', () => {
    let state: CartographerState;

    before(async () => {
      state = CartographerStateFixture.with({ 'latitude': 200, 'longitude': 45 });
      await executeSingle(node, state);
    });

    it('emits no coords descriptor when lat > 90', () => {
      const hasCoords = state.geoSignals.some((d) => d.kind === 'coords');
      assert.equal(hasCoords, false);
    });
  });

  describe('phone with unknown calling code is excluded', () => {
    let state: CartographerState;

    before(async () => {
      // 999 is not in the CallingCode table
      state = CartographerStateFixture.with({ 'phone': '+999-555-0100' });
      await executeSingle(node, state);
    });

    it('emits no phone descriptor for an unrecognised calling code', () => {
      const hasPhone = state.geoSignals.some((d) => d.kind === 'phone');
      assert.equal(hasPhone, false);
    });
  });

  describe('US phone (+1...) emits a phone descriptor', () => {
    let state: CartographerState;

    before(async () => {
      // +1 maps to US in CallingCode
      state = CartographerStateFixture.with({ 'phone': '+12025550142' });
      await executeSingle(node, state);
    });

    it('emits a phone descriptor', () => {
      const phone = state.geoSignals.find((d) => d.kind === 'phone');
      assert.ok(phone !== undefined);
    });

    it('phone descriptor carries the correct weight', () => {
      const phone = state.geoSignals.find((d) => d.kind === 'phone');
      assert.ok(phone !== undefined);
      assert.equal(phone.weight, SignalWeight.for('phone'));
    });
  });

  describe('all-empty body emits no descriptors', () => {
    let state: CartographerState;

    before(async () => {
      state = CartographerStateFixture.with({});
      await executeSingle(node, state);
    });

    it('geoSignals is an empty array', () => {
      assert.deepEqual(state.geoSignals, []);
    });
  });

  describe('all signals present (full body)', () => {
    let state: CartographerState;

    before(async () => {
      state = CartographerStateFixture.with({
        'latitude':    48.8566,
        'longitude':   2.3522,
        'address':     '1 Rue de la Paix, Paris',
        'ipAddress':   '192.0.2.1',
        'countryCode': 'FR',
        'phone':       '+33612345678',
        'localeTag':   'fr-FR',
      });
      await executeSingle(node, state);
    });

    it('emits 6 descriptors (one per modality)', () => {
      assert.equal(state.geoSignals.length, 6);
    });

    it('all six kinds are present', () => {
      const kinds = new Set(state.geoSignals.map((d) => d.kind));
      assert.ok(kinds.has('coords'),  'coords present');
      assert.ok(kinds.has('address'), 'address present');
      assert.ok(kinds.has('ip'),      'ip present');
      assert.ok(kinds.has('code'),    'code present');
      assert.ok(kinds.has('phone'),   'phone present');
      assert.ok(kinds.has('locale'),  'locale present');
    });
  });
});
