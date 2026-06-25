/**
 * Unit tests for OpfsStore and OpfsCheckpointStore.
 *
 * All tests use an in-memory DirectoryHandleLikeInterface double backed by
 * Map<string, string> for file contents. Real-OPFS smoke testing is deferred
 * to the S3 browser harness.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StoreError } from '@studnicky/dagonizer/store';

import { OpfsCheckpointStore } from '../../src/OpfsCheckpointStore.js';
import { OpfsStore } from '../../src/OpfsStore.js';
import type {
  DirectoryHandleLikeInterface,
  FileHandleLikeInterface,
  FileLikeInterface,
  WritableLikeInterface,
} from '../../src/OpfsTypes.js';

// ── In-memory double ──────────────────────────────────────────────────────────

/** Not-Found error matching real OPFS behavior. */
class NotFoundError extends Error {
  constructor(name: string) {
    super(`File not found: ${name}`);
    this.name = 'NotFoundError';
  }
}

/** Buffers writes and commits to the parent map on close(). */
class MemWritable implements WritableLikeInterface {
  #buffer: string = '';
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

/** Reads from the parent map snapshot. */
class MemFile implements FileLikeInterface {
  readonly #content: string;

  constructor(content: string) {
    this.#content = content;
  }

  async text(): Promise<string> {
    return this.#content;
  }
}

/** Represents one file handle backed by a map entry. */
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

/**
 * In-memory DirectoryHandleLikeInterface double.
 * Each instance has its own flat file map; sub-directories are separate
 * MemDirectory instances stored in a nested map.
 */
class MemDirectory implements DirectoryHandleLikeInterface {
  readonly #files: Map<string, string>;
  readonly #dirs: Map<string, MemDirectory>;

