/**
 * WebStorageStore: BaseStore implementation backed by the Web Storage API
 * (localStorage or sessionStorage).
 *
 * Snapshot type:    'web-storage-store'
 * Snapshot version: 1
 *
 * Browser global access: localStorage / sessionStorage are reached via
 * `Reflect.get(globalThis, 'localStorage')` / `'sessionStorage'`, which
 * returns `unknown`. A structural type guard (`WebStorage.is`) narrows the
 * result without any `as` cast. On failure a `StoreError` is thrown.
 *
 * Prefixing: every key is stored under the combined prefix
 * `<keyPrefix><qualifiedKey>` where `qualifiedKey` is already namespace-
 * qualified by BaseStore. For example, with `keyPrefix: 'dagonizer:'` and
 * `namespace: 'run-1'`, the key `'counter'` is stored as
 * `'dagonizer:run-1:counter'`. This two-tier scheme means:
 *   • `keyPrefix`  — storage-level isolation (scopes this store in the
 *                    shared origin keyspace, preventing collisions with
 *                    other app code or other Dagonizer stores).
 *   • `namespace`  — BaseStore's own qualifier (scopes keys inside one
 *                    WebStorageStore instance).
 *
 * Ceiling: Web Storage is synchronous and flat (no cursor, no lazy I/O).
 * `performEntriesStream` satisfies the streaming SHAPE but loads all keys
 * in one synchronous pass over `storage.length`. This tier is small-store
 * (~5 MB quota). Do not use it for large keyspaces.
 *
 * `update(key, fn)`: the Web Storage backend is synchronous — there is no
 * interleaved await between the read and the write, so the read-modify-write
 * is inherently atomic within a single call. It is NOT safe across concurrent
 * callers in separate tasks (no locking mechanism exists in Web Storage).
 * Document this at call sites if concurrent updates are possible.
 */

import type { StoreSnapshotEntryType } from '@studnicky/dagonizer/contracts';
import { JsonValue } from '@studnicky/dagonizer/entities';
import type { JsonValueType } from '@studnicky/dagonizer/entities';
import { BASE_STORE_DEFAULTS, BaseStore, StoreError } from '@studnicky/dagonizer/store';
import type { BaseStoreOptionsType } from '@studnicky/dagonizer/store';

// ---------------------------------------------------------------------------
// StorageLikeInterface — minimal structural contract for the Web Storage API
// ---------------------------------------------------------------------------

/**
 * Minimal structural contract for the Web Storage API.
 *
 * A real `localStorage` or `sessionStorage` is structurally assignable here
 * (both expose these members). Define a class implementing this interface to
 * inject a test double without DOM globals.
 */
export interface StorageLikeInterface {
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
}

// ---------------------------------------------------------------------------
// WebStorageStoreOptionsType and defaults
// ---------------------------------------------------------------------------

export type WebStorageStoreOptionsType = BaseStoreOptionsType & {
  /**
   * Storage-level key prefix applied to every key this store writes.
   * Scopes this store's keys inside the shared origin keyspace so multiple
   * stores — or other app code — never collide. Default: `'dagonizer:'`.
   */
  readonly keyPrefix?: string;
};

/** Default options. Spread into custom options to fill unset fields. */
const WEB_STORAGE_STORE_DEFAULTS: Required<WebStorageStoreOptionsType> = {
  ...BASE_STORE_DEFAULTS,
  'keyPrefix': 'dagonizer:',
};

// ---------------------------------------------------------------------------
// WebStorage — static class for global access and structural narrowing
// ---------------------------------------------------------------------------

/**
 * Static helpers for reaching Web Storage globals.
 *
 * Globals are accessed via `Reflect.get(globalThis, name)` (returns `unknown`,
 * no DOM-lib dependency, no `as` cast). The structural type guard checks that
 * the required methods are present and `length` is a number before trusting
 * the value.
 */
export class WebStorage {
  private constructor() { /* static class */ }

  /**
   * Structural type guard. Returns true when `x` has the minimal shape of
   * the Web Storage API. A real `localStorage` / `sessionStorage` satisfies
   * this without any cast at the consumer's call site.
   */
  static is(x: unknown): x is StorageLikeInterface {
    if (x === null || x === undefined || typeof x !== 'object') return false;
    const obj = x as Record<string, unknown>;
    return (
      typeof obj['getItem']    === 'function' &&
      typeof obj['setItem']    === 'function' &&
      typeof obj['removeItem'] === 'function' &&
      typeof obj['key']        === 'function' &&
      typeof obj['length']     === 'number'
    );
  }

  /**
   * Reach a named Web Storage global (`'localStorage'` or `'sessionStorage'`)
   * and narrow it via `WebStorage.is`. Throws `StoreError` when the global is
   * absent (non-browser context) or has an unexpected shape.
   */
  static resolve(globalName: string): StorageLikeInterface {
    const raw: unknown = Reflect.get(globalThis, globalName);
    if (!WebStorage.is(raw)) {
      throw new StoreError(
        `${globalName} is not available in this environment`,
        { 'reason': 'BACKING_ERROR', 'cause': new Error(`${globalName} unavailable`) },
      );
    }
    return raw;
  }
}

// ---------------------------------------------------------------------------
// WebStorageStore
// ---------------------------------------------------------------------------

export class WebStorageStore extends BaseStore {
  readonly #storage: StorageLikeInterface;
  readonly #keyPrefix: string;

  /**
   * Construct a WebStorageStore with an injected `StorageLikeInterface`.
   *
   * Prefer the static factories `WebStorageStore.local()` and
   * `WebStorageStore.session()` in a browser environment. Inject a test
   * double directly in unit tests.
   */
  constructor(storage: StorageLikeInterface, options: WebStorageStoreOptionsType = {}) {
    const resolved = { ...WEB_STORAGE_STORE_DEFAULTS, ...options };
    super(resolved);
    this.#storage  = storage;
    this.#keyPrefix = resolved.keyPrefix;
  }

