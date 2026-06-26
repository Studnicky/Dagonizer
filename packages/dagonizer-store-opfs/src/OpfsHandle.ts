/**
 * OpfsHandle: minimal structural interfaces for the File System Access API.
 *
 * No DOM lib. These structural shapes are a subset of the real
 * FileSystemFileHandle / FileSystemDirectoryHandle APIs. A real browser
 * FileSystemDirectoryHandle is assignable here without a cast.
 */

export interface FileLikeInterface {
  text(): Promise<string>;
}

export interface WritableLikeInterface {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface FileHandleLikeInterface {
  getFile(): Promise<FileLikeInterface>;
  // Quoted key: `createWritable` is the W3C File System Access API method name,
  // fixed by the platform contract so a real `FileSystemFileHandle` stays
  // structurally assignable here without a cast. The string-literal key denotes
  // an externally-dictated identifier (exempt from the noun.verb() verb gate).
  'createWritable'(): Promise<WritableLikeInterface>;
}

export interface DirectoryHandleLikeInterface {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLikeInterface>;
  removeEntry(name: string): Promise<void>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLikeInterface>;
  entries(): AsyncIterableIterator<readonly [string, FileHandleLikeInterface]>;
}
