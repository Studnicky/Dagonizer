/**
 * CheckpointStore: adapter contract for persisting `CheckpointData` JSON.
 *
 * Dagonizer ships no production persistence backend. Consumers implement
 * this interface to put checkpoints in their store of choice (file, kv,
 * postgres, redis, s3). `ckpt.persist(store, key)` and
 * `Checkpoint.recall(store, key)` compose the store with the codec so
 * a typical save/resume cycle is one method call per side.
 *
 * Implementations are responsible for their own concurrency and retry
 * policy; the contract is intentionally minimal.
 */

import type { AbortableOptionsInterface } from './AbortableOptionsInterface.js';

export interface CheckpointStore {
  /**
   * Persist `json` under `key`. Implementations overwrite existing
   * entries with the same key. `options.signal` is available for
   * implementations that support cancellation (e.g. network-backed
   * stores); in-process implementations may ignore it.
   */
  save(key: string, json: string, options?: AbortableOptionsInterface): Promise<void>;

  /**
   * Read the JSON stored under `key`, or `null` when no entry exists.
   * `options.signal` is available for implementations that support
   * cancellation; in-process implementations may ignore it.
   */
  load(key: string, options?: AbortableOptionsInterface): Promise<string | null>;

  /**
   * Remove the entry under `key`. No-op when no entry exists.
   * `options.signal` is available for implementations that support
   * cancellation; in-process implementations may ignore it.
   */
  delete(key: string, options?: AbortableOptionsInterface): Promise<void>;
}
