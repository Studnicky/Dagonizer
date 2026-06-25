/**
 * OpfsEnv: accesses navigator.storage.getDirectory() via Reflect.get
 * without DOM lib or `as unknown as` casts.
 *
 * Narrowing is done with type-predicate guards (`noun.is(...)`), mirroring
 * `PluginLoader.isPlugin` in the core package. Each guard checks structure at
 * runtime and returns a type predicate, so the use site narrows cast-free.
 * The only `as` permitted is the `(value as Record<string, unknown>)` index
 * access INSIDE a guard body — the sanctioned idiom from PluginLoader.
 *
 * Static class — noun.verb(). No freestanding helpers.
 */

import { StoreError } from '@studnicky/dagonizer/store';

import type { DirectoryHandleLikeInterface } from './OpfsTypes.js';

/**
 * Structural shape of a storage manager that exposes `getDirectory()`.
 * Narrowed to via the `OpfsEnv.hasGetDirectory` guard so the call is cast-free.
 */
interface GetDirectoryLikeInterface {
  getDirectory(): Promise<unknown>;
}

export class OpfsEnv {
  private constructor() { /* static class */ }

  /** Non-null object guard. */
  private static isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  /**
   * Type-guard: narrows unknown → GetDirectoryLikeInterface via structural check.
   * Mirrors `PluginLoader.isPlugin` — `(value as Record<string, unknown>)['name']`
   * indexing inside the guard body is the sanctioned narrowing idiom.
   */
  static hasGetDirectory(value: unknown): value is GetDirectoryLikeInterface {
    return (
      OpfsEnv.isObject(value) &&
      'getDirectory' in value &&
      typeof (value as Record<string, unknown>)['getDirectory'] === 'function'
    );
  }

  /**
   * Type-guard: narrows unknown → DirectoryHandleLikeInterface via structural
   * check of all four required callable methods. Mirrors `PluginLoader.isPlugin`.
   */
  static isDirectoryHandle(value: unknown): value is DirectoryHandleLikeInterface {
    if (!OpfsEnv.isObject(value)) return false;
    return (
      typeof (value as Record<string, unknown>)['getFileHandle'] === 'function' &&
      typeof (value as Record<string, unknown>)['removeEntry'] === 'function' &&
      typeof (value as Record<string, unknown>)['getDirectoryHandle'] === 'function' &&
      typeof (value as Record<string, unknown>)['entries'] === 'function'
    );
  }

  /**
   * Resolves the OPFS root directory handle via navigator.storage.getDirectory().
   * Narrows through Reflect.get + type-predicate guards at each step; throws
   * StoreError('BACKING_ERROR') on any missing or wrong-shape step. No
   * `as unknown as` casts — the guards narrow cast-free at every use site.
   */
  static async rootDirectory(): Promise<DirectoryHandleLikeInterface> {
    const nav: unknown = Reflect.get(globalThis, 'navigator');
    if (!OpfsEnv.isObject(nav)) {
      throw new StoreError(
        'navigator is not available — OpfsStore requires a browser or compatible context',
        { 'reason': 'BACKING_ERROR', 'cause': new Error('navigator unavailable') },
      );
    }
    const storage: unknown = Reflect.get(nav, 'storage');
    if (!OpfsEnv.hasGetDirectory(storage)) {
      throw new StoreError(
        'navigator.storage.getDirectory is not available',
        { 'reason': 'BACKING_ERROR', 'cause': new Error('navigator.storage.getDirectory unavailable') },
      );
    }
    // `storage` is now narrowed to GetDirectoryLikeInterface — cast-free call.
    const rawDir: unknown = await storage.getDirectory();
    if (!OpfsEnv.isDirectoryHandle(rawDir)) {
      throw new StoreError(
        'navigator.storage.getDirectory() did not return a DirectoryHandle-shaped object',
        { 'reason': 'BACKING_ERROR', 'cause': new Error('getDirectory returned non-DirectoryHandle') },
      );
    }
    // `rawDir` is now narrowed to DirectoryHandleLikeInterface — returned cast-free.
    return rawDir;
  }
}
