/**
 * IdbFactory: structural interfaces and boundary utilities for the IndexedDB API.
 *
 * No DOM lib. All shapes are defined structurally to match only the subset
 * of IndexedDB this package actually calls. Real browser `indexedDB` (and
 * `fake-indexeddb`'s `IDBFactory`) are structurally assignable to these
 * interfaces. Consumers never import DOM types — this file is the boundary.
 *
 * `IdbFactory.is(x)` narrows `unknown → IdbFactoryLikeInterface` via a
 * structural type-guard predicate. `isObject` narrows `x` to
 * `Record<string, unknown>` first; all subsequent checks use the narrowed
 * type — zero `as` casts anywhere.
 */

// ---------------------------------------------------------------------------
// IdbRequestLikeType
// ---------------------------------------------------------------------------

/**
 * Structural subset of IDBRequest<T>.
 * Covers the result/error properties and the two event handlers used by
 * `IdbRequest.toPromise()`.
 */
export type IdbRequestLikeType<T> = {
  result:    T;
  error:     unknown;
  onsuccess: (() => void) | null;
  onerror:   (() => void) | null;
};

// ---------------------------------------------------------------------------
// IdbOpenRequestLikeType
// ---------------------------------------------------------------------------

/**
 * Structural subset of IDBOpenDBRequest.
 * Extends the basic request with the `onupgradeneeded` hook and a `result`
 * typed as `IdbDatabaseLikeInterface`.
 */
export type IdbOpenRequestLikeType = IdbRequestLikeType<IdbDatabaseLikeInterface> & {
  onupgradeneeded: ((event: { target: IdbOpenRequestLikeType | null }) => void) | null;
};

// ---------------------------------------------------------------------------
// IdbCursorLikeInterface
// ---------------------------------------------------------------------------

/**
 * Structural subset of IDBCursorWithValue used by `openCursor()` iteration.
 * Each step exposes the current `key` and `value`, and advances via `continue()`.
 */
export interface IdbCursorLikeInterface {
  key:   unknown;
  value: unknown;
  continue(): void;
}

// ---------------------------------------------------------------------------
// IdbObjectStoreLikeInterface
// ---------------------------------------------------------------------------

/**
 * Structural subset of IDBObjectStore.
 * Covers the KV operations and cursor iteration used by IndexedDbStore.
 */
export interface IdbObjectStoreLikeInterface {
  get(key: string):                       IdbRequestLikeType<unknown>;
  put(value: unknown, key: string):       IdbRequestLikeType<unknown>;
  delete(key: string):                    IdbRequestLikeType<unknown>;
  count(key: string):                     IdbRequestLikeType<number>;
  clear():                                IdbRequestLikeType<unknown>;
  openCursor():                           IdbRequestLikeType<IdbCursorLikeInterface | null>;
}

// ---------------------------------------------------------------------------
// IdbTransactionLikeInterface
// ---------------------------------------------------------------------------

/**
 * Structural subset of IDBTransaction.
 * Only the `objectStore` accessor is needed; transaction commit is implicit
 * once all request promises resolve within the transaction lifetime.
 */
export interface IdbTransactionLikeInterface {
  objectStore(name: string): IdbObjectStoreLikeInterface;
}

// ---------------------------------------------------------------------------
// IdbDatabaseLikeInterface
// ---------------------------------------------------------------------------

/**
 * Structural subset of IDBDatabase.
 * Covers open-transaction, object-store creation, name lookup, and close.
 */
export interface IdbDatabaseLikeInterface {
  transaction(names: string | string[], mode: 'readonly' | 'readwrite'): IdbTransactionLikeInterface;
  // Quoted key: `createObjectStore` is the W3C IndexedDB platform method name,
  // fixed by the platform contract so a real `IDBDatabase` stays structurally
  // assignable here without a cast. The string-literal key denotes an
  // externally-dictated identifier (exempt from the noun.verb() verb gate).
  'createObjectStore'(name: string): unknown;
  objectStoreNames: { contains(name: string): boolean };
  close(): void;
}

// ---------------------------------------------------------------------------
// IdbFactoryLikeInterface
// ---------------------------------------------------------------------------

/**
 * Structural subset of IDBFactory (the `indexedDB` global).
 * Only `open` is needed.
 */
export interface IdbFactoryLikeInterface {
  open(name: string, version?: number): IdbOpenRequestLikeType;
}

// ---------------------------------------------------------------------------
// IdbFactory: type-predicate guard + Promise bridge
// ---------------------------------------------------------------------------

/**
 * Static utilities for the IDB factory boundary.
 *
 * `IdbFactory.is(x)` narrows `unknown → IdbFactoryLikeInterface` via a
 * structural type-guard predicate. `isObject` narrows `x` to
 * `Record<string, unknown>` first; the `typeof x['open']` check then
 * operates on the narrowed type — zero `as` casts.
 */
export class IdbFactory {
  private constructor() { /* static class */ }

  /** Non-null object guard: narrows unknown → Record<string, unknown>. */
  private static isObject(x: unknown): x is Record<string, unknown> {
    return typeof x === 'object' && x !== null;
  }

  /**
   * Structural type-guard: narrows `unknown → IdbFactoryLikeInterface`.
   *
   * Checks that `x` is a non-null object with a callable `open` method —
   * the only member of `IdbFactoryLikeInterface` that distinguishes it
   * from an arbitrary object. `isObject` narrows first; no `as` cast needed.
   */
  static is(x: unknown): x is IdbFactoryLikeInterface {
    if (!IdbFactory.isObject(x)) return false;
    return typeof x['open'] === 'function';
  }
}

// ---------------------------------------------------------------------------
// IdbRequest: Promise bridge
// ---------------------------------------------------------------------------

/**
 * Bridges the event-driven IDB request pattern to a `Promise`.
 *
 * Wires `onsuccess` → resolve and `onerror` → reject on any
 * `IdbRequestLikeInterface<T>`, returning a typed `Promise<T>`.
 */
export class IdbRequest {
  private constructor() { /* static class */ }

  /**
   * Convert an `IdbRequestLikeType<T>` to a `Promise<T>`.
   *
   * Wires `onsuccess` to `resolve(req.result)` and `onerror` to
   * `reject(req.error ?? new Error('IDB request failed'))`.
   */
  static toPromise<T>(req: IdbRequestLikeType<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      req.onsuccess = () => { resolve(req.result); };
      req.onerror   = () => { reject(req.error ?? new Error('IDB request failed')); };
    });
  }
}
