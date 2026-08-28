/** In-memory `DirectoryHandleLikeInterface` double with shared file and directory state. */

import type {
  DirectoryHandleLikeInterface,
  FileHandleLikeInterface,
  FileLikeInterface,
  WritableLikeInterface,
} from '../../src/OpfsHandle.js';

class NotFoundError extends Error {
  constructor(name: string) {
    super(`Entry not found: ${name}`);
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
  readonly #files: Map<string, string>;
  readonly #directories: Map<string, MemDirectory>;

  constructor(files: Map<string, string> = new Map(), directories: Map<string, MemDirectory> = new Map()) {
    this.#files = files;
    this.#directories = directories;
  }

  alias(): MemDirectory {
    return new MemDirectory(this.#files, this.#directories);
  }

  async isSameEntry(other: DirectoryHandleLikeInterface): Promise<boolean> {
    return other instanceof MemDirectory && this.#files === other.#files;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLikeInterface> {
    if (!this.#files.has(name)) {
      if (options?.create === true) this.#files.set(name, '');
      else throw new NotFoundError(name);
    }
    return new MemFileHandle(name, this.#files);
  }

  async removeEntry(name: string): Promise<void> {
    if (this.#files.delete(name)) return;
    if (this.#directories.delete(name)) return;
    throw new NotFoundError(name);
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemDirectory> {
    const directory = this.#directories.get(name);
    if (directory !== undefined) return directory;
    if (options?.create !== true) throw new NotFoundError(name);

    const created = new MemDirectory();
    this.#directories.set(name, created);
    return created;
  }

  async *entries(): AsyncIterableIterator<readonly [string, FileHandleLikeInterface]> {
    for (const [name] of this.#files) yield [name, new MemFileHandle(name, this.#files)];
  }
}
