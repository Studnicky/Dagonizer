/**
 * In-memory `DirectoryHandleLikeInterface` double backed by `Map<string, string>`.
 * Shared across OPFS store unit tests; no subdirectory support needed.
 */

import type {
  DirectoryHandleLikeInterface,
  FileHandleLikeInterface,
  FileLikeInterface,
  WritableLikeInterface,
} from '../../src/OpfsHandle.js';

class NotFoundError extends Error {
  constructor(name: string) {
    super(`File not found: ${name}`);
    this.name = 'NotFoundError';
  }
}

class MemWritable implements WritableLikeInterface {
  #buffer = '';
  readonly #commit: (data: string) => void;

  constructor(commit: (data: string) => void) {
    this.#commit = commit;
  }

  async write(data: string): Promise<void> {
    this.#buffer += data;
  }

  async close(): Promise<void> {
    this.#commit(this.#buffer);
  }
}

class MemFile implements FileLikeInterface {
  readonly #content: string;

  constructor(content: string) {
    this.#content = content;
  }

  async text(): Promise<string> {
    return this.#content;
  }
}

class MemFileHandle implements FileHandleLikeInterface {
  readonly #name: string;
  readonly #map: Map<string, string>;

  constructor(name: string, map: Map<string, string>) {
    this.#name = name;
    this.#map = map;
  }

  async getFile(): Promise<FileLikeInterface> {
    const content = this.#map.get(this.#name);
    if (content === undefined) throw new NotFoundError(this.#name);
    return new MemFile(content);
  }

  async createWritable(): Promise<WritableLikeInterface> {
    return new MemWritable((data) => { this.#map.set(this.#name, data); });
  }
}

export class MemDirectory implements DirectoryHandleLikeInterface {
  readonly #files = new Map<string, string>();

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLikeInterface> {
    if (!this.#files.has(name)) {
      if (options?.create === true) this.#files.set(name, '');
      else throw new NotFoundError(name);
    }
    return new MemFileHandle(name, this.#files);
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.#files.has(name)) throw new NotFoundError(name);
    this.#files.delete(name);
  }

  async getDirectoryHandle(): Promise<DirectoryHandleLikeInterface> {
    throw new Error('MemDirectory does not support subdirectories');
  }

  async *entries(): AsyncIterableIterator<readonly [string, FileHandleLikeInterface]> {
    for (const [name] of this.#files) yield [name, new MemFileHandle(name, this.#files)] as const;
  }
}
