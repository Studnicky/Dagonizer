/**
 * OpfsCheckpointStore: CheckpointStoreInterface backed by OPFS.
 *
 * Each checkpoint is stored as a raw JSON string in its own file under a
 * dedicated 'checkpoints' subdirectory of the provided OPFS directory handle.
 * Filenames: encodeURIComponent(key) + '.json'.
 * No JSON parsing — strings in, strings out; the codec stays with the caller.
 */

import type { CheckpointStoreInterface, AbortableOptionsType } from '@studnicky/dagonizer/contracts';
import { StoreError } from '@studnicky/dagonizer/store';

import { OpfsEnv } from './OpfsEnv.js';
import type { DirectoryHandleLikeInterface } from './OpfsTypes.js';

export class OpfsCheckpointStore implements CheckpointStoreInterface {
  readonly #checkpointDir: DirectoryHandleLikeInterface;

  constructor(checkpointDir: DirectoryHandleLikeInterface) {
    this.#checkpointDir = checkpointDir;
  }

  /**
   * Resolves the OPFS root, gets/creates a top-level directory named `dirName`,
   * then gets/creates a 'checkpoints' subdirectory within it.
   */
  static async rooted(dirName: string): Promise<OpfsCheckpointStore> {
    const root = await OpfsEnv.rootDirectory();
    const dir = await root.getDirectoryHandle(dirName, { 'create': true });
    const checkpointDir = await dir.getDirectoryHandle('checkpoints', { 'create': true });
    return new OpfsCheckpointStore(checkpointDir);
  }

  async save(key: string, json: string, _options?: AbortableOptionsType): Promise<void> {
    const name = `${encodeURIComponent(key)}.json`;
    const handle = await this.#checkpointDir.getFileHandle(name, { 'create': true });
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
  }

  async load(key: string, _options?: AbortableOptionsType): Promise<string | null> {
    const name = `${encodeURIComponent(key)}.json`;
    try {
      const handle = await this.#checkpointDir.getFileHandle(name);
      const file = await handle.getFile();
      return await file.text();
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFoundError') return null;
      throw err;
    }
  }

  async delete(key: string, _options?: AbortableOptionsType): Promise<void> {
    const name = `${encodeURIComponent(key)}.json`;
    try {
      await this.#checkpointDir.removeEntry(name);
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFoundError') return;
      throw new StoreError(
        `Failed to delete checkpoint '${key}'`,
        { 'reason': 'BACKING_ERROR', 'cause': err instanceof Error ? err : new Error(String(err)) },
      );
    }
  }
}
