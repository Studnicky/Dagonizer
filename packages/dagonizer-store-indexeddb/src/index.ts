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
} from './IdbTypes.js';
export { IdbFactory, IdbRequest } from './IdbTypes.js';
