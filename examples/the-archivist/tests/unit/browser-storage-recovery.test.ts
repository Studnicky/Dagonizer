import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RestoredContextRecovery } from '../../app/RestoredContextRecovery.ts';
import { ActiveBackendStore, ApiKeyStore, PreferredModels } from '../../providers/index.ts';
import { MobileDetection } from '../../providers/MobileDetection.ts';

class LocalStorageDouble {
  readonly #entries = new Map();

  clear(): void {
    this.#entries.clear();
  }

  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.#entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#entries.set(key, value);
  }
}

function withLocalStorage(run: (storage: LocalStorageDouble) => void | Promise<void>): Promise<void> | void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new LocalStorageDouble();
  Object.defineProperty(globalThis, 'localStorage', {
    'configurable': true,
    'value': storage,
  });

  const finalize = () => {
    if (previousDescriptor === undefined) {
      void Reflect.deleteProperty(globalThis, 'localStorage');
      return;
    }
    Object.defineProperty(globalThis, 'localStorage', previousDescriptor);
  };

  try {
    const result = run(storage);
    if (result instanceof Promise) {
      return result.finally(finalize);
    }
    finalize();
    return result;
  } catch (error) {
    finalize();
    throw error;
  }
}

void describe('browser storage recovery', () => {
  void it('clears malformed API key payloads instead of preserving stale localStorage', () => withLocalStorage((storage) => {
    storage.setItem('dagonizer-api-keys', '{"groq":');

    assert.deepEqual(ApiKeyStore.load(), {});
    assert.equal(storage.getItem('dagonizer-api-keys'), null);
  }));

  void it('clears malformed preferred-model payloads and invalid active backend ids', () => withLocalStorage((storage) => {
    storage.setItem('dagonizer-preferred-models', '[]');
    storage.setItem('dagonizer-active-backend', 'legacy-backend');

    assert.deepEqual(PreferredModels.load(), {});
    assert.equal(ActiveBackendStore.load(), null);
    assert.equal(storage.getItem('dagonizer-preferred-models'), null);
    assert.equal(storage.getItem('dagonizer-active-backend'), null);
  }));

  void it('clears invalid mobile overrides instead of silently reusing them', () => withLocalStorage((storage) => {
    storage.setItem('dagonizer-device-override', 'tablet');

    assert.equal(MobileDetection.readOverride(), null);
    assert.equal(storage.getItem('dagonizer-device-override'), null);
  }));

  void it('clears stale restored context when reload-time recovery fails', async () => {
    let cleared = 0;

    const result = await RestoredContextRecovery.restore(
      {
        'clear': async () => {
          cleared += 1;
        },
        'load': async () => ({ 'version': 'stale-idb-record' }),
      },
      async () => {
        throw new Error('restore rejected stale schema');
      },
    );

    assert.equal(result.variant, 'cleared');
    assert.equal(result.error.message, 'restore rejected stale schema');
    assert.equal(cleared, 1);
  });
});
