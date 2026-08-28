import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { DagGraphTerms, PersistentGraphDataset } from '@studnicky/dagonizer';
import { StoreError } from '@studnicky/dagonizer/store';

import { SqliteGraphDatasetProvider } from '../../src/SqliteGraphDatasetProvider.js';
import { SqliteStore } from '../../src/SqliteStore.js';

// All tests use ':memory:' so no filesystem I/O occurs.

void describe('SqliteStore: basic operations', () => {
  void it('get/set/has/delete round-trip', async () => {
    const store = new SqliteStore(':memory:');

    await store.set('greeting', 'hello');
    assert.equal(await store.get('greeting'), 'hello');
    assert.equal(await store.has('greeting'), true);
    assert.equal(await store.has('missing'), false);

    const deleted = await store.delete('greeting');
    assert.equal(deleted, true);
    assert.equal(await store.has('greeting'), false);
    assert.equal(await store.get('greeting'), null);

    await store.disconnect();
  });

  void it('delete returns false for a key that does not exist', async () => {
    const store = new SqliteStore(':memory:');
    const result = await store.delete('ghost');
    assert.equal(result, false);
    await store.disconnect();
  });
});

void describe('SqliteStore: update atomicity', () => {
  void it('update(key, fn) returns the new value; get() reads the same', async () => {
    const store = new SqliteStore(':memory:');
    const result = await store.update('counter', (n) => (typeof n === 'number' ? n : 0) + 1);
    assert.equal(result, 1);
    assert.equal(await store.get('counter'), 1);
    await store.disconnect();
  });

  void it('concurrent updates produce no lost writes via BEGIN IMMEDIATE', async () => {
    const store = new SqliteStore(':memory:');

    // Two simultaneous updates. SQLite serializes via BEGIN IMMEDIATE;
    // the second will block until the first transaction commits, so the
    // final value must be 2 (no lost update).
    await Promise.all([
      store.update('k', (n) => (typeof n === 'number' ? n : 0) + 1),
      store.update('k', (n) => (typeof n === 'number' ? n : 0) + 1),
    ]);
    assert.equal(await store.get('k'), 2);
    await store.disconnect();
  });
});

void describe('SqliteStore: snapshot', () => {
  void it('snapshot() returns typed envelope with type and version', async () => {
    const store = new SqliteStore(':memory:');
    await store.set('a', 1);
    await store.set('b', 'two');

    const snap = await store.snapshot();
    assert.equal(snap.type, 'sqlite-store');
    assert.equal(snap.version, 1);

    // Snapshot entries are ORDER BY key; a before b
    assert.equal(snap.entries.length, 2);
    assert.deepEqual(snap.entries[0], { 'key': 'a', 'value': 1 });
    assert.deepEqual(snap.entries[1], { 'key': 'b', 'value': 'two' });

    await store.disconnect();
  });

  void it('restore() repopulates a fresh SqliteStore from a captured snapshot', async () => {
    const source = new SqliteStore(':memory:');
    await source.set('x', 42);
    await source.set('y', [1, 2, 3]);
    const snap = await source.snapshot();
    await source.disconnect();

    const target = new SqliteStore(':memory:');
    await target.restore(snap);
    assert.equal(await target.get('x'), 42);
    assert.deepEqual(await target.get('y'), [1, 2, 3]);
    await target.disconnect();
  });

  void it('restore() with wrong type throws StoreError INCOMPATIBLE_SNAPSHOT', async () => {
    const store = new SqliteStore(':memory:');
    const badSnap = { 'version': 1, 'type': 'not-sqlite-store', 'entries': [] };

    await assert.rejects(
      () => store.restore(badSnap),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
        if (err.classification.reason === 'INCOMPATIBLE_SNAPSHOT') {
          assert.equal(err.classification.actualType, 'not-sqlite-store');
        }
        return true;
      },
    );
    await store.disconnect();
  });

  void it('restore() with wrong version throws StoreError INCOMPATIBLE_SNAPSHOT', async () => {
    const store = new SqliteStore(':memory:');
    const badSnap = { 'version': 99, 'type': 'sqlite-store', 'entries': [] };

    await assert.rejects(
      () => store.restore(badSnap),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
        if (err.classification.reason === 'INCOMPATIBLE_SNAPSHOT') {
          assert.equal(err.classification.actualVersion, 99);
        }
        return true;
      },
    );
    await store.disconnect();
  });
});

