import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Signal } from '@studnicky/signal';

void describe('Signal.never', () => {
  void it('returns an AbortSignal', () => {
    const signal = Signal.never();
    assert.ok(signal instanceof AbortSignal);
  });

  void it('returns a signal that is not aborted', () => {
    const signal = Signal.never();
    assert.equal(signal.aborted, false);
  });

  void it('returns the same cached instance on repeated calls', () => {
    const a = Signal.never();
    const b = Signal.never();
    assert.equal(a, b);
  });
});

void describe('Signal.compose', () => {
  void it('returns the never-aborting sentinel when neither signal nor deadline is supplied', () => {
    const composed = Signal.compose({});
    assert.equal(composed, Signal.never());
    assert.equal(composed.aborted, false);
  });

  void it('returns the supplied signal directly when only signal is supplied', () => {
    const controller = new AbortController();
    const composed = Signal.compose({ 'signal': controller.signal });
    assert.equal(composed, controller.signal);
  });

  void it('returns a timeout signal when only deadlineMs is supplied', () => {
    const composed = Signal.compose({ 'deadlineMs': 1000 });
    assert.ok(composed instanceof AbortSignal);
  });

  void it('composes via AbortSignal.any when both are supplied', () => {
    const controller = new AbortController();
    const composed = Signal.compose({ 'signal': controller.signal, 'deadlineMs': 1000 });
    assert.ok(composed instanceof AbortSignal);
    assert.notEqual(composed, controller.signal);
  });

  void it('aborts the composed signal when the underlying controller aborts', () => {
    const controller = new AbortController();
    const composed = Signal.compose({ 'signal': controller.signal, 'deadlineMs': 60_000 });
    assert.equal(composed.aborted, false);
    controller.abort('cancelled-by-test');
    assert.equal(composed.aborted, true);
  });

  void it('throws SignalError when deadlineMs is negative', () => {
    assert.throws(() => Signal.compose({ 'deadlineMs': -1 }));
  });
});
