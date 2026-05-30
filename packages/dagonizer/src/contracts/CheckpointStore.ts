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
export interface CheckpointStore {
  /**
   * Persist `json` under `key`. Implementations overwrite existing
   * entries with the same key.
   */
  save(key: string, json: string): Promise<void>;

  /**
   * Read the JSON stored under `key`, or `null` when no entry exists.
   */
  load(key: string): Promise<string | null>;

  /**
   * Remove the entry under `key`. No-op when no entry exists.
   */
  delete(key: string): Promise<void>;
}
