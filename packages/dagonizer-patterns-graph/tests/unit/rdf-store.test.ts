import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Term } from '@studnicky/dagonizer/patterns';
import { StoreError } from '@studnicky/dagonizer/store';

import { RdfStore } from '../../src/RdfStore.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function namedNode(value: string): Term {
  return { "termType": 'NamedNode', value };
}

function literal(value: string): Term {
  return { "termType": 'Literal', value };
}

function namedGraph(value: string): Term {
  return { "termType": 'NamedNode', value };
}

const DEFAULT_GRAPH: Term = { "termType": 'DefaultGraph', "value": '' };

// ── 1. Store contract: get/set/has/delete round-trip ─────────────────────────

void describe('RdfStore: Store contract (reified key-value)', () => {
  void it('set then get returns the stored value', async () => {
    const store = new RdfStore();
    await store.set<string>('greeting', 'hello');
    assert.equal(await store.get<string>('greeting'), 'hello');
  });

  void it('has returns true for existing key, false for missing key', async () => {
    const store = new RdfStore();
    await store.set<number>('count', 42);
    assert.equal(await store.has('count'), true);
    assert.equal(await store.has('missing'), false);
  });

  void it('delete removes the key and returns true; second delete returns false', async () => {
    const store = new RdfStore();
    await store.set<boolean>('flag', true);
    assert.equal(await store.delete('flag'), true);
    assert.equal(await store.has('flag'), false);
    assert.equal(await store.get<boolean>('flag'), null);
    assert.equal(await store.delete('flag'), false);
  });

  void it('set overwrites an existing value', async () => {
    const store = new RdfStore();
    await store.set<number>('n', 1);
    await store.set<number>('n', 2);
    assert.equal(await store.get<number>('n'), 2);
  });

  void it('stores complex JsonValue (object, array)', async () => {
    const store = new RdfStore();
    await store.set('obj', { "a": 1, "b": [2, 3] });
    assert.deepEqual(await store.get('obj'), { "a": 1, "b": [2, 3] });
  });
});

// ── 2. update(key, fn) atomic RMW ────────────────────────────────────────────

void describe('RdfStore: update(key, fn) atomic RMW', () => {
  void it('increments a counter from undefined', async () => {
    const store = new RdfStore();
    const result = await store.update<number>('counter', (n) => (n ?? 0) + 1);
    assert.equal(result, 1);
    assert.equal(await store.get<number>('counter'), 1);
  });

  void it('increments a counter that already exists', async () => {
    const store = new RdfStore();
    await store.set<number>('counter', 10);
    const result = await store.update<number>('counter', (n) => (n ?? 0) + 5);
    assert.equal(result, 15);
  });

  void it('two sequential updates accumulate correctly', async () => {
    const store = new RdfStore();
    await store.update<number>('k', (n) => (n ?? 0) + 1);
    await store.update<number>('k', (n) => (n ?? 0) + 1);
    assert.equal(await store.get<number>('k'), 2);
  });
});

// ── 3. TripleStore contract ───────────────────────────────────────────────────

void describe('RdfStore: TripleStore contract', () => {
  void it('assert adds a quad; ask returns true for a matching pattern', () => {
    const store = new RdfStore();
    const s = namedNode('urn:test:subject');
    const p = namedNode('urn:test:pred');
    const o = literal('object-value');

    store.assert(s, p, o);

    assert.equal(store.ask({ "subject": s, "predicate": p, "object": o }), true);
  });

  void it('ask returns false for a non-matching pattern', () => {
    const store = new RdfStore();
    store.assert(namedNode('urn:test:s'), namedNode('urn:test:p'), literal('o'));
    assert.equal(store.ask({ "subject": namedNode('urn:test:other') }), false);
  });

  void it('select returns bindings for variable slots', () => {
    const store = new RdfStore();
    const s = namedNode('urn:test:a');
    const p = namedNode('urn:test:knows');
    const o = namedNode('urn:test:b');
    store.assert(s, p, o);

    const rows = store.select({ "subject": '?who', "predicate": p, "object": '?target' });
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row !== undefined);
    assert.equal(row['who']?.value, 'urn:test:a');
    assert.equal(row['target']?.value, 'urn:test:b');
  });

  void it('select returns multiple bindings when multiple quads match', () => {
    const store = new RdfStore();
    const p = namedNode('urn:test:type');
    store.assert(namedNode('urn:test:x'), p, literal('A'));
    store.assert(namedNode('urn:test:y'), p, literal('B'));

    const rows = store.select({ "predicate": p, "subject": '?s' });
    assert.equal(rows.length, 2);
    const subjects = rows.map((r) => r['s']?.value).sort();
    assert.deepEqual(subjects, ['urn:test:x', 'urn:test:y']);
  });

  void it('count returns the number of matching quads', () => {
    const store = new RdfStore();
    const p = namedNode('urn:test:rel');
    store.assert(namedNode('urn:1'), p, literal('v1'));
    store.assert(namedNode('urn:2'), p, literal('v2'));
    store.assert(namedNode('urn:3'), namedNode('urn:other'), literal('v3'));

    assert.equal(store.count({ "predicate": p }), 2);
    assert.equal(store.count({}), 3);
  });
});

// ── 4. clearGraph ─────────────────────────────────────────────────────────────

