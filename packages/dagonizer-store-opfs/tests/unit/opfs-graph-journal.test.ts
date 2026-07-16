/**
 * Unit tests for OpfsGraphJournalStore and OpfsGraphDatasetProvider.
 *
 * Uses an in-memory DirectoryHandleLikeInterface double backed by
 * Map<string, string> for file contents — the same pattern as
 * opfs-store.test.ts. Real-OPFS smoke testing is deferred to the S3
 * browser harness.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DagGraphTerms, PersistentGraphDataset } from '@studnicky/dagonizer';

import { OpfsGraphDatasetProvider } from '../../src/OpfsGraphDatasetProvider.js';
import { OpfsGraphJournalStore } from '../../src/OpfsGraphJournalStore.js';
import type {
  DirectoryHandleLikeInterface,
  FileHandleLikeInterface,
  FileLikeInterface,
  WritableLikeInterface,
} from '../../src/OpfsHandle.js';

// ── In-memory double ──────────────────────────────────────────────────────────

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

/** In-memory DirectoryHandleLikeInterface double: one flat file map, no subdirectories needed. */
class MemDirectory implements DirectoryHandleLikeInterface {
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

// ── Helpers ────────────────────────────────────────────────────────────────

function providerOnDirectory(directory: DirectoryHandleLikeInterface): OpfsGraphDatasetProvider {
  return new OpfsGraphDatasetProvider(new OpfsGraphJournalStore(directory));
}

// ── Tests ──────────────────────────────────────────────────────────────────

void describe('OpfsGraphDatasetProvider: RDF 1.2 durability', () => {
  void it('reopens a graph containing a triple term', async () => {
    const directory = new MemDirectory();
    const quoted = DagGraphTerms.quadTerm({
      'subject': DagGraphTerms.namedNode('urn:test:quoted-s'),
      'predicate': DagGraphTerms.namedNode('urn:test:quoted-p'),
      'object': DagGraphTerms.literal('quoted-o'),
      'graph': DagGraphTerms.defaultGraph(),
    });
    const quad = {
      'subject': DagGraphTerms.namedNode('urn:test:s'),
      'predicate': DagGraphTerms.namedNode('urn:test:p'),
      'object': quoted,
      'graph': DagGraphTerms.defaultGraph(),
    };

    const provider = providerOnDirectory(directory);
    const rootDataset = provider.root('urn:test:run');
    rootDataset.add([quad]);
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    await rootDataset.flush();

    const reopenedProvider = providerOnDirectory(directory);
    const reopened = await reopenedProvider.reopen('urn:test:run');
    assert.ok(reopened);
    assert.equal(reopened.match({ 'object': quoted }).next().done, false);
    await reopenedProvider.disconnect();
  });

  void it('flush-before-close: provider.disconnect() flushes a minted dataset before a fresh provider reopens it', async () => {
    const directory = new MemDirectory();
    const subject = DagGraphTerms.namedNode('urn:test:flush-subject');
    const predicate = DagGraphTerms.namedNode('urn:test:flush-predicate');

    const provider = providerOnDirectory(directory);
    const rootDataset = provider.root('urn:test:flush-run');
    rootDataset.assert(subject, predicate, DagGraphTerms.literal('durable'));
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    // No explicit flush() here — disconnect() alone must flush the pending write-behind journal write.
    await provider.disconnect();

    const restarted = providerOnDirectory(directory);
    const reopened = await restarted.reopen('urn:test:flush-run');
    assert.ok(reopened);
    assert.equal(reopened.count({ 'subject': subject }), 1);
    await restarted.disconnect();
  });

  void it('tolerates a torn delta file: readLog skips it and reopen still yields the correct graph', async () => {
    const directory = new MemDirectory();
    const subject = DagGraphTerms.namedNode('urn:test:torn-subject');
    const predicate = DagGraphTerms.namedNode('urn:test:torn-predicate');

    const provider = providerOnDirectory(directory);
    const rootDataset = provider.root('urn:test:torn-run');
    rootDataset.assert(subject, predicate, DagGraphTerms.literal('intact'));
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    await rootDataset.flush();
    await provider.disconnect();

    // Simulate a crash mid-append: a delta-log-named file whose content is
    // truncated JSON (a torn write, never fully closed).
    const tornHandle = await directory.getFileHandle('graph.log.urn%3Atest%3Atorn-run.00000000000000000099.json', { 'create': true });
    const tornWritable = await tornHandle.createWritable();
    await tornWritable.write('{"seq":99,"additions":"<urn:test:x');
    await tornWritable.close();

    const restarted = providerOnDirectory(directory);
    const journal = new OpfsGraphJournalStore(directory);
    const records: unknown[] = [];
    for await (const record of journal.readLog('urn:test:torn-run')) records.push(record);
    assert.equal(records.length, 1);

    const reopened = await restarted.reopen('urn:test:torn-run');
    assert.ok(reopened);
    assert.equal(reopened.count({ 'subject': subject }), 1);
    await restarted.disconnect();
  });

  void it('tolerates a crash mid-compact: new versioned snapshot written but pre-compaction delta files left in place still yields the correct (idempotent) graph', async () => {
    const directory = new MemDirectory();
    const predicate = DagGraphTerms.namedNode('urn:test:crash-compact-predicate');
    const logPrefix = 'graph.log.urn%3Atest%3Acrash-compact-run.';

    const provider = providerOnDirectory(directory);
    const rootDataset = provider.root('urn:test:crash-compact-run');
    rootDataset.assert(DagGraphTerms.namedNode('urn:test:crash-compact-s1'), predicate, DagGraphTerms.literal('one'));
    rootDataset.assert(DagGraphTerms.namedNode('urn:test:crash-compact-s2'), predicate, DagGraphTerms.literal('two'));
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    await rootDataset.flush();

    // Capture the pre-compaction delta files' exact bytes before compact()
    // deletes them, so they can be restored afterward to simulate a crash
    // that landed the new versioned snapshot write but never reached the
    // stale-delta-deletion step.
    const preCompactionDeltas: [string, string][] = [];
    for await (const [name, handle] of directory.entries()) {
      if (name.startsWith(logPrefix)) preCompactionDeltas.push([name, await (await handle.getFile()).text()]);
    }
    assert.equal(preCompactionDeltas.length, 2);

    await rootDataset.compact();
    for (const [name, content] of preCompactionDeltas) {
      const handle = await directory.getFileHandle(name, { 'create': true });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    }
    await provider.disconnect();

    const restarted = providerOnDirectory(directory);
    const reopened = await restarted.reopen('urn:test:crash-compact-run');
    assert.ok(reopened);
    assert.equal(reopened.count({}), 2);
    await restarted.disconnect();
  });

  void it('reopens from durable storage after a simulated restart via readSnapshot+readLog', async () => {
    const directory = new MemDirectory();
    const subject = DagGraphTerms.namedNode('urn:test:restart-subject');
    const predicate = DagGraphTerms.namedNode('urn:test:restart-predicate');

    const provider = providerOnDirectory(directory);
    const rootDataset = provider.root('urn:test:restart-run');
    rootDataset.assert(subject, predicate, DagGraphTerms.literal('one'));
    rootDataset.assert(subject, predicate, DagGraphTerms.literal('two'));
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    await rootDataset.flush();
    await provider.disconnect();

    // A fresh provider on the SAME directory simulates a process restart:
    // no in-memory dataset map, so reopen() must reconstruct purely from
    // the durable readSnapshot()/readLog() log.
    const restarted = providerOnDirectory(directory);
    const reopened = await restarted.reopen('urn:test:restart-run');
    assert.ok(reopened);
    assert.equal(reopened.count({ 'subject': subject }), 2);
    await restarted.disconnect();
  });

  void it('blank-node add-then-delete survives an N-Quads reopen round-trip with 0 quads left', async () => {
    const directory = new MemDirectory();
    const blank = { 'termType': 'BlankNode' as const, 'value': 'b0' };
    const predicate = DagGraphTerms.namedNode('urn:test:blank-predicate');
    const object = DagGraphTerms.literal('blank-object');

    const provider = providerOnDirectory(directory);
    const rootDataset = provider.root('urn:test:blank-run');
    rootDataset.assert(blank, predicate, object);
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    await rootDataset.flush();
    rootDataset.delete({ 'subject': blank, predicate, object });
    await rootDataset.flush();
    await provider.disconnect();

    const restarted = providerOnDirectory(directory);
    const reopened = await restarted.reopen('urn:test:blank-run');
    assert.ok(reopened);
    assert.equal(reopened.count({}), 0);
    await restarted.disconnect();
  });

  void it('compaction survives a restart: readSnapshot alone reflects the compacted state', async () => {
    const directory = new MemDirectory();
    const predicate = DagGraphTerms.namedNode('urn:test:compact-predicate');

    const provider = providerOnDirectory(directory);
    const rootDataset = provider.root('urn:test:compact-run');
    rootDataset.assert(DagGraphTerms.namedNode('urn:test:compact-s1'), predicate, DagGraphTerms.literal('one'));
    rootDataset.assert(DagGraphTerms.namedNode('urn:test:compact-s2'), predicate, DagGraphTerms.literal('two'));
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    await rootDataset.flush();
    await rootDataset.compact();
    await provider.disconnect();

    const restarted = providerOnDirectory(directory);
    const reopened = await restarted.reopen('urn:test:compact-run');
    assert.ok(reopened);
    assert.equal(reopened.count({}), 2);
    await restarted.disconnect();
  });
});
