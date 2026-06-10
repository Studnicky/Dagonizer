/**
 * Tests for ADP-3 + ADP-7: AbortSignal threading into performEmbed,
 * and the flattened embed/embedBatch signatures.
 *
 * Verifies:
 *  - performEmbed receives the signal passed to embed()
 *  - A never-aborting signal is passed when embed() is called without one
 *  - embedBatch threads the signal into each embed() call
 *  - Aborting mid-embed surfaces as a rejection (via the retry policy)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BaseEmbedder } from '../../src/adapter/BaseEmbedder.js';
import { LlmError } from '../../src/adapter/LlmError.js';

/** Records every signal it receives so tests can inspect them. */
class SignalCapturingEmbedder extends BaseEmbedder {
  readonly capturedSignals: AbortSignal[] = [];

  constructor() {
    super('signal-test', 'Signal Test', 4);
  }

  protected override async performEmbed(_text: string, signal: AbortSignal): Promise<readonly number[]> {
    this.capturedSignals.push(signal);
    return Promise.resolve([1, 0, 0, 0]);
  }
}

/** Rejects with an LlmError(TIMEOUT) when it sees a non-default signal. */
class AbortingEmbedder extends BaseEmbedder {
  constructor() {
    super('aborting', 'Aborting', 4, { 'maxAttempts': 1 });
  }

  protected override async performEmbed(_text: string, signal: AbortSignal): Promise<readonly number[]> {
    if (signal.aborted) {
      const err = new LlmError('aborted', { 'reason': 'TIMEOUT', 'retryable': false });
      return Promise.reject(err);
    }
    return Promise.resolve([0, 0, 0, 0]);
  }
}

void describe('BaseEmbedder signal threading (ADP-3 + ADP-7)', () => {
  void it('performEmbed receives the caller signal when one is provided', async () => {
    const embedder = new SignalCapturingEmbedder();
    const controller = new AbortController();
    await embedder.embed('hello', { "signal": controller.signal });
    assert.equal(embedder.capturedSignals.length, 1);
    assert.strictEqual(embedder.capturedSignals[0], controller.signal);
  });

  void it('performEmbed receives a valid AbortSignal even without caller signal', async () => {
    const embedder = new SignalCapturingEmbedder();
    await embedder.embed('hello');
    assert.equal(embedder.capturedSignals.length, 1);
    const sig = embedder.capturedSignals[0];
    assert.ok(sig instanceof AbortSignal, 'should be an AbortSignal');
    assert.equal(sig.aborted, false, 'should not be aborted');
  });

  void it('embedBatch threads signal into each embed call', async () => {
    const embedder = new SignalCapturingEmbedder();
    const controller = new AbortController();
    const results = await embedder.embedBatch(['a', 'b', 'c'], { "signal": controller.signal });
    assert.equal(results.length, 3);
    assert.equal(embedder.capturedSignals.length, 3);
    for (const sig of embedder.capturedSignals) {
      assert.strictEqual(sig, controller.signal, 'each call should receive the same signal');
    }
  });

  void it('embedBatch without signal fans out without error', async () => {
    const embedder = new SignalCapturingEmbedder();
    const results = await embedder.embedBatch(['x', 'y']);
    assert.equal(results.length, 2);
    assert.equal(embedder.capturedSignals.length, 2);
  });

  void it('already-aborted signal causes rejection', async () => {
    const embedder = new AbortingEmbedder();
    const controller = new AbortController();
    controller.abort();
    // An already-aborted signal may surface as AbortError (from the retry-policy
    // abort check) or as LlmError(TIMEOUT) from performEmbed — both are correct.
    await assert.rejects(
      () => embedder.embed('hello', { "signal": controller.signal }),
      (err: unknown): boolean => {
        return err instanceof LlmError || (err instanceof DOMException && err.name === 'AbortError') || (err instanceof Error && err.name === 'AbortError');
      },
    );
  });
});