void describe('RdfStore: clearGraph', () => {
  void it('removes only quads in the named graph, leaves others untouched', () => {
    const store = new RdfStore();
    const p = namedNode('urn:test:p');
    const graphA = namedGraph('urn:graph:A');
    const graphB = namedGraph('urn:graph:B');

    store.assert(namedNode('urn:s1'), p, literal('in-A'), graphA);
    store.assert(namedNode('urn:s2'), p, literal('in-B'), graphB);
    store.assert(namedNode('urn:s3'), p, literal('default'));

    store.clearGraph(graphA);

    assert.equal(store.count({ "graph": graphA }), 0);
    assert.equal(store.count({ "graph": graphB }), 1);
    // Default-graph quad survives.
    assert.equal(store.count({ "graph": DEFAULT_GRAPH }), 1);
  });

  void it('clearGraph on an empty or non-existent graph is a no-op', () => {
    const store = new RdfStore();
    store.assert(namedNode('urn:s'), namedNode('urn:p'), literal('o'));
    store.clearGraph(namedGraph('urn:graph:empty'));
    assert.equal(store.count({}), 1);
  });
});

// ── 5. triples() iterator ─────────────────────────────────────────────────────

void describe('RdfStore: triples()', () => {
  void it('iterates all stored quads (reified + user-asserted)', async () => {
    const store = new RdfStore();

    // User-asserted quads.
    const p = namedNode('urn:test:p');
    store.assert(namedNode('urn:a'), p, literal('1'));
    store.assert(namedNode('urn:b'), p, literal('2'));

    // Store-reified entry.
    await store.set<string>('key', 'val');

    const quads = [...store.triples()];
    // 2 user-asserted + 1 reified.
    assert.equal(quads.length, 3);
    const userObjects = quads
      .filter((q) => q.predicate.value === 'urn:test:p')
      .map((q) => q.object.value)
      .sort();
    assert.deepEqual(userObjects, ['1', '2']);
  });

  void it('triples() returns an empty iterator on a fresh store', () => {
    const store = new RdfStore();
    const quads = [...store.triples()];
    assert.equal(quads.length, 0);
  });
});

// ── 6. Coexistence of reified Store entries and user-asserted quads ───────────

void describe('RdfStore: Store entries and native quads coexist', () => {
  void it('store set/get does not disturb user-asserted quads on other predicates', async () => {
    const store = new RdfStore();
    const p = namedNode('urn:test:custom');
    store.assert(namedNode('urn:s'), p, literal('native'));

    await store.set<number>('score', 99);

    // Both are present.
    assert.equal(store.count({ "predicate": p }), 1);
    assert.equal(await store.get<number>('score'), 99);
  });

  void it('snapshot() captures only reified Store entries, not user-asserted quads', async () => {
    const store = new RdfStore();
    // User-asserted quad on a different predicate.
    store.assert(
      namedNode('urn:s'),
      namedNode('urn:test:custom-pred'),
      literal('native-value'),
    );

    // Store-reified entry.
    await store.set<string>('name', 'dagonizer');

    const snap = await store.snapshot();
    assert.equal(snap.type, 'rdf-store');
    assert.equal(snap.version, 1);
    assert.equal(snap.entries.length, 1);
    const entry = snap.entries[0];
    assert.ok(entry !== undefined);
    // The key in snapshot is stored WITHOUT the prefix (raw unqualified key).
    assert.equal(entry.key, 'name');
    assert.equal(entry.value, 'dagonizer');
  });
});

// ── 7. restore(): clears all quads, reseeds from snapshot, rejects bad input ──

void describe('RdfStore: restore()', () => {
  void it('restores Store entries from a valid snapshot', async () => {
    const source = new RdfStore();
    await source.set<number>('x', 10);
    await source.set<string>('y', 'hello');
    const snap = await source.snapshot();

    const target = new RdfStore();
    await target.restore(snap);
    assert.equal(await target.get<number>('x'), 10);
    assert.equal(await target.get<string>('y'), 'hello');
  });

  void it('restore() replaces previous Store entries', async () => {
    const store = new RdfStore();
    await store.set<number>('old', 1);

    const snap = await (async () => {
      const src = new RdfStore();
      await src.set<number>('new', 2);
      return src.snapshot();
    })();

    await store.restore(snap);
    assert.equal(await store.get<number>('old'), null);
    assert.equal(await store.get<number>('new'), 2);
  });

  void it('restore() clears user-asserted quads (documented trade-off)', async () => {
    const store = new RdfStore();
    store.assert(namedNode('urn:s'), namedNode('urn:p'), literal('native'));

    const snap = await (async () => {
      const src = new RdfStore();
      await src.set<string>('k', 'v');
      return src.snapshot();
    })();

    await store.restore(snap);
    // The native assert is gone; this is the documented trade-off.
    assert.equal(store.count({ "subject": namedNode('urn:s') }), 0);
    assert.equal(await store.get<string>('k'), 'v');
  });

  void it('throws StoreError INCOMPATIBLE_SNAPSHOT for wrong type', async () => {
    const store = new RdfStore();
    const bad = { "version": 1, "type": 'wrong-type', "entries": [] };
    await assert.rejects(
      () => store.restore(bad),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
        assert.equal(
          err.classification.reason === 'INCOMPATIBLE_SNAPSHOT'
            ? err.classification.actualType
            : '',
          'wrong-type',
        );
        return true;
      },
    );
  });

  void it('throws StoreError INCOMPATIBLE_SNAPSHOT for wrong version', async () => {
    const store = new RdfStore();
    const bad = { "version": 99, "type": 'rdf-store', "entries": [] };
    await assert.rejects(
      () => store.restore(bad),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
        assert.equal(
          err.classification.reason === 'INCOMPATIBLE_SNAPSHOT'
            ? err.classification.actualVersion
            : 0,
          99,
        );
        return true;
      },
    );
  });
});
