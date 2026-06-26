/**
 * OpfsEnv: accesses navigator.storage.getDirectory() via Reflect.get
 * without DOM lib or `as` casts.
 *
 * Narrowing is done with type-predicate guards (`noun.is(...)`). Each guard
 * checks structure at runtime and returns a type predicate, so the use site
 * narrows cast-free. The `isObject` guard narrows `unknown` to
 * `Record<string, unknown>` first; subsequent property-type checks use that
 * already-narrowed type directly — zero `as` casts anywhere.
 *
 * Static class — noun.verb(). No freestanding helpers.
 */

import { StoreError } from '@studnicky/dagonizer/store';

import type { DirectoryHandleLikeInterface } from './OpfsHandle.js';

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
   * `isObject` narrows `value` to `Record<string, unknown>` first; the
   * `typeof value['getDirectory']` check then operates on the narrowed type,
   * no `as` cast required.
   */
  static hasGetDirectory(value: unknown): value is GetDirectoryLikeInterface {
    if (!OpfsEnv.isObject(value)) return false;
    return typeof value['getDirectory'] === 'function';
  }

  /**
   * Type-guard: narrows unknown → DirectoryHandleLikeInterface via structural
   * check of all four required callable methods. `isObject` narrows first;
   * all subsequent checks operate on the `Record<string, unknown>` type.
   */
  static isDirectoryHandle(value: unknown): value is DirectoryHandleLikeInterface {
    if (!OpfsEnv.isObject(value)) return false;
    return (
      typeof value['getFileHandle'] === 'function' &&
      typeof value['removeEntry'] === 'function' &&
      typeof value['getDirectoryHandle'] === 'function' &&
      typeof value['entries'] === 'function'
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
