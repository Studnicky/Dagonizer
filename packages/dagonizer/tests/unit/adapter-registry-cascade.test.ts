import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AdapterDescriptor, type AdapterDescriptorShape } from '../../src/adapter/AdapterDescriptor.js';
import { BaseAdapter } from '../../src/adapter/BaseAdapter.js';
import type {
  AdapterCapabilities,
  ChatRequest,
  ChatResponse,
} from '../../src/adapter/LlmAdapter.js';
import { ZERO_TOKEN_USAGE } from '../../src/adapter/LlmAdapter.js';
import { LlmAdapterCascade } from '../../src/adapter/LlmAdapterCascade.js';
import { LlmAdapterRegistry } from '../../src/adapter/LlmAdapterRegistry.js';
import { LlmError } from '../../src/adapter/LlmError.js';

const FULL_CAPABILITIES: AdapterCapabilities = {
  'toolUse': 'full',
  'structuredOutput': true,
  'jsonMode': true,
};

/**
 * Minimal concrete adapter for testing. The probe result is fixed at
 * construction so individual tests can wire up deterministic cascades.
 */
class TestAdapter extends BaseAdapter {
  readonly #probeResult: boolean;

  constructor(id: string, probeResult: boolean) {
    super(id, id, FULL_CAPABILITIES);
    this.#probeResult = probeResult;
  }

  protected async performChat(_request: ChatRequest): Promise<ChatResponse> {
    return Promise.resolve({
      'message':      { 'kind': 'text', 'content': '' },
      'finishReason': 'stop',
      'usage':        ZERO_TOKEN_USAGE,
    });
  }

  override async probe(): Promise<boolean> {
    return Promise.resolve(this.#probeResult);
  }
}

/** Adapter that does NOT override probe; inherits BaseAdapter default. */
class DefaultProbeAdapter extends BaseAdapter {
  constructor() {
    super('default-probe', 'default-probe', FULL_CAPABILITIES);
  }

  protected async performChat(_request: ChatRequest): Promise<ChatResponse> {
    return Promise.resolve({
      'message':      { 'kind': 'text', 'content': '' },
      'finishReason': 'stop',
      'usage':        ZERO_TOKEN_USAGE,
    });
  }
}

function descriptorOf(provider: string, model: string): AdapterDescriptorShape {
  return {
    'provider':     provider,
    'model':        model,
    'capabilities': FULL_CAPABILITIES,
  };
}

void describe('AdapterDescriptor.key', () => {
  void it('builds a stable provider:model key', () => {
    assert.equal(AdapterDescriptor.key('gemini-api', 'gemini-2.5-flash'), 'gemini-api:gemini-2.5-flash');
    assert.equal(AdapterDescriptor.key('ollama', 'llama3.1:8b'), 'ollama:llama3.1:8b');
  });
});

void describe('LlmAdapterRegistry', () => {
  void it('registers, queries, resolves, and lists adapters', () => {
    const registry = new LlmAdapterRegistry();
    const descA = descriptorOf('provA', 'modelA');
    const descB = descriptorOf('provB', 'modelB');
    registry.register(descA, () => new TestAdapter('A', true));
    registry.register(descB, () => new TestAdapter('B', true));

    assert.equal(registry.has('provA', 'modelA'), true);
    assert.equal(registry.has('provB', 'modelB'), true);
    assert.equal(registry.has('provC', 'modelC'), false);

    const a = registry.resolve('provA', 'modelA');
    assert.notEqual(a, null);
    assert.equal(a?.id, 'A');

    const list = registry.list();
    assert.equal(list.length, 2);
    assert.deepEqual(
      list.map((d) => `${d.provider}:${d.model}`),
      ['provA:modelA', 'provB:modelB'],
    );
  });

  void it('throws CONFIGURATION on duplicate registration', () => {
    const registry = new LlmAdapterRegistry();
    const desc = descriptorOf('dup', 'one');
    registry.register(desc, () => new TestAdapter('first', true));
    assert.throws(
      () => { registry.register(desc, () => new TestAdapter('second', true)); },
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
    const registry = new LlmAdapterRegistry();
    assert.equal(registry.resolve('nope', 'nada'), null);
  });

  void it('produces a fresh instance per resolve call', () => {
    const registry = new LlmAdapterRegistry();
    registry.register(descriptorOf('p', 'm'), () => new TestAdapter('p:m', true));
    const first  = registry.resolve('p', 'm');
    const second = registry.resolve('p', 'm');
    assert.notEqual(first, null);
    assert.notEqual(second, null);
    assert.notStrictEqual(first, second);
  });
});

void describe('LlmAdapterCascade', () => {
  void it('returns the first adapter when both probe true', async () => {
    const registry = new LlmAdapterRegistry();
    registry.register(descriptorOf('first',  'm'), () => new TestAdapter('first',  true));
    registry.register(descriptorOf('second', 'm'), () => new TestAdapter('second', true));
    const cascade = new LlmAdapterCascade(registry, [
      { 'provider': 'first',  'model': 'm' },
      { 'provider': 'second', 'model': 'm' },
    ]);
    const selected = await cascade.select();
    assert.equal(selected.id, 'first');
  });

  void it('skips probe-false adapter and picks next', async () => {
    const registry = new LlmAdapterRegistry();
    registry.register(descriptorOf('cold', 'm'), () => new TestAdapter('cold', false));
    registry.register(descriptorOf('warm', 'm'), () => new TestAdapter('warm', true));
    const cascade = new LlmAdapterCascade(registry, [
      { 'provider': 'cold', 'model': 'm' },
      { 'provider': 'warm', 'model': 'm' },
    ]);
    const selected = await cascade.select();
    assert.equal(selected.id, 'warm');
  });

  void it('throws NO_ADAPTER_AVAILABLE when every probe fails', async () => {
    const registry = new LlmAdapterRegistry();
    registry.register(descriptorOf('a', 'm'), () => new TestAdapter('a', false));
    registry.register(descriptorOf('b', 'm'), () => new TestAdapter('b', false));
    const cascade = new LlmAdapterCascade(registry, [
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
    const registry = new LlmAdapterRegistry();
    registry.register(descriptorOf('known', 'm'), () => new TestAdapter('known', false));
    const cascade = new LlmAdapterCascade(registry, [
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
    const registry = new LlmAdapterRegistry();
    registry.register(descriptorOf('real', 'm'), () => new TestAdapter('real', true));
    const cascade = new LlmAdapterCascade(registry, [
      { 'provider': 'fake', 'model': 'm' },
      { 'provider': 'real', 'model': 'm' },
    ]);
    const selected = await cascade.select();
    assert.equal(selected.id, 'real');
  });
});

void describe('BaseAdapter.probe default', () => {
  void it('returns true when subclass does not override', async () => {
    const adapter = new DefaultProbeAdapter();
    const ok = await adapter.probe();
    assert.equal(ok, true);
  });
});
