import type { Component } from 'vue';

export type RunnableExampleId = 'archivist' | 'cartographer' | 'dispatcher';

interface DeleteDatabaseRequestLike {
  error?: unknown;
  onblocked: (() => void) | null;
  onerror: (() => void) | null;
  onsuccess: (() => void) | null;
}

interface IndexedDbLike {
  deleteDatabase(name: string): DeleteDatabaseRequestLike;
}

interface StorageLike {
  removeItem(key: string): void;
}

interface BrowserPersistenceLike {
  indexedDB?: IndexedDbLike;
  localStorage?: StorageLike;
  sessionStorage?: StorageLike;
}

type RunnableExampleModule = { readonly default: Component };

type StandaloneRunnerProps = Readonly<Record<string, unknown>>;

const SHARED_STORAGE_KEYS = [
  'dagonizer-active-backend',
  'dagonizer-api-keys',
  'dagonizer-device-override',
  'dagonizer-preferred-models',
] as const;

const EXAMPLE_STORAGE_KEYS: Readonly<Record<RunnableExampleId, readonly string[]>> = {
  'archivist': ['dagonizer-archivist-checkpoint'],
  'cartographer': [],
  'dispatcher': [],
};

const SHARED_INDEXED_DB_NAMES = [
  'dagonizer',
  'dagonizer-checkpoints',
  'dagonizer-fold-journal',
  'dagonizer-graph-journal',
] as const;

const RUNNABLE_EXAMPLE_LOADERS: Readonly<Record<RunnableExampleId, () => Promise<RunnableExampleModule>>> = {
  'archivist': async () => await import('../the-archivist/app/ArchivistRunner.vue'),
  'cartographer': async () => await import('../the-cartographer/app/CartographerRunner.vue'),
  'dispatcher': async () => await import('../the-dispatcher/app/DispatcherRunner.vue'),
};

const STANDALONE_RUNNER_PROPS: Readonly<Record<RunnableExampleId, (searchParams: URLSearchParams) => StandaloneRunnerProps>> = {
  'archivist': (searchParams) => ({
    'apiKey':      searchParams.get('apiKey') ?? '',
    'lang':        searchParams.get('lang') ?? '',
    'park':        searchParams.has('park'),
    'webLlmModel': searchParams.get('webLlmModel') ?? '',
  }),
  'cartographer': () => ({}),
  'dispatcher': () => ({}),
};

function deleteStorageKeys(store: StorageLike | undefined, keys: readonly string[]): void {
  if (store === undefined) return;
  for (const key of keys) {
    store.removeItem(key);
  }
}

function deleteIndexedDb(factory: IndexedDbLike | undefined, name: string): Promise<void> {
  if (factory === undefined) {
    return Promise.resolve();
  }

  try {
    return new Promise((resolve) => {
      const request = factory.deleteDatabase(name);
      const settle = () => resolve();
      request.onblocked = settle;
      request.onerror = settle;
      request.onsuccess = settle;
    });
  } catch {
    return Promise.resolve();
  }
}

export function storageKeysForExample(example: RunnableExampleId): readonly string[] {
  return [...SHARED_STORAGE_KEYS, ...EXAMPLE_STORAGE_KEYS[example]];
}

export function indexedDbNamesForExample(_example: RunnableExampleId): readonly string[] {
  return SHARED_INDEXED_DB_NAMES;
}

export async function loadRunnableExampleComponent(example: RunnableExampleId): Promise<Component> {
  return (await RUNNABLE_EXAMPLE_LOADERS[example]()).default;
}

export function standaloneRunnerPropsForExample(
  example: RunnableExampleId,
  searchParams: URLSearchParams,
): StandaloneRunnerProps {
  return STANDALONE_RUNNER_PROPS[example](searchParams);
}

export async function clearRunnableExampleContext(
  example: RunnableExampleId,
  persistence: BrowserPersistenceLike = globalThis as BrowserPersistenceLike,
): Promise<void> {
  const storageKeys = storageKeysForExample(example);

  deleteStorageKeys(persistence.localStorage, storageKeys);
  deleteStorageKeys(persistence.sessionStorage, storageKeys);

  await Promise.all(
    indexedDbNamesForExample(example).map(async (databaseName) => await deleteIndexedDb(persistence.indexedDB, databaseName)),
  );
}