  constructor() {
    this.#files = new Map();
    this.#dirs = new Map();
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLikeInterface> {
    if (!this.#files.has(name)) {
      if (options?.create === true) {
        this.#files.set(name, '');
      } else {
        throw new NotFoundError(name);
      }
    }
    return new MemFileHandle(name, this.#files);
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.#files.has(name) && !this.#dirs.has(name)) {
      throw new NotFoundError(name);
    }
    this.#files.delete(name);
    this.#dirs.delete(name);
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLikeInterface> {
    let dir = this.#dirs.get(name);
    if (dir === undefined) {
      if (options?.create === true) {
        dir = new MemDirectory();
        this.#dirs.set(name, dir);
      } else {
        throw new NotFoundError(name);
      }
    }
    return dir;
  }

  async *entries(): AsyncIterableIterator<readonly [string, FileHandleLikeInterface]> {
    for (const [name] of this.#files) {
      yield [name, new MemFileHandle(name, this.#files)] as const;
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeStore(options?: { namespace?: string; fileSuffix?: string }): OpfsStore {
  return new OpfsStore(new MemDirectory(), options);
}

function makeCheckpointStore(): OpfsCheckpointStore {
  return new OpfsCheckpointStore(new MemDirectory());
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('OpfsStore', () => {
  describe('get / set / has / delete round-trip', () => {
    it('set + get returns the same value', async () => {
      const store = makeStore();
      await store.set('foo', 42);
      const result = await store.get('foo');
      assert.equal(result, 42);
    });

    it('has returns true after set', async () => {
      const store = makeStore();
      await store.set('bar', 'hello');
      assert.equal(await store.has('bar'), true);
    });

    it('delete returns true for existing key', async () => {
      const store = makeStore();
      await store.set('baz', { 'x': 1 });
      assert.equal(await store.delete('baz'), true);
    });

    it('get returns null after delete', async () => {
      const store = makeStore();
      await store.set('qux', [1, 2, 3]);
      await store.delete('qux');
      assert.equal(await store.get('qux'), null);
    });

    it('has returns false after delete', async () => {
      const store = makeStore();
      await store.set('quux', true);
      await store.delete('quux');
      assert.equal(await store.has('quux'), false);
    });
  });

  it('delete returns false for a key that does not exist', async () => {
    const store = makeStore();
    assert.equal(await store.delete('nonexistent'), false);
  });

  describe('performEntriesStream / snapshotStream', () => {
    it('yields all 3 entries written', async () => {
      const store = makeStore();
      await store.set('a', 1);
      await store.set('b', 2);
      await store.set('c', 3);

      const entries: Array<{ key: string; value: unknown }> = [];
      for await (const entry of store.snapshotStream()) {
        entries.push(entry);
      }

      assert.equal(entries.length, 3);
      const keys = entries.map((e) => e.key).sort();
      assert.deepEqual(keys, ['a', 'b', 'c']);
    });
  });

  describe('snapshot() / restore() replacement round-trip', () => {
    it('restores all 3 keys into a fresh store', async () => {
      const source = makeStore();
      await source.set('x', 10);
      await source.set('y', 20);
      await source.set('z', 30);

      const snap = await source.snapshot();

      const target = makeStore();
      await target.restore(snap);

      assert.equal(await target.get('x'), 10);
      assert.equal(await target.get('y'), 20);
      assert.equal(await target.get('z'), 30);
    });

    it('restore() replaces existing keys (replacement semantics)', async () => {
      const source = makeStore();
      await source.set('a', 1);
      const snap = await source.snapshot();

      const target = makeStore();
      await target.set('stale', 99);
      await target.restore(snap);

      assert.equal(await target.get('stale'), null);
      assert.equal(await target.get('a'), 1);
    });
  });

  describe('update()', () => {
    it('per-key serialization: two concurrent updates produce value 2', async () => {
      const store = makeStore();
      await store.set('counter', 0);

      // Fire two concurrent updates. Without serialization one could be lost.
      const [a, b] = await Promise.all([
        store.update('counter', (n) => (typeof n === 'number' ? n : 0) + 1),
        store.update('counter', (n) => (typeof n === 'number' ? n : 0) + 1),
      ]);

      const finalValue = await store.get('counter');
      assert.equal(finalValue, 2, `expected 2, got ${String(finalValue)} (a=${String(a)}, b=${String(b)})`);
    });

    it('fn receives undefined for a missing key; result is stored', async () => {
      const store = makeStore();
      const result = await store.update('fresh', (current) => {
        assert.equal(current, undefined);
        return 0;
      });
      assert.equal(result, 0);
      assert.equal(await store.get('fresh'), 0);
    });
  });

  describe('restore() error handling', () => {
    it('throws StoreError INCOMPATIBLE_SNAPSHOT on wrong type', async () => {
      const store = makeStore();
      await assert.rejects(
        () => store.restore({ 'type': 'wrong-type', 'version': 1, 'entries': [] }),
        (err: unknown) => {
          assert.ok(err instanceof StoreError);
          assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
          return true;
        },
      );
    });

    it('throws StoreError INCOMPATIBLE_SNAPSHOT on wrong version', async () => {
      const store = makeStore();
      await assert.rejects(
        () => store.restore({ 'type': 'opfs-store', 'version': 99, 'entries': [] }),
        (err: unknown) => {
          assert.ok(err instanceof StoreError);
          assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
          return true;
        },
      );
    });
  });
});

describe('OpfsCheckpointStore', () => {
  it('save / load / delete round-trip', async () => {
    const store = makeCheckpointStore();
    await store.save('run-1', '{"step":3}');
    const json = await store.load('run-1');
    assert.equal(json, '{"step":3}');
    await store.delete('run-1');
    const after = await store.load('run-1');
    assert.equal(after, null);
  });

  it('load returns null for a missing key', async () => {
    const store = makeCheckpointStore();
    const result = await store.load('nonexistent');
    assert.equal(result, null);
  });

  it('delete is a no-op for a missing key', async () => {
    const store = makeCheckpointStore();
    // Should not throw
    await assert.doesNotReject(() => store.delete('missing'));
  });

  it('save overwrites an existing checkpoint', async () => {
    const store = makeCheckpointStore();
    await store.save('key', 'first');
    await store.save('key', 'second');
    const result = await store.load('key');
    assert.equal(result, 'second');
  });
});
