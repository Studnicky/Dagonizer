import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TransformersEmbedder } from '@studnicky/dagonizer-embedder-transformers';

import { BaseLlmClient } from '../../../the-archivist/providers/BaseLlmClient.ts';
import { MobileDetection } from '../../../the-archivist/providers/MobileDetection.ts';
import {
  ApiKeyStore,
  BackendMatrix,
  PreferredModels,
  ProviderInstantiator,
} from '../../../the-archivist/providers/index.ts';
import type { BackendAvailability } from '../../../the-archivist/providers/index.ts';
import { DispatcherIntentClassifier } from '../../providers/DispatcherIntentClassifier.ts';
import { DispatcherBrowserRuntime } from '../../runtime/DispatcherBrowserRuntime.ts';
import { DispatcherEmbedderProvisioner } from '../../runtime/DispatcherEmbedderProvisioner.ts';
import { DispatcherProviderRuntime } from '../../runtime/DispatcherProviderRuntime.ts';

class MountProbeBackendMatrix extends BackendMatrix {
  static override async detect(): Promise<readonly BackendAvailability[]> {
    return [];
  }

  static override hasNoRunnableModel(): boolean {
    return true;
  }

  static override pickBest(): BackendAvailability | null {
    return null;
  }
}

void describe('DispatcherProviderRuntime', () => {
  void it('memoizes the in-flight provider module promise', async () => {
    const first = DispatcherProviderRuntime.load();
    const second = DispatcherProviderRuntime.load();

    assert.equal(first, second);
    assert.equal(await first, await second);
  });

  void it('selects the stable provider symbols required by DispatcherRunner', async () => {
    const runtime = await DispatcherProviderRuntime.load();

    assert.deepEqual(Object.keys(runtime).sort(), [
      'ApiKeyStore',
      'BackendMatrix',
      'BaseLlmClient',
      'MobileDetection',
      'PreferredModels',
      'ProviderInstantiator',
    ]);
    assert.equal(runtime.ApiKeyStore, ApiKeyStore);
    assert.equal(runtime.BackendMatrix, BackendMatrix);
    assert.equal(runtime.BaseLlmClient, BaseLlmClient);
    assert.equal(runtime.MobileDetection, MobileDetection);
    assert.equal(runtime.PreferredModels, PreferredModels);
    assert.equal(runtime.ProviderInstantiator, ProviderInstantiator);
  });

  void it('performs mount probing without provisioning transformer model or WASM runtime', async () => {
    const providerRuntime = await DispatcherProviderRuntime.load();
    let provisionCount = 0;
    const browserRuntime = new DispatcherBrowserRuntime({
      'ensureIntentClassifier': async () => {
        provisionCount += 1;
        throw new Error('mount must not provision the embedder');
      },
      'loadProviderRuntime': async () => ({
        ...providerRuntime,
        'BackendMatrix': MountProbeBackendMatrix,
      }),
    });

    const bootstrap = await browserRuntime.loadBootstrapState(null);

    assert.equal(bootstrap.noModel, true);
    assert.equal(provisionCount, 0);
  });

  void it('memoizes transformer-only provisioning without duplicating classifier work', async () => {
    let probeCount = 0;
    let connectCount = 0;
    let embedBatchCount = 0;
    const originalProbe = TransformersEmbedder.prototype.probe;
    const originalConnect = TransformersEmbedder.prototype.connect;
    const originalEmbedBatch = TransformersEmbedder.prototype.embedBatch;

    TransformersEmbedder.prototype.probe = async () => {
      probeCount += 1;
      return true;
    };
    TransformersEmbedder.prototype.connect = async () => {
      connectCount += 1;
    };
    TransformersEmbedder.prototype.embedBatch = async (texts) => {
      embedBatchCount += 1;
      return texts.map((_, index) => [index + 1, 1]);
    };

    try {
      const first = DispatcherEmbedderProvisioner.provision({
        'transformersLocalModelPath': '/models/',
        'transformersWasmPaths': '/ort/',
      });
      const second = DispatcherEmbedderProvisioner.provision();

      assert.equal(first, second);
      const embedder = await first;
      assert.ok(embedder instanceof TransformersEmbedder);
      assert.equal(probeCount, 1);
      assert.equal(connectCount, 1);
      assert.equal(embedBatchCount, 0);

      const classifier = await DispatcherIntentClassifier.create(embedder);

      assert.ok(classifier instanceof DispatcherIntentClassifier);
      assert.equal(embedBatchCount, 1);
    } finally {
      TransformersEmbedder.prototype.probe = originalProbe;
      TransformersEmbedder.prototype.connect = originalConnect;
      TransformersEmbedder.prototype.embedBatch = originalEmbedBatch;
    }
  });
});
