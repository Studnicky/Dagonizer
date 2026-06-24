import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DottedPathAccessor } from '../../src/runtime/DottedPathAccessor.js';

// Regression tests for prototype-pollution guard in DottedPathAccessor.set.
// Each test confirms that FORBIDDEN_KEYS segments produce a no-op write, and
// that normal nested paths remain fully functional.

void describe('DottedPathAccessor — prototype-pollution guard', () => {
  void it('set with __proto__ prefix is a no-op and does not pollute Object.prototype', () => {
    const acc = new DottedPathAccessor();
    acc.set({}, '__proto__.polluted', true);
    assert.equal(Object.prototype.hasOwnProperty.call({}, 'polluted'), false);
    assert.equal('polluted' in {}, false);
  });

  void it('set with constructor segment is a no-op', () => {
    const acc = new DottedPathAccessor();
    acc.set({}, 'constructor.prototype.polluted', true);
    assert.equal(Object.prototype.hasOwnProperty.call({}, 'polluted'), false);
    assert.equal('polluted' in {}, false);
  });

  void it('set with prototype segment is a no-op', () => {
    const acc = new DottedPathAccessor();
    acc.set({}, 'a.prototype.polluted', true);
    const s: Record<string, unknown> = {};
    acc.set(s, 'a.prototype.polluted', true);
    assert.equal(Object.prototype.hasOwnProperty.call({}, 'polluted'), false);
    assert.equal('polluted' in {}, false);
  });

  void it('set with __proto__ as a nested segment is a no-op', () => {
    const acc = new DottedPathAccessor();
    const s: Record<string, unknown> = {};
    acc.set(s, 'a.__proto__.polluted', true);
    assert.equal(Object.prototype.hasOwnProperty.call({}, 'polluted'), false);
    assert.equal('polluted' in {}, false);
  });

  void it('normal nested path still reads and writes correctly', () => {
    const acc = new DottedPathAccessor();
    const s: Record<string, unknown> = {};
    acc.set(s, 'a.b.c', 5);
    assert.equal(acc.get(s, 'a.b.c'), 5);
  });

  void it('get on a __proto__ path returns null', () => {
    const acc = new DottedPathAccessor();
    assert.equal(acc.get({}, '__proto__.x'), null);
  });
});