  // ── Static factories ─────────────────────────────────────────────────────

  /**
   * Create a `WebStorageStore` backed by `globalThis.localStorage`.
   * Throws `StoreError` when `localStorage` is not available.
   */
  static local(options?: WebStorageStoreOptionsType): WebStorageStore {
    return new WebStorageStore(WebStorage.resolve('localStorage'), options);
  }

  /**
   * Create a `WebStorageStore` backed by `globalThis.sessionStorage`.
   * Throws `StoreError` when `sessionStorage` is not available.
   * Data is cleared when the browser tab is closed.
   */
  static session(options?: WebStorageStoreOptionsType): WebStorageStore {
    return new WebStorageStore(WebStorage.resolve('sessionStorage'), options);
  }

  // ── Snapshot identity ────────────────────────────────────────────────────

  protected get snapshotType(): string    { return 'web-storage-store'; }
  protected get snapshotVersion(): number { return 1; }

  // ── update ───────────────────────────────────────────────────────────────

  /**
   * Synchronous read-modify-write.
   *
   * Web Storage is synchronous — there is no `await` between the read and the
   * write, so the operation is atomic within this call. It is NOT safe across
   * independently scheduled concurrent tasks (Web Storage has no locking
   * mechanism). For concurrent workloads use a transactional store
   * (e.g. `dagonizer-store-indexeddb`).
   */
  override async update(
    key: string,
    fn: (current: JsonValueType | undefined) => JsonValueType,
  ): Promise<JsonValueType> {
    const prefixedKey = this.#prefixed(this.qualifyKey(key));
    const raw         = this.#storage.getItem(prefixedKey);
    const current     = raw !== null ? JsonValue.from(JSON.parse(raw)) : undefined;
    const next        = fn(current);
    this.#safeSetItem(prefixedKey, JSON.stringify(next));
    return next;
  }

  // ── perform* hooks ───────────────────────────────────────────────────────

  protected async performGet(qualifiedKey: string): Promise<JsonValueType | null> {
    const raw = this.#storage.getItem(this.#prefixed(qualifiedKey));
    if (raw === null) return null;
    return JsonValue.from(JSON.parse(raw));
  }

  protected async performSet(qualifiedKey: string, value: JsonValueType): Promise<void> {
    this.#safeSetItem(this.#prefixed(qualifiedKey), JSON.stringify(value));
  }

  protected async performHas(qualifiedKey: string): Promise<boolean> {
    return this.#storage.getItem(this.#prefixed(qualifiedKey)) !== null;
  }

  protected async performDelete(qualifiedKey: string): Promise<boolean> {
    const prefixed = this.#prefixed(qualifiedKey);
    if (this.#storage.getItem(prefixed) === null) return false;
    this.#storage.removeItem(prefixed);
    return true;
  }

  /**
   * Yield every entry stored under `keyPrefix` as an async stream.
   *
   * Web Storage is synchronous — the iteration is a single pass over
   * `storage.length`. The generator satisfies the streaming SHAPE but is not
   * lazy I/O; it is acceptable because this adapter is small-store only
   * (~5 MB quota). Keys belonging to other prefixes are skipped.
   *
   * Entries are yielded with the prefix stripped, matching the qualified key
   * form that BaseStore expects (namespace-prefixed, but storage-prefix-free).
   */
  protected async *performEntriesStream(): AsyncIterable<StoreSnapshotEntryType> {
    // Collect keys first to avoid index-shift issues during removal.
    const length = this.#storage.length;
    const prefixedKeys: string[] = [];
    for (let i = 0; i < length; i++) {
      const k = this.#storage.key(i);
      if (k !== null && k.startsWith(this.#keyPrefix)) {
        prefixedKeys.push(k);
      }
    }

    for (const prefixedKey of prefixedKeys) {
      const raw = this.#storage.getItem(prefixedKey);
      if (raw === null) continue;
      // Strip the keyPrefix to yield the qualified key (namespace-qualified form).
      const qualifiedKey = prefixedKey.slice(this.#keyPrefix.length);
      yield { 'key': qualifiedKey, 'value': JsonValue.from(JSON.parse(raw)) };
    }
  }

  protected async performRestoreEntry(entry: StoreSnapshotEntryType): Promise<void> {
    this.#safeSetItem(this.#prefixed(entry.key), JSON.stringify(entry.value));
  }

  protected async performClear(): Promise<void> {
    // Collect all matching keys first to avoid index-shift bugs while removing.
    const length = this.#storage.length;
    const toRemove: string[] = [];
    for (let i = 0; i < length; i++) {
      const k = this.#storage.key(i);
      if (k !== null && k.startsWith(this.#keyPrefix)) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) {
      this.#storage.removeItem(k);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Apply the storage-level keyPrefix to an already-qualified key. */
  #prefixed(qualifiedKey: string): string {
    return `${this.#keyPrefix}${qualifiedKey}`;
  }

  /**
   * Wrap `storage.setItem` and rethrow `QuotaExceededError` as `StoreError`.
   * Raw DOM errors are never allowed to escape this package uncaught.
   */
  #safeSetItem(prefixedKey: string, serialized: string): void {
    try {
      this.#storage.setItem(prefixedKey, serialized);
    } catch (err) {
      if (err instanceof Error && err.name === 'QuotaExceededError') {
        throw new StoreError(
          `Web Storage quota exceeded writing key "${prefixedKey}"`,
          { 'reason': 'BACKING_ERROR', 'cause': err },
        );
      }
      throw err;
    }
  }
}
