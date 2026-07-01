import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LlmError } from '../../src/adapter/LlmError.js';
import { LocalModelEmbedder } from '../../src/adapter/LocalModelEmbedder.js';

const FIXED_VECTOR: readonly number[] = [0.1, 0.2, 0.3];
const MODEL_TOKEN = 'model-token';

/**
 * Trivial in-memory fixture: `loadModule`/`spawnModel` resolve fixed values
 * and count their own invocations; `embedWith` returns a fixed vector.
 */
class FakeLocalEmbedder extends LocalModelEmbedder<object, string> {
  loadModuleCalls = 0;
  spawnModelCalls = 0;

  constructor() {
    super('fake-local', 'Fake Local', FIXED_VECTOR.length, import.meta.url);
    this.setModel('fake-model');
  }

  protected async loadModule(): Promise<object> {
    this.loadModuleCalls += 1;
    return Promise.resolve({});
  }

  protected async spawnModel(): Promise<string> {
    this.spawnModelCalls += 1;
    return Promise.resolve(MODEL_TOKEN);
  }

  protected async embedWith(model: string, _text: string): Promise<readonly number[]> {
    assert.equal(model, MODEL_TOKEN);
    return Promise.resolve(FIXED_VECTOR);
  }

  /** Test-only public wrapper around the protected `resolveAssetPath`. */
  resolveAsset(relative: string): string {
    return this.resolveAssetPath(relative);
  }
}

/** `loadModule` always rejects with a plain Error, to exercise classification. */
class FailingLoadEmbedder extends LocalModelEmbedder<object, string> {
  constructor() {
    super('failing-local', 'Failing Local', FIXED_VECTOR.length, import.meta.url, { 'maxAttempts': 1, 'baseDelayMs': 0 });
    this.setModel('fake-model');
  }

  protected async loadModule(): Promise<object> {
    throw new Error('module load failed');
  }

  protected async spawnModel(): Promise<string> {
    return Promise.resolve(MODEL_TOKEN);
  }

  protected async embedWith(_model: string, _text: string): Promise<readonly number[]> {
    return Promise.resolve(FIXED_VECTOR);
  }
}

void describe('LocalModelEmbedder', () => {
  void it('embed() returns the fixed vector through the retry envelope', async () => {
    const embedder = new FakeLocalEmbedder();
    const vector = await embedder.embed('hello');
    assert.deepEqual(vector, FIXED_VECTOR);
  });

  void it('loadModule and spawnModel are each called exactly once across multiple embed()/connect() calls', async () => {
    const embedder = new FakeLocalEmbedder();
    await embedder.connect();
    await embedder.embed('a');
    await embedder.embed('b');
    await embedder.connect();
    assert.equal(embedder.loadModuleCalls, 1);
    assert.equal(embedder.spawnModelCalls, 1);
  });

  void it('disconnect() resets memoization so the next embed()/connect() reloads', async () => {
    const embedder = new FakeLocalEmbedder();
    await embedder.embed('a');
    assert.equal(embedder.loadModuleCalls, 1);
    assert.equal(embedder.spawnModelCalls, 1);

    await embedder.disconnect();
    await embedder.connect();

    assert.equal(embedder.loadModuleCalls, 2);
    assert.equal(embedder.spawnModelCalls, 2);
  });

  void it('embedBatch() reuses the already-memoized model with no extra loadModule calls', async () => {
    const embedder = new FakeLocalEmbedder();
    const out = await embedder.embedBatch(['a', 'b', 'c']);
    assert.equal(out.length, 3);
    for (const v of out) assert.deepEqual(v, FIXED_VECTOR);
    assert.equal(embedder.loadModuleCalls, 1);
    assert.equal(embedder.spawnModelCalls, 1);
  });

  void it('resolveAssetPath() resolves a relative path against the supplied moduleUrl', () => {
    const embedder = new FakeLocalEmbedder();
    const resolved = embedder.resolveAsset('./assets/model.bin');
    assert.equal(resolved, new URL('./assets/model.bin', import.meta.url).toString());
  });

  void it('classifies a loadModule rejection as an LlmError', async () => {
    const embedder = new FailingLoadEmbedder();
    await assert.rejects(
      () => embedder.embed('hello'),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(typeof err.classification.reason, 'string');
        assert.equal(err.classification.retryable, false);
        return true;
      },
    );
  });
});
