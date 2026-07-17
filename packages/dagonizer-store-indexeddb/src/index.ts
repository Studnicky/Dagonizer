export { IndexedDbStore } from './IndexedDbStore.js';
export type { IndexedDbStoreOptionsType } from './IndexedDbStore.js';

export { IndexedDbCheckpointStore } from './IndexedDbCheckpointStore.js';
export type { IndexedDbCheckpointStoreOptionsType } from './IndexedDbCheckpointStore.js';

// Structural types and interfaces — consumers inject a custom factory by implementing these.
export type {
  IdbCursorLikeInterface,
  IdbDatabaseLikeInterface,
  IdbFactoryLikeInterface,
  IdbObjectStoreLikeInterface,
  IdbOpenRequestLikeType,
  IdbRequestLikeType,
  IdbTransactionLikeInterface,
} from './IdbFactory.js';
export { IdbFactory, IdbRequest } from './IdbFactory.js';
export { IndexedDbGraphDatasetProvider } from './IndexedDbGraphDatasetProvider.js';
export type { IndexedDbGraphDatasetProviderOptionsType } from './IndexedDbGraphDatasetProvider.js';
export { IndexedDbGraphJournalStore } from './IndexedDbGraphJournalStore.js';
export type { IndexedDbGraphJournalStoreOptionsType } from './IndexedDbGraphJournalStore.js';
export { IndexedDbFoldJournalStore } from './IndexedDbFoldJournalStore.js';
export type { IndexedDbFoldJournalStoreOptionsType } from './IndexedDbFoldJournalStore.js';
