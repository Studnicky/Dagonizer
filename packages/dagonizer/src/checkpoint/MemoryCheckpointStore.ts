/**
 * MemoryCheckpointStore: in-process `CheckpointStoreInterface`.
 *
 * Stores entries in a bounded `LruCache<string, string>` on the instance.
 * Useful for tests, examples, and ephemeral demo flows. Not for production:
 * the cache vanishes when the process exits.
 *
 * `CheckpointStoreInterface.save/load/delete` are async by contract (real
 * backends are I/O-bound); `LruCache` is a synchronous in-process primitive.
 * This class adapts the two: it holds one `LruCache` instance directly (no
 * reimplemented eviction logic) and exposes the async interface shape the
 * contract requires.
 */

import { LruCache } from '@studnicky/cache';

import type { AbortableOptionsType } from '../contracts/AbortableOptionsType.js';
import type { CheckpointStoreInterface } from '../contracts/CheckpointStoreInterface.js';

/**
 * Default capacity (max distinct checkpoint keys) before the
 * least-recently-used entry is evicted to make room for a new one.
 */
export const DEFAULT_CHECKPOINT_CAPACITY = 500;

/**
 * Module-level defaults for `MemoryCheckpointStoreOptionsType`, following the
 * codebase `*_DEFAULTS` constant convention (cf. `DAG_CONTAINER_DEFAULTS`).
 */
export const MEMORY_CHECKPOINT_STORE_DEFAULTS = {
  'capacity': DEFAULT_CHECKPOINT_CAPACITY,
} as const;

export type MemoryCheckpointStoreOptionsType = {
  /**
   * Maximum number of distinct checkpoint keys retained before the
   * least-recently-used entry is evicted. Defaults to
   * `DEFAULT_CHECKPOINT_CAPACITY` (500) — enough headroom for a long-running
   * demo/test process performing many resumable executions without unbounded
   * memory growth. Override for a workload with a larger or smaller working
   * set of concurrently resumable checkpoints.
   */
  capacity?: number;
}

export class MemoryCheckpointStore implements CheckpointStoreInterface {
  readonly #cache: LruCache<string, string>;

  /**
   * Ergonomic spread defaults for `MemoryCheckpointStoreOptionsType`. Sources
   * from the module-level `MEMORY_CHECKPOINT_STORE_DEFAULTS` constant.
   */
  static readonly defaultOptions: Required<MemoryCheckpointStoreOptionsType> =
    MEMORY_CHECKPOINT_STORE_DEFAULTS;

  constructor(options: MemoryCheckpointStoreOptionsType = {}) {
    const { capacity } = { ...MEMORY_CHECKPOINT_STORE_DEFAULTS, ...options };
    this.#cache = LruCache.create<string, string>({ 'capacity': capacity });
  }

  async save(key: string, json: string, _options?: AbortableOptionsType): Promise<void> {
    this.#cache.set(key, json);
  }

  async load(key: string, _options?: AbortableOptionsType): Promise<string | null> {
    return this.#cache.get(key) ?? null;
  }

  async delete(key: string, _options?: AbortableOptionsType): Promise<void> {
    this.#cache.delete(key);
  }

  /** Number of entries currently held. Test-only convenience. */
  get size(): number {
    return this.#cache.size;
  }
}
