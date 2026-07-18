import type { LlmAdapterInterface } from '@studnicky/dagonizer/adapter';
import type { BackendAvailability, EmbedderProvisionOptionsType, ProviderId } from '../../the-archivist/providers/index.ts';

import type { DispatcherIntentClassifier } from '../providers/DispatcherIntentClassifier.ts';
import type { DispatcherLlmClient } from '../providers/DispatcherLlmClient.ts';
import type { DispatcherServices } from '../services.ts';
import type { DispatcherProviderRuntime } from './DispatcherProviderRuntime.ts';

async function createLlmClient(
  adapter: LlmAdapterInterface,
  options: { readonly language: string },
): Promise<DispatcherLlmClient> {
  const module = await import('../providers/DispatcherLlmClient.ts');
  return new module.DispatcherLlmClient(adapter, options);
}

interface DispatcherBrowserBootstrapState {
  readonly activeBackend: ProviderId | null;
  readonly apiKeys: Partial<Record<ProviderId, string>>;
  readonly backendNote: string | null;
  readonly backends: readonly BackendAvailability[];
  readonly isMobile: boolean;
  readonly noModel: boolean;
  readonly preferredModels: Partial<Record<ProviderId, string>>;
}

interface DispatcherBrowserRefreshBackendsRequest {
  readonly apiKeys: Partial<Record<ProviderId, string>>;
  readonly isMobile: boolean;
  readonly preferredModels: Partial<Record<ProviderId, string>>;
}

interface DispatcherBrowserBuildServicesRequest {
  readonly activeBackend: ProviderId | null;
  readonly apiKeys: Partial<Record<ProviderId, string>>;
  readonly baseUrl: string;
  readonly language: string;
  readonly model: string;
}

interface DispatcherBrowserWarmBackendRequest {
  readonly activeBackend: ProviderId | null;
  readonly apiKeys: Partial<Record<ProviderId, string>>;
  readonly language: string;
  readonly model: string;
}

interface DispatcherBrowserRuntimeDependencies {
  readonly ensureIntentClassifier: (
    options: EmbedderProvisionOptionsType,
  ) => Promise<DispatcherIntentClassifier>;
  readonly loadProviderRuntime: () => ReturnType<typeof DispatcherProviderRuntime.load>;
}

class DispatcherBrowserIntentProvider {
  readonly #ensureIntentClassifier: DispatcherBrowserRuntimeDependencies['ensureIntentClassifier'];
  readonly #options: EmbedderProvisionOptionsType;

  #classifier: DispatcherIntentClassifier | null = null;
  #provisionPromise: Promise<DispatcherIntentClassifier> | null = null;

  constructor(
    ensureIntentClassifier: DispatcherBrowserRuntimeDependencies['ensureIntentClassifier'],
    options: EmbedderProvisionOptionsType,
  ) {
    this.#ensureIntentClassifier = ensureIntentClassifier;
    this.#options = options;
  }

  get displayName(): string | null {
    return this.#classifier?.embedderDisplayName ?? null;
  }

  async load(): Promise<DispatcherIntentClassifier> {
    if (this.#classifier !== null) {
      return this.#classifier;
    }
    if (this.#provisionPromise === null) {
      this.#provisionPromise = this.#ensureIntentClassifier(this.#options).then(
        (classifier) => {
          this.#classifier = classifier;
          return classifier;
        },
        (error) => {
          this.#provisionPromise = null;
          throw error;
        },
      );
    }
    return this.#provisionPromise;
  }
}

export class DispatcherBrowserRuntime {
  readonly #ensureIntentClassifierDependency: DispatcherBrowserRuntimeDependencies['ensureIntentClassifier'];
  readonly #loadProviderRuntimeDependency: DispatcherBrowserRuntimeDependencies['loadProviderRuntime'];

  #intentProvider: DispatcherBrowserIntentProvider | null = null;

  constructor(dependencies: DispatcherBrowserRuntimeDependencies = DispatcherBrowserRuntime.dependencies()) {
    this.#ensureIntentClassifierDependency = dependencies.ensureIntentClassifier;
    this.#loadProviderRuntimeDependency = dependencies.loadProviderRuntime;
  }

