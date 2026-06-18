import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AdapterDescriptor, type AdapterDescriptorShape } from '../../src/adapter/AdapterDescriptor.js';
import { BaseEmbedder } from '../../src/adapter/BaseEmbedder.js';
import { EmbedderCascade } from '../../src/adapter/EmbedderCascade.js';
import { EmbedderRegistry } from '../../src/adapter/EmbedderRegistry.js';
import type { AdapterCapabilities } from '../../src/adapter/LlmAdapter.js';
import { LlmError } from '../../src/adapter/LlmError.js';

const FULL_CAPABILITIES: AdapterCapabilities = {
  'toolUse': 'full',
  'structuredOutput': true,
  'jsonMode': true,
};

/**
 * Minimal concrete embedder for testing. The probe result is fixed at
 * construction so individual tests can wire up deterministic cascades.
 * Returns a stable 4-dim vector; enough to verify cosine math
 * elsewhere without being noisy.
 */
class TestEmbedder extends BaseEmbedder {
  readonly #probeResult: boolean;

  constructor(id: string, probeResult: boolean) {
    super(id, id, 4);
    this.#probeResult = probeResult;
  }

  protected async performEmbed(_text: string, _signal: AbortSignal): Promise<readonly number[]> {
    return Promise.resolve([1, 0, 0, 0]);
  }

  override async probe(): Promise<boolean> {
    return Promise.resolve(this.#probeResult);
  }
}

/** Embedder that does NOT override probe; inherits BaseEmbedder default. */
class DefaultProbeEmbedder extends BaseEmbedder {
  constructor() {
    super('default-probe', 'default-probe', 4);
  }

  protected async performEmbed(_text: string, _signal: AbortSignal): Promise<readonly number[]> {
    return Promise.resolve([0, 1, 0, 0]);
  }
}

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

/** Rejects with an LlmError(TIMEOUT) when it sees an already-aborted signal. */
class AbortingEmbedder extends BaseEmbedder {
  constructor() {
    super('aborting', 'Aborting', 4, { 'maxAttempts': 1, 'baseDelayMs': 0 });
  }

  protected override async performEmbed(_text: string, signal: AbortSignal): Promise<readonly number[]> {
    if (signal.aborted) {
      const err = new LlmError('aborted', { 'reason': 'TIMEOUT', 'retryable': false });
      return Promise.reject(err);
    }
    return Promise.resolve([0, 0, 0, 0]);
  }
}

function descriptorOf(provider: string, model: string): AdapterDescriptorShape {
  return {
    'provider':     provider,
    'model':        model,
    'capabilities': FULL_CAPABILITIES,
  };
}

void describe('EmbedderRegistry', () => {
  void it('registers, queries, resolves, and lists embedders', () => {
    const registry = new EmbedderRegistry();
    const descA = descriptorOf('provA', 'modelA');
    const descB = descriptorOf('provB', 'modelB');
    registry.register(descA, () => new TestEmbedder('A', true));
    registry.register(descB, () => new TestEmbedder('B', true));

    assert.equal(registry.has('provA', 'modelA'), true);
    assert.equal(registry.has('provB', 'modelB'), true);
    assert.equal(registry.has('provC', 'modelC'), false);

    const a = registry.resolve('provA', 'modelA');
    assert.notEqual(a, null);
    assert.equal(a?.id, 'A');
    assert.equal(a?.dimensions, 4);

    const list = registry.list();
    assert.equal(list.length, 2);
    assert.deepEqual(
      list.map((d) => AdapterDescriptor.key(d.provider, d.model)),
      ['provA:modelA', 'provB:modelB'],
    );
  });

  void it('throws CONFIGURATION on duplicate registration', () => {
    const registry = new EmbedderRegistry();
    const desc = descriptorOf('dup', 'one');
    registry.register(desc, () => new TestEmbedder('first', true));
    assert.throws(
      () => { registry.register(desc, () => new TestEmbedder('second', true)); },
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'CONFIGURATION');
        assert.equal(err.classification.retryable, false);
        assert.match(err.message, /duplicate registration for 'dup:one'/u);
        return true;
      },
    );
  });

  void it('returns null on unregistered resolve', () => {
    const registry = new EmbedderRegistry();
    assert.equal(registry.resolve('nope', 'nada'), null);
  });

  void it('produces a fresh instance per resolve call', () => {
    const registry = new EmbedderRegistry();
    registry.register(descriptorOf('p', 'm'), () => new TestEmbedder('p:m', true));
    const first  = registry.resolve('p', 'm');
    const second = registry.resolve('p', 'm');
    assert.notEqual(first, null);
    assert.notEqual(second, null);
    assert.notStrictEqual(first, second);
  });
});

