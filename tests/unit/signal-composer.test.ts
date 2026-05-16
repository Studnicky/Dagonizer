import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SignalComposer } from '../../src/runtime/SignalComposer.js';

void describe('SignalComposer.compose', () => {
  void it('returns null when neither signal nor deadline is supplied', () => {
    assert.equal(SignalComposer.compose({}), null);
  });

  void it('returns the supplied signal directly when only signal is supplied', () => {
    const controller = new AbortController();
    const composed = SignalComposer.compose({ 'signal': controller.signal });
    assert.equal(composed, controller.signal);
  });

  void it('returns a timeout signal when only deadlineMs is supplied', () => {
    const composed = SignalComposer.compose({ 'deadlineMs': 1000 });
    assert.ok(composed instanceof AbortSignal);
  });

  void it('composes via AbortSignal.any when both are supplied', () => {
    const controller = new AbortController();
    const composed = SignalComposer.compose({ 'signal': controller.signal, 'deadlineMs': 1000 });
    assert.ok(composed instanceof AbortSignal);
    assert.notEqual(composed, controller.signal);
  });

  void it('aborts the composed signal when the underlying controller aborts', () => {
    const controller = new AbortController();
    const composed = SignalComposer.compose({ 'signal': controller.signal, 'deadlineMs': 60_000 });
    assert.ok(composed !== null);
    assert.equal(composed?.aborted, false);
    controller.abort('cancelled-by-test');
    assert.equal(composed?.aborted, true);
  });
});
