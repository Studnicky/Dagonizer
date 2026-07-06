/**
 * OpfsStore: BaseStore implementation backed by the Origin Private File System.
 *
 * Snapshot type:    'opfs-store'
 * Snapshot version: 1
 *
 * One file per entry. Filenames are URI-encoded qualified keys plus a configurable
 * suffix (default '.json'). performEntriesStream() iterates the directory
 * handle's async entries iterator — native streaming, lazy I/O.
 *
 * update() serializes concurrent writes to the same key through one substrate
 * semaphore per qualified key so reads and writes for one key never interleave.
 *
 * The synchronous high-throughput path (createSyncAccessHandle) is Worker-only
 * and is not used here. The async createWritable path works on the main thread.
 *
 * Real-OPFS smoke testing is deferred to the S3 browser harness. Unit tests
 * run against an in-memory DirectoryHandleLikeInterface double.
 */

import { Semaphore } from '@studnicky/concurrency/semaphore';
import type { StoreSnapshotEntryType } from '@studnicky/dagonizer/contracts';
import { JsonValue } from '@studnicky/dagonizer/entities';
import type { JsonValueType } from '@studnicky/dagonizer/entities';
import { BASE_STORE_DEFAULTS, BaseStore, StoreError } from '@studnicky/dagonizer/store';
import type { BaseStoreOptionsType } from '@studnicky/dagonizer/store';

import { OpfsEnv } from './OpfsEnv.js';
import type { DirectoryHandleLikeInterface, FileHandleLikeInterface } from './OpfsHandle.js';

export type OpfsStoreOptionsType = BaseStoreOptionsType & {
  /** File suffix appended to the URI-encoded key filename. Default: '.json'. */
  readonly fileSuffix?: string;
};

const OPFS_STORE_DEFAULTS = {
  ...BASE_STORE_DEFAULTS,
  'fileSuffix': '.json',
} as const;

/** Encodes/decodes qualified keys to/from safe filenames. */
class OpfsKey {
  private constructor() { /* static class */ }

  static encode(key: string, suffix: string): string {
    return `${encodeURIComponent(key)}${suffix}`;
  }

  static decode(name: string, suffix: string): string {
    return decodeURIComponent(name.slice(0, name.length - suffix.length));
  }

  static hasSuffix(name: string, suffix: string): boolean {
    return name.endsWith(suffix);
  }
}

export class OpfsStore extends BaseStore {
  readonly #directory: DirectoryHandleLikeInterface;
  readonly #fileSuffix: string;
  readonly #updateLocks: Map<string, Semaphore>;

  constructor(directory: DirectoryHandleLikeInterface, options: OpfsStoreOptionsType = {}) {
    super(options);
    const resolved = { ...OPFS_STORE_DEFAULTS, ...options };
    this.#directory = directory;
    this.#fileSuffix = resolved.fileSuffix;
    this.#updateLocks = new Map();
  }

  /**
   * Resolves the OPFS root, then gets (or creates) a subdirectory named
   * `dirName` to use as the store's backing directory.
   */
  static async rooted(dirName: string, options: OpfsStoreOptionsType = {}): Promise<OpfsStore> {
    const root = await OpfsEnv.rootDirectory();
    const dir = await root.getDirectoryHandle(dirName, { 'create': true });
    return new OpfsStore(dir, options);
  }

  protected get snapshotType(): string    { return 'opfs-store'; }
  protected get snapshotVersion(): number { return 1; }

  // ── perform* hooks ─────────────────────────────────────────────────

  protected async performGet(qualifiedKey: string): Promise<JsonValueType | null> {
    const name = OpfsKey.encode(qualifiedKey, this.#fileSuffix);
    let handle: FileHandleLikeInterface;
    try {
      handle = await this.#directory.getFileHandle(name);
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFoundError') return null;
      throw err;
    }
    const file = await handle.getFile();
    const text = await file.text();
    return JsonValue.from(JSON.parse(text));
  }

  protected async performSet(qualifiedKey: string, value: JsonValueType): Promise<void> {
    const name = OpfsKey.encode(qualifiedKey, this.#fileSuffix);
    const handle = await this.#directory.getFileHandle(name, { 'create': true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(value));
    await writable.close();
  }

  protected async performHas(qualifiedKey: string): Promise<boolean> {
    const name = OpfsKey.encode(qualifiedKey, this.#fileSuffix);
    try {
      await this.#directory.getFileHandle(name);
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFoundError') return false;
      throw err;
    }
  }

  protected async performDelete(qualifiedKey: string): Promise<boolean> {
    const name = OpfsKey.encode(qualifiedKey, this.#fileSuffix);
    try {
      await this.#directory.removeEntry(name);
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFoundError') return false;
      throw err;
    }
  }

  protected async *performEntriesStream(): AsyncIterable<StoreSnapshotEntryType> {
    for await (const [name, handle] of this.#directory.entries()) {
      if (!OpfsKey.hasSuffix(name, this.#fileSuffix)) continue;
      const key = OpfsKey.decode(name, this.#fileSuffix);
      const file = await handle.getFile();
      const text = await file.text();
      yield { 'key': key, 'value': JsonValue.from(JSON.parse(text)) };
    }
  }

  protected async performRestoreEntry(entry: StoreSnapshotEntryType): Promise<void> {
    await this.performSet(entry.key, entry.value);
  }

  protected async performClear(): Promise<void> {
    const names: string[] = [];
    for await (const [name] of this.#directory.entries()) {
      names.push(name);
    }
    for (const name of names) {
      await this.#directory.removeEntry(name);
    }
  }

  /**
   * Per-key serialized update. Each qualified key owns a single-permit
   * semaphore while it has active or queued updates. This is structural
   * serialization, not a native transaction, and serializes within one process
   * only.
   */
  override async update(
    key: string,
    fn: (current: JsonValueType | undefined) => JsonValueType,
  ): Promise<JsonValueType> {
    const qualified = this.qualifyKey(key);
    let lock = this.#updateLocks.get(qualified);
    if (lock === undefined) {
      lock = Semaphore.create({ 'permits': 1 });
      this.#updateLocks.set(qualified, lock);
    }

    try {
      const value = await lock.withPermit(async () => {
        const raw = await this.performGet(qualified);
        const current = raw === null ? undefined : raw;
        const value = fn(current);
        await this.performSet(qualified, value);
        return value;
      });

      if (value === undefined) {
        throw new StoreError(
          'update fn produced no value',
          { 'reason': 'BACKING_ERROR', 'cause': new Error('update produced no value') },
        );
      }
      return value;
    } finally {
      if (lock.available === lock.permits && this.#updateLocks.get(qualified) === lock) {
        this.#updateLocks.delete(qualified);
      }
    }
  }
}