  async loadBootstrapState(savedBackendId: string | null): Promise<DispatcherBrowserBootstrapState> {
    const runtime = await this.#loadProviderRuntimeDependency();
    const isMobile = runtime.MobileDetection.isLikelyMobile();
    const apiKeys = runtime.ApiKeyStore.load();
    const preferredModels = runtime.PreferredModels.load();
    const backends = await runtime.BackendMatrix.detect({ apiKeys, preferredModels });
    const noModel = runtime.BackendMatrix.hasNoRunnableModel(backends, { isMobile });
    if (noModel) {
      return {
        'activeBackend': null,
        apiKeys,
        'backendNote': null,
        backends,
        isMobile,
        noModel,
        preferredModels,
      };
    }

    const savedBackend = savedBackendId !== null && runtime.ApiKeyStore.isProviderId(savedBackendId)
      ? savedBackendId
      : null;
    const savedEntry = savedBackend !== null
      ? backends.find((backend) => backend.id === savedBackend) ?? null
      : null;
    if (savedEntry !== null && savedEntry.runnable) {
      return {
        'activeBackend': savedEntry.id,
        apiKeys,
        'backendNote': `backend from saved preference: ${savedEntry.id}`,
        backends,
        isMobile,
        noModel,
        preferredModels,
      };
    }

    const picked = runtime.BackendMatrix.pickBest(backends, { isMobile });
    return {
      'activeBackend': picked?.id ?? null,
      apiKeys,
      'backendNote': picked === null
        ? null
        : savedBackend === null
          ? `backend auto-selected: ${picked.displayName}`
          : `saved preference "${savedBackend}" unavailable; defaulting to ${picked.displayName}`,
      backends,
      isMobile,
      noModel,
      preferredModels,
    };
  }

  async refreshBackends(
    request: DispatcherBrowserRefreshBackendsRequest,
  ): Promise<{ readonly backends: readonly BackendAvailability[]; readonly noModel: boolean }> {
    const runtime = await this.#loadProviderRuntimeDependency();
    const backends = await runtime.BackendMatrix.detect({
      'apiKeys': request.apiKeys,
      'preferredModels': request.preferredModels,
    });
    return {
      backends,
      'noModel': runtime.BackendMatrix.hasNoRunnableModel(backends, { 'isMobile': request.isMobile }),
    };
  }

  async saveApiKeys(apiKeys: Partial<Record<ProviderId, string>>): Promise<void> {
    const runtime = await this.#loadProviderRuntimeDependency();
    runtime.ApiKeyStore.save(apiKeys);
  }

  async savePreferredModels(models: Partial<Record<ProviderId, string>>): Promise<void> {
    const runtime = await this.#loadProviderRuntimeDependency();
    runtime.PreferredModels.save(models);
  }

  async resolveProviderId(id: string): Promise<ProviderId | null> {
    const runtime = await this.#loadProviderRuntimeDependency();
    return runtime.ApiKeyStore.isProviderId(id) ? id : null;
  }

  async warmBackend(request: DispatcherBrowserWarmBackendRequest): Promise<void> {
    if (request.activeBackend === null) throw new Error('no backend selected');
    const runtime = await this.#loadProviderRuntimeDependency();
    const client = await runtime.ProviderInstantiator.instantiate(request.activeBackend, {
      'apiKeys': request.apiKeys,
      'model':   request.model,
    });
    if (!(client instanceof runtime.BaseLlmClient)) {
      throw new Error('unexpected client type');
    }
    const llmClient = await createLlmClient(client.adapter, { 'language': request.language });
    await llmClient.warm();
  }

  async buildServices(
    request: DispatcherBrowserBuildServicesRequest,
  ): Promise<DispatcherServices> {
    if (request.activeBackend === null) throw new Error('no backend selected');
    const runtime = await this.#loadProviderRuntimeDependency();
    const client = await runtime.ProviderInstantiator.instantiate(request.activeBackend, {
      'apiKeys': request.apiKeys,
      'model':   request.model,
    });
    if (!(client instanceof runtime.BaseLlmClient)) {
      throw new Error('unexpected client type');
    }
    if (this.#intentProvider === null) {
      this.#intentProvider = new DispatcherBrowserIntentProvider(
        this.#ensureIntentClassifierDependency,
        {
          'transformersLocalModelPath': `${request.baseUrl}@transformers-embedder/models/`,
          'transformersWasmPaths': `${request.baseUrl}@transformers-embedder/ort/`,
        },
      );
    }
    return {
      'intent': this.#intentProvider,
      'llm': await createLlmClient(client.adapter, { 'language': request.language }),
    };
  }

  private static dependencies(): DispatcherBrowserRuntimeDependencies {
    return {
      'ensureIntentClassifier': DispatcherBrowserRuntime.ensureIntentClassifier,
      'loadProviderRuntime':    DispatcherBrowserRuntime.loadProviderRuntime,
    };
  }

  private static async loadProviderRuntime(): ReturnType<typeof DispatcherProviderRuntime.load> {
    const runtimeModule = await import('./DispatcherProviderRuntime.ts');
    return runtimeModule.DispatcherProviderRuntime.load();
  }

  private static async ensureIntentClassifier(
    options: EmbedderProvisionOptionsType,
  ): Promise<DispatcherIntentClassifier> {
    const [provisionerModule, classifierModule] = await Promise.all([
      import('./DispatcherEmbedderProvisioner.ts'),
      import('../providers/DispatcherIntentClassifier.ts'),
    ]);
    const embedder = await provisionerModule.DispatcherEmbedderProvisioner.provision(options);
    return classifierModule.DispatcherIntentClassifier.create(embedder);
  }
}