void describe('Sqlite graph provider: RDF 1.2 durability', () => {
  void it('reopens a graph containing a triple term', async () => {
    const directory = mkdtempSync('/tmp/dagonizer-sqlite-');
    const path = join(directory, 'graph.sqlite');
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

    const provider = new SqliteGraphDatasetProvider(path);
    const rootDataset = provider.root('urn:test:run');
    rootDataset.add([quad]);
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    await rootDataset.flush();

    const reopenedProvider = new SqliteGraphDatasetProvider(path);
    const reopened = await reopenedProvider.reopen('urn:test:run');
    assert.ok(reopened);
    assert.equal(reopened.match({ 'object': quoted }).next().done, false);
    rmSync(directory, { "recursive": true, "force": true });
  });

  void it('reopens from durable storage after a simulated restart via readSnapshot+readLog', async () => {
    const directory = mkdtempSync('/tmp/dagonizer-sqlite-');
    const path = join(directory, 'graph.sqlite');
    const subject = DagGraphTerms.namedNode('urn:test:restart-subject');
    const predicate = DagGraphTerms.namedNode('urn:test:restart-predicate');

    const provider = new SqliteGraphDatasetProvider(path);
    const rootDataset = provider.root('urn:test:restart-run');
    rootDataset.assert(subject, predicate, DagGraphTerms.literal('one'));
    rootDataset.assert(subject, predicate, DagGraphTerms.literal('two'));
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    await rootDataset.flush();
    await provider.disconnect();

    // A fresh provider over the same file simulates a process restart: no
    // in-memory dataset map, so reopen() must reconstruct purely from the
    // durable readSnapshot()/readLog() log.
    const restarted = new SqliteGraphDatasetProvider(path);
    const reopened = await restarted.reopen('urn:test:restart-run');
    assert.ok(reopened);
    assert.equal(reopened.count({ 'subject': subject }), 2);
    await restarted.disconnect();
    rmSync(directory, { "recursive": true, "force": true });
  });

  void it('blank-node add-then-delete survives an N-Quads reopen round-trip with 0 quads left', async () => {
    const directory = mkdtempSync('/tmp/dagonizer-sqlite-');
    const path = join(directory, 'graph.sqlite');
    const blank = { 'termType': 'BlankNode' as const, 'value': 'b0' };
    const predicate = DagGraphTerms.namedNode('urn:test:blank-predicate');
    const object = DagGraphTerms.literal('blank-object');

    const provider = new SqliteGraphDatasetProvider(path);
    const rootDataset = provider.root('urn:test:blank-run');
    rootDataset.assert(blank, predicate, object);
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    await rootDataset.flush();
    rootDataset.delete({ 'subject': blank, predicate, object });
    await rootDataset.flush();
    await provider.disconnect();

    const restarted = new SqliteGraphDatasetProvider(path);
    const reopened = await restarted.reopen('urn:test:blank-run');
    assert.ok(reopened);
    assert.equal(reopened.count({}), 0);
    await restarted.disconnect();
    rmSync(directory, { "recursive": true, "force": true });
  });

  void it('compaction survives a restart: readSnapshot alone reflects the compacted state', async () => {
    const directory = mkdtempSync('/tmp/dagonizer-sqlite-');
    const path = join(directory, 'graph.sqlite');
    const predicate = DagGraphTerms.namedNode('urn:test:compact-predicate');

    const provider = new SqliteGraphDatasetProvider(path);
    const rootDataset = provider.root('urn:test:compact-run');
    rootDataset.assert(DagGraphTerms.namedNode('urn:test:compact-s1'), predicate, DagGraphTerms.literal('one'));
    rootDataset.assert(DagGraphTerms.namedNode('urn:test:compact-s2'), predicate, DagGraphTerms.literal('two'));
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    await rootDataset.flush();
    await rootDataset.compact();
    await provider.disconnect();

    const restarted = new SqliteGraphDatasetProvider(path);
    const reopened = await restarted.reopen('urn:test:compact-run');
    assert.ok(reopened);
    assert.equal(reopened.count({}), 2);
    await restarted.disconnect();
    rmSync(directory, { "recursive": true, "force": true });
  });

  void it('flush-before-close: provider.disconnect() flushes a minted dataset before a fresh provider reopens it', async () => {
    const directory = mkdtempSync('/tmp/dagonizer-sqlite-');
    const path = join(directory, 'graph.sqlite');
    const subject = DagGraphTerms.namedNode('urn:test:flush-subject');
    const predicate = DagGraphTerms.namedNode('urn:test:flush-predicate');

    const provider = new SqliteGraphDatasetProvider(path);
    const rootDataset = provider.root('urn:test:flush-run');
    rootDataset.assert(subject, predicate, DagGraphTerms.literal('durable'));
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    // No explicit flush() here — disconnect() alone must flush the pending write-behind journal write.
    await provider.disconnect();

    const restarted = new SqliteGraphDatasetProvider(path);
    const reopened = await restarted.reopen('urn:test:flush-run');
    assert.ok(reopened);
    assert.equal(reopened.count({ 'subject': subject }), 1);
    await restarted.disconnect();
    rmSync(directory, { "recursive": true, "force": true });
  });
});

void describe('SqliteStore: namespace', () => {
  void it('namespace option prefixes keys visible in snapshot', async () => {
    const store = new SqliteStore(':memory:', { 'namespace': 'foo' });
    await store.set('key', 'value');

    // Snapshot entries carry the qualified key (with namespace prefix)
    const snap = await store.snapshot();
    assert.equal(snap.entries.length, 1);
    assert.equal(snap.entries[0]?.key, 'foo:key');

    // Public get uses the same prefix; reads the same entry back
    assert.equal(await store.get('key'), 'value');
    await store.disconnect();
  });
});

void describe('SqliteStore: disconnect', () => {
  void it('disconnect() closes the connection; subsequent ops throw', async () => {
    const store = new SqliteStore(':memory:');
    await store.set('before', 'close');
    await store.disconnect();

    // After close, any SQLite operation should throw
    await assert.rejects(
      () => store.get('before'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });
});

void describe('SqliteStore: custom tableName', () => {
  void it('custom tableName works as backing table', async () => {
    const store = new SqliteStore(':memory:', { 'namespace': '', 'tableName': 'app_kv' });

    await store.set('count', 7);
    assert.equal(await store.get('count'), 7);

    const snap = await store.snapshot();
    assert.equal(snap.type, 'sqlite-store');
    assert.equal(snap.entries.length, 1);
    assert.deepEqual(snap.entries[0], { 'key': 'count', 'value': 7 });

    await store.disconnect();
  });
});
