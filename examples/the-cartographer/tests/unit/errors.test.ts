/**
 * Unit tests for GeoErrorRecord and ErrorRollup.
 *
 * These classes carry exceptions as first-class data through the DAG.
 * Tests assert behavioral outputs of the static methods and verify that:
 *  - the `variant` discriminant (not `kind`) is used in records
 *  - rollup folding is bounded and additive
 *  - truncation limits are enforced
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GeoErrorRecord } from '../../errors/GeoErrorRecord.ts';
import { ErrorRollup } from '../../errors/ErrorRollup.ts';
import type { GeoErrorRecordType } from '../../errors/GeoErrorRecord.ts';

// ── GeoErrorRecord ─────────────────────────────────────────────────────────────

describe('GeoErrorRecord', () => {
  it('capture from an Error instance uses the error class name as variant', () => {
    const record = GeoErrorRecord.capture('reverse-geocode', new RangeError('out of bounds'), 'lat=91 lng=0');
    assert.equal(record.variant, 'RangeError');
    assert.equal(record.source, 'reverse-geocode');
    assert.equal(record.message, 'out of bounds');
    assert.equal(record.input, 'lat=91 lng=0');
  });

  it('capture from a SyntaxError reports SyntaxError as variant', () => {
    const record = GeoErrorRecord.capture('parse-json', new SyntaxError('unexpected token'), 'payload-abc');
    assert.equal(record.variant, 'SyntaxError');
  });

  it('capture from a non-Error string uses UnknownError as variant', () => {
    const record = GeoErrorRecord.capture('ip-geolocate', 'network timeout', '8.8.8.8');
    assert.equal(record.variant, 'UnknownError');
    assert.equal(record.message, 'network timeout');
  });

  it('capture from a non-Error object uses UnknownError as variant', () => {
    const record = GeoErrorRecord.capture('parse-csv', { 'code': 404 }, 'source-id-1');
    assert.equal(record.variant, 'UnknownError');
  });

  it('truncates message to 200 chars with ellipsis when exceeded', () => {
    const longMessage = 'x'.repeat(250);
    const record = GeoErrorRecord.capture('test', new Error(longMessage), 'input');
    // 200 chars: first 199 + '…'
    assert.equal(record.message.length, 200);
    assert.ok(record.message.endsWith('…'));
  });

  it('keeps message unchanged when within limit', () => {
    const shortMessage = 'short error';
    const record = GeoErrorRecord.capture('test', new Error(shortMessage), 'input');
    assert.equal(record.message, shortMessage);
  });

  it('truncates input to 80 chars with ellipsis when exceeded', () => {
    const longInput = 'y'.repeat(100);
    const record = GeoErrorRecord.capture('test', new Error('msg'), longInput);
    assert.equal(record.input.length, 80);
    assert.ok(record.input.endsWith('…'));
  });

  it('coords produces a coordinate summary string', () => {
    const label = GeoErrorRecord.coords(51.5074, -0.1278);
    assert.equal(label, 'lat=51.5074 lng=-0.1278');
  });

  it('coords uses 4 decimal places', () => {
    const label = GeoErrorRecord.coords(0, 0);
    assert.equal(label, 'lat=0.0000 lng=0.0000');
  });

  it('produced record satisfies the schema (all required fields present)', () => {
    const record = GeoErrorRecord.capture('src', new TypeError('t'), 'inp');
    assert.ok('source'  in record);
    assert.ok('variant' in record);
    assert.ok('message' in record);
    assert.ok('input'   in record);
  });
});

// ── ErrorRollup ───────────────────────────────────────────────────────────────

describe('ErrorRollup', () => {
  it('empty creates a rollup with zero total and empty groups', () => {
    const rollup = ErrorRollup.empty();
    assert.equal(rollup.total, 0);
    assert.equal(rollup.groups.size, 0);
  });

  it('fold increments total for each record', () => {
    const rollup = ErrorRollup.empty();
    const rec: GeoErrorRecordType = { 'source': 'geo', 'variant': 'RangeError', 'message': 'bad coords', 'input': 'lat=91' };
    ErrorRollup.fold(rollup, rec);
    ErrorRollup.fold(rollup, rec);
    assert.equal(rollup.total, 2);
  });

  it('fold groups records by source+variant key', () => {
    const rollup = ErrorRollup.empty();
    const r1: GeoErrorRecordType = { 'source': 'geo', 'variant': 'RangeError', 'message': 'a', 'input': 'i' };
    const r2: GeoErrorRecordType = { 'source': 'geo', 'variant': 'SyntaxError', 'message': 'b', 'input': 'i' };
    ErrorRollup.fold(rollup, r1);
    ErrorRollup.fold(rollup, r1);
    ErrorRollup.fold(rollup, r2);
    assert.equal(rollup.total, 3);
    assert.equal(rollup.groups.size, 2);
  });

  it('fold retains count per group', () => {
    const rollup = ErrorRollup.empty();
    const rec: GeoErrorRecordType = { 'source': 'ip', 'variant': 'TypeError', 'message': 'x', 'input': 'y' };
    ErrorRollup.fold(rollup, rec);
    ErrorRollup.fold(rollup, rec);
    ErrorRollup.fold(rollup, rec);
    const key = ErrorRollup.keyOf(rec);
    assert.equal(rollup.groups.get(key)?.count, 3);
  });

  it('fold retains up to 3 distinct sample messages per group', () => {
    const rollup = ErrorRollup.empty();
    for (let i = 0; i < 5; i++) {
      const rec: GeoErrorRecordType = { 'source': 'geo', 'variant': 'Error', 'message': `msg-${i}`, 'input': 'i' };
      ErrorRollup.fold(rollup, rec);
    }
    const key = 'geo Error';
    const group = rollup.groups.get(key);
    assert.ok(group !== undefined);
    // Only 3 distinct messages retained (MAX_SAMPLES_PER_GROUP)
    assert.ok(group.samples.length <= 3);
    assert.equal(group.count, 5);
  });

  it('fold does not add duplicate messages to samples', () => {
    const rollup = ErrorRollup.empty();
    const rec: GeoErrorRecordType = { 'source': 'geo', 'variant': 'Error', 'message': 'same', 'input': 'i' };
    ErrorRollup.fold(rollup, rec);
    ErrorRollup.fold(rollup, rec);
    ErrorRollup.fold(rollup, rec);
    const group = rollup.groups.get('geo Error');
    // 'same' appears once even though folded 3 times
    assert.equal(group?.samples.filter((s) => s === 'same').length, 1);
  });

  it('keyOf produces a string composed of source and variant', () => {
    const rec: GeoErrorRecordType = { 'source': 'my-source', 'variant': 'MyVariant', 'message': 'm', 'input': 'i' };
    const key = ErrorRollup.keyOf(rec);
    assert.ok(key.includes('my-source'));
    assert.ok(key.includes('MyVariant'));
  });

  it('ranked returns groups sorted by descending count', () => {
    const rollup = ErrorRollup.empty();
    const low: GeoErrorRecordType  = { 'source': 'a', 'variant': 'X', 'message': 'x', 'input': 'i' };
    const high: GeoErrorRecordType = { 'source': 'b', 'variant': 'Y', 'message': 'y', 'input': 'i' };
    ErrorRollup.fold(rollup, low);
    ErrorRollup.fold(rollup, high);
    ErrorRollup.fold(rollup, high);
    ErrorRollup.fold(rollup, high);

    const ranked = ErrorRollup.ranked(rollup);
    assert.equal(ranked[0]?.source, 'b'); // 3 occurrences first
    assert.equal(ranked[1]?.source, 'a'); // 1 occurrence second
  });

  it('ranked returns an empty array for an empty rollup', () => {
    const rollup = ErrorRollup.empty();
    assert.deepEqual(ErrorRollup.ranked(rollup), []);
  });

  it('sampleInput is set to the first record input for a group', () => {
    const rollup = ErrorRollup.empty();
    const rec: GeoErrorRecordType = { 'source': 'geo', 'variant': 'RangeError', 'message': 'msg', 'input': 'first-input' };
    ErrorRollup.fold(rollup, rec);
    // Second fold with different input
    ErrorRollup.fold(rollup, { ...rec, 'input': 'second-input' });
    const group = rollup.groups.get('geo RangeError');
    assert.equal(group?.sampleInput, 'first-input');
  });
});
