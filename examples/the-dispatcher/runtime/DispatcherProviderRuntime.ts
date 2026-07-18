import {
  ApiKeyStore,
  BackendMatrix,
  BaseLlmClient,
  MobileDetection,
  PreferredModels,
  ProviderInstantiator,
} from '../../the-archivist/providers/index.ts';

interface DispatcherProviderRuntimeModule {
  readonly ApiKeyStore: typeof ApiKeyStore;
  readonly BackendMatrix: typeof BackendMatrix;
  readonly BaseLlmClient: typeof BaseLlmClient;
  readonly MobileDetection: typeof MobileDetection;
  readonly PreferredModels: typeof PreferredModels;
  readonly ProviderInstantiator: typeof ProviderInstantiator;
}

export class DispatcherProviderRuntime {
  static readonly #modulePromise: Promise<DispatcherProviderRuntimeModule> = Promise.resolve({
    ApiKeyStore,
    BackendMatrix,
    BaseLlmClient,
    MobileDetection,
    PreferredModels,
    ProviderInstantiator,
  });

  static load(): Promise<DispatcherProviderRuntimeModule> {
    return DispatcherProviderRuntime.#modulePromise;
  }
}
