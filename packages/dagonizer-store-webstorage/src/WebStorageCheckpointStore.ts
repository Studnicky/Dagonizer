/**
 * WebStorageCheckpointStore: CheckpointStoreInterface backed by the Web
 * Storage API (localStorage or sessionStorage).
 *
 * Stores checkpoint JSON strings by key under a configurable `keyPrefix`.
 * No JSON parsing — the codec keeps strings as-is per the CheckpointStoreInterface
 * contract (which accepts and returns raw JSON strings).
 *
 * Quota: same ~5 MB ceiling as WebStorageStore. Suitable for small checkpoints.
 * A `setItem` QuotaExceededError throws `StoreError` and never escapes uncaught.
 *
 * Static factories `WebStorageCheckpointStore.local()` and `.session()` reach
 * `globalThis.localStorage` / `globalThis.sessionStorage` via
 * `Reflect.get(globalThis, name)` and narrow via `WebStorage.is` — no `as` cast,
 * no DOM lib.
 */

import type { CheckpointStoreInterface } from '@studnicky/dagonizer/contracts';
import { StoreError } from '@studnicky/dagonizer/store';

import type { StorageLikeInterface } from './WebStorageStore.js';
import { WebStorage } from './WebStorageStore.js';

// ---------------------------------------------------------------------------
// WebStorageCheckpointStoreOptionsType and defaults
// ---------------------------------------------------------------------------

type WebStorageCheckpointStoreOptionsType = {
  /**
   * Storage-level key prefix scoping checkpoint entries in the shared origin
   * keyspace. Default: `'dagonizer:ckpt:'`.
   */
  readonly keyPrefix?: string;
};

const WEB_STORAGE_CHECKPOINT_DEFAULTS: Required<WebStorageCheckpointStoreOptionsType> = {
  'keyPrefix': 'dagonizer:ckpt:',
};

// ---------------------------------------------------------------------------
// WebStorageCheckpointStore
// ---------------------------------------------------------------------------

export class WebStorageCheckpointStore implements CheckpointStoreInterface {
  readonly #storage: StorageLikeInterface;
  readonly #keyPrefix: string;

  /**
   * Construct with an injected `StorageLikeInterface`.
   *
   * Prefer the static factories `WebStorageCheckpointStore.local()` and
   * `WebStorageCheckpointStore.session()` in a browser environment. Inject
   * a test double in unit tests.
   */
  constructor(storage: StorageLikeInterface, options: WebStorageCheckpointStoreOptionsType = {}) {
    const resolved   = { ...WEB_STORAGE_CHECKPOINT_DEFAULTS, ...options };
    this.#storage    = storage;
    this.#keyPrefix  = resolved.keyPrefix;
  }

  // ── Static factories ─────────────────────────────────────────────────────

  /**
   * Create a `WebStorageCheckpointStore` backed by `globalThis.localStorage`.
   * Throws `StoreError` when `localStorage` is not available.
   */
  static local(options?: WebStorageCheckpointStoreOptionsType): WebStorageCheckpointStore {
    return new WebStorageCheckpointStore(WebStorage.resolve('localStorage'), options);
  }

  /**
   * Create a `WebStorageCheckpointStore` backed by `globalThis.sessionStorage`.
   * Throws `StoreError` when `sessionStorage` is not available.
   * Data is cleared when the browser tab is closed.
   */
  static session(options?: WebStorageCheckpointStoreOptionsType): WebStorageCheckpointStore {
    return new WebStorageCheckpointStore(WebStorage.resolve('sessionStorage'), options);
  }

  // ── CheckpointStoreInterface ─────────────────────────────────────────────

  async save(key: string, json: string): Promise<void> {
    const prefixed = this.#prefixed(key);
    try {
      this.#storage.setItem(prefixed, json);
    } catch (err) {
      if (err instanceof Error && err.name === 'QuotaExceededError') {
        throw new StoreError(
          `Web Storage quota exceeded saving checkpoint "${prefixed}"`,
          { 'reason': 'BACKING_ERROR', 'cause': err },
        );
      }
      throw err;
    }
  }

  async load(key: string): Promise<string | null> {
    return this.#storage.getItem(this.#prefixed(key));
  }

  async delete(key: string): Promise<void> {
    this.#storage.removeItem(this.#prefixed(key));
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  #prefixed(key: string): string {
    return `${this.#keyPrefix}${key}`;
  }
}