void describe('EmbedderCascade', () => {
  void it('returns the first embedder when both probe true', async () => {
    const registry = new EmbedderRegistry();
    registry.register(descriptorOf('first',  'm'), () => new TestEmbedder('first',  true));
    registry.register(descriptorOf('second', 'm'), () => new TestEmbedder('second', true));
    const cascade = new EmbedderCascade(registry, [
      { 'provider': 'first',  'model': 'm' },
      { 'provider': 'second', 'model': 'm' },
    ]);
    const selected = await cascade.select();
    assert.equal(selected.id, 'first');
  });

  void it('skips probe-false embedder and picks next', async () => {
    const registry = new EmbedderRegistry();
    registry.register(descriptorOf('cold', 'm'), () => new TestEmbedder('cold', false));
    registry.register(descriptorOf('warm', 'm'), () => new TestEmbedder('warm', true));
    const cascade = new EmbedderCascade(registry, [
      { 'provider': 'cold', 'model': 'm' },
      { 'provider': 'warm', 'model': 'm' },
    ]);
    const selected = await cascade.select();
    assert.equal(selected.id, 'warm');
  });

  void it('throws NO_ADAPTER_AVAILABLE when every probe fails', async () => {
    const registry = new EmbedderRegistry();
    registry.register(descriptorOf('a', 'm'), () => new TestEmbedder('a', false));
    registry.register(descriptorOf('b', 'm'), () => new TestEmbedder('b', false));
    const cascade = new EmbedderCascade(registry, [
      { 'provider': 'a', 'model': 'm' },
      { 'provider': 'b', 'model': 'm' },
    ]);
    await assert.rejects(
      () => cascade.select(),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'NO_ADAPTER_AVAILABLE');
        assert.equal(err.classification.retryable, false);
        assert.match(err.message, /a:m \(probe failed\)/u);
        assert.match(err.message, /b:m \(probe failed\)/u);
        return true;
      },
    );
  });

  void it('logs unregistered preferences in the failure message', async () => {
    const registry = new EmbedderRegistry();
    registry.register(descriptorOf('known', 'm'), () => new TestEmbedder('known', false));
    const cascade = new EmbedderCascade(registry, [
      { 'provider': 'ghost', 'model': 'm' },
      { 'provider': 'known', 'model': 'm' },
    ]);
    await assert.rejects(
      () => cascade.select(),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'NO_ADAPTER_AVAILABLE');
        assert.match(err.message, /ghost:m \(unregistered\)/u);
        assert.match(err.message, /known:m \(probe failed\)/u);
        return true;
      },
    );
  });

  void it('skips unregistered preference and selects next', async () => {
    const registry = new EmbedderRegistry();
    registry.register(descriptorOf('real', 'm'), () => new TestEmbedder('real', true));
    const cascade = new EmbedderCascade(registry, [
      { 'provider': 'fake', 'model': 'm' },
      { 'provider': 'real', 'model': 'm' },
    ]);
    const selected = await cascade.select();
    assert.equal(selected.id, 'real');
  });
});

void describe('BaseEmbedder defaults', () => {
  void it('probe returns true when subclass does not override', async () => {
    const embedder = new DefaultProbeEmbedder();
    const ok = await embedder.probe();
    assert.equal(ok, true);
  });

  void it('embed returns the concrete subclass vector', async () => {
    const embedder = new DefaultProbeEmbedder();
    const vec = await embedder.embed('anything');
    assert.deepEqual(vec, [0, 1, 0, 0]);
    assert.equal(vec.length, embedder.dimensions);
  });

  void it('embedBatch fans out serially over embed()', async () => {
    const embedder = new DefaultProbeEmbedder();
    const out = await embedder.embedBatch(['a', 'b', 'c']);
    assert.equal(out.length, 3);
    for (const v of out) assert.deepEqual(v, [0, 1, 0, 0]);
  });
});

void describe('BaseEmbedder signal threading (ADP-3 + ADP-7)', () => {
  void it('performEmbed receives the caller signal when one is provided', async () => {
    const embedder = new SignalCapturingEmbedder();
    const controller = new AbortController();
    await embedder.embed('hello', { 'signal': controller.signal });
    assert.equal(embedder.capturedSignals.length, 1);
    assert.strictEqual(embedder.capturedSignals[0], controller.signal);
  });

  void it('performEmbed receives a valid, unaborted AbortSignal even without a caller signal', async () => {
    const embedder = new SignalCapturingEmbedder();
    await embedder.embed('hello');
    assert.equal(embedder.capturedSignals.length, 1);
    const sig = embedder.capturedSignals[0];
    assert.ok(sig instanceof AbortSignal, 'should be an AbortSignal');
    assert.equal(sig.aborted, false, 'should not be aborted');
  });

  void it('embedBatch threads the same signal into each embed call', async () => {
    const embedder = new SignalCapturingEmbedder();
    const controller = new AbortController();
    const results = await embedder.embedBatch(['a', 'b', 'c'], { 'signal': controller.signal });
    assert.equal(results.length, 3);
    assert.equal(embedder.capturedSignals.length, 3);
    for (const sig of embedder.capturedSignals) {
      assert.strictEqual(sig, controller.signal, 'each call should receive the same signal');
    }
  });

  void it('embedBatch without a signal fans out without error', async () => {
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
      () => embedder.embed('hello', { 'signal': controller.signal }),
      (err: unknown): boolean => {
        return err instanceof LlmError || (err instanceof DOMException && err.name === 'AbortError') || (err instanceof Error && err.name === 'AbortError');
      },
    );
  });
});
