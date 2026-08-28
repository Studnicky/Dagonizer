import {
  ActiveBackendStore,
  ApiKeyStore,
  BackendMatrix,
  BaseLlmClient,
  MobileDetection,
  PreferredModels,
  ProviderInstantiator,
} from '../../the-archivist/providers/index.ts';

interface DispatcherProviderRuntimeModule {
  readonly ActiveBackendStore: typeof ActiveBackendStore;
  readonly ApiKeyStore: typeof ApiKeyStore;
  readonly BackendMatrix: typeof BackendMatrix;
  readonly BaseLlmClient: typeof BaseLlmClient;
  readonly MobileDetection: typeof MobileDetection;
  readonly PreferredModels: typeof PreferredModels;
  readonly ProviderInstantiator: typeof ProviderInstantiator;
}

export class DispatcherProviderRuntime {
  static readonly #modulePromise: Promise<DispatcherProviderRuntimeModule> = Promise.resolve({
    ActiveBackendStore,
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
