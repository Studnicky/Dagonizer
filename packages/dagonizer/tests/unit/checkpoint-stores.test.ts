/**
 * Checkpoint + Store integration tests (v0.11 Phase 3).
 *
 * Verifies that `Checkpoint.capture()` snapshots named stores into
 * `CheckpointData.stores`, and that `Checkpoint.restoreStores()` repopulates
 * fresh store instances from those snapshots on resume.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Checkpoint } from '../../src/checkpoint/Checkpoint.js';
import { MemoryCheckpointStore } from '../../src/checkpoint/MemoryCheckpointStore.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import type { Snapshottable, StoreSnapshot } from '../../src/contracts/Snapshottable.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import { DAGError } from '../../src/errors/DAGError.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { MemoryStore } from '../../src/store/MemoryStore.js';
import { StoreError } from '../../src/store/StoreError.js';

// ── Shared test fixture ─────────────────────────────────────────────────────

/**
 * Minimal abortable dispatcher + two-node DAG. The node signals readiness
 * before waiting for its abort signal — the caller aborts immediately once
 * the node is suspended, giving a deterministic interruption without any
 * real timer dependencies.
 */
async function makeAbortedResult(): Promise<ReturnType<typeof Dagonizer.prototype.execute>> {
  const dispatcher = new Dagonizer<NodeStateBase>();

  let resolveNodeReady!: () => void;
  const nodeReady = new Promise<void>((r) => { resolveNodeReady = r; });

  const slow: NodeInterface<NodeStateBase, 'done'> = {
    'name': 'slow',
    'outputs': ['done'],
    async execute(_state, context) {
      resolveNodeReady();
      await new Promise<void>((_resolve, reject) => {
        context.signal.addEventListener('abort', () => {
          reject(context.signal.reason);
        }, { 'once': true });
      });
      return { 'output': 'done' };
    },
  };
  dispatcher.registerNode(slow);
  dispatcher.registerDAG({
    '@context': DAG_CONTEXT,
    '@id':      'urn:noocodex:dag:store-test',
    '@type':    'DAG',
    'name': 'store-test', 'version': '1', 'entrypoint': 'a',
    'nodes': [
      {
        '@id': 'urn:noocodex:dag:store-test/node/a', '@type': 'SingleNode',
        'name': 'a', 'node': 'slow', 'outputs': { 'done': 'b' },
      },
      {
        '@id': 'urn:noocodex:dag:store-test/node/b', '@type': 'SingleNode',
        'name': 'b', 'node': 'slow', 'outputs': { 'done': 'end' },
      },
      { '@id': 'urn:noocodex:dag:store-test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
    ],
  });

  const ctl = new AbortController();
  const execution = dispatcher.execute('store-test', new NodeStateBase(), { 'signal': ctl.signal });
  // Abort deterministically once the node body is suspended, no wall-clock wait.
  nodeReady.then(() => { ctl.abort(new Error('pause')); });
  const result = await execution;
  // Ensure we have a cursor so Checkpoint.capture can proceed.
  assert.ok(result.cursor !== null, 'Expected aborted result to have a cursor');
  return result;
}

// ── Test 1: Round-trip with one store ───────────────────────────────────────

void describe('Checkpoint.capture + restoreStores: one store', () => {
  void it('round-trips a single named store through persist + load', async () => {
    const memory = new MemoryStore();
    await memory.set('counter', 42);
    await memory.set('label', 'hello');

    const result = await makeAbortedResult();
    const ckpt = await Checkpoint.capture('store-test', result, { 'stores': { memory } });

    assert.ok(ckpt.data.stores !== undefined, 'stores should be present on checkpoint data');
    assert.ok('memory' in (ckpt.data.stores ?? {}), 'stores.memory should be present');

    // Persist via CheckpointStore → load back.
    const cpStore = new MemoryCheckpointStore();
    await cpStore.save('run:1', ckpt.toJson());

    const json1 = await cpStore.load('run:1');
    assert.ok(json1 !== null, 'Expected persisted checkpoint to be retrievable');
    const raw = JSON.parse(json1) as unknown;
    const recalled = Checkpoint.load(raw);

    const freshMemory = new MemoryStore();
    await recalled.restoreStores({ 'memory': freshMemory });

    assert.equal(await freshMemory.get('counter'), 42);
    assert.equal(await freshMemory.get('label'), 'hello');
  });
});

// ── Test 2: Round-trip with multiple stores ─────────────────────────────────

void describe('Checkpoint.capture + restoreStores: two stores', () => {
  void it('isolates two named stores; each restores independently', async () => {
    const memory = new MemoryStore();
    const audit  = new MemoryStore();
    await memory.set('x', 1);
    await audit.set('event', 'login');

    const result = await makeAbortedResult();
    const ckpt = await Checkpoint.capture('store-test', result, { 'stores': { memory, audit } });

    const cpStore = new MemoryCheckpointStore();
    await cpStore.save('run:2', ckpt.toJson());

    const json2 = await cpStore.load('run:2');
    assert.ok(json2 !== null, 'Expected persisted checkpoint to be retrievable');
    const raw = JSON.parse(json2) as unknown;
    const recalled = Checkpoint.load(raw);

    const freshMemory = new MemoryStore();
    const freshAudit  = new MemoryStore();
    await recalled.restoreStores({ 'memory': freshMemory, 'audit': freshAudit });

    assert.equal(await freshMemory.get('x'), 1);
    assert.equal(await freshMemory.get('event'), null, 'audit entry should not bleed into memory');
    assert.equal(await freshAudit.get('event'), 'login');
    assert.equal(await freshAudit.get('x'), null, 'memory entry should not bleed into audit');
  });
});

// ── Test 3: `stores` is required; pre-v0.11 checkpoints are rejected ─────────

void describe('Checkpoint.load: rejects a checkpoint missing the stores field', () => {
  void it('throws when stores is absent (no silent acceptance of stale checkpoints)', () => {
    const rawOld = {
      'version': '1',
      'dagName': 'old-dag',
      'cursor': 'next-node',
      'state': {},
      'executedNodes': [],
      'skippedNodes': [],
      // no 'stores' field; a checkpoint produced before stores were captured
    };

    assert.throws(() => Checkpoint.load(rawOld));
  });
});

// ── Test 4: Missing store in restore map ────────────────────────────────────

void describe('Checkpoint.restoreStores: missing store in map', () => {
  void it('throws DAGError naming the missing store', async () => {
    const memory = new MemoryStore();
    await memory.set('k', 'v');

    const result = await makeAbortedResult();
    const ckpt = await Checkpoint.capture('store-test', result, { 'stores': { memory } });

    // Pass empty map; 'memory' is in the checkpoint but not supplied.
    await assert.rejects(
      () => ckpt.restoreStores({}),
      (err: unknown) => {
        assert.ok(err instanceof DAGError, `Expected DAGError, got ${String(err)}`);
        assert.ok(
          err.message.includes('memory'),
          `Expected error message to name 'memory', got: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ── Test 5: Extra store in restore map is a no-op ───────────────────────────

void describe('Checkpoint.restoreStores: extra store in map', () => {
  void it('does not throw when map contains stores absent from checkpoint', async () => {
    const memory = new MemoryStore();
    await memory.set('k', 'v');

    const result = await makeAbortedResult();
    const ckpt = await Checkpoint.capture('store-test', result, { 'stores': { memory } });

    const freshMemory = new MemoryStore();
    const extra       = new MemoryStore();

    // 'extra' is in map but not in checkpoint; should not throw.
    await assert.doesNotReject(
      () => ckpt.restoreStores({ 'memory': freshMemory, 'extra': extra }),
    );

    assert.equal(await freshMemory.get('k'), 'v');
    // Extra store remains empty.
    assert.equal(await extra.has('k'), false);
  });
});

// ── Test 6: Incompatible snapshot propagates StoreError ─────────────────────

void describe('Checkpoint.restoreStores: incompatible snapshot', () => {
  void it('propagates StoreError with INCOMPATIBLE_SNAPSHOT from store.restore', async () => {
    // Hand-construct a checkpoint whose stores.memory has the wrong type.
    const badRaw = {
      'version': '2',
      'dagName': 'test-dag',
      'cursor': 'next-node',
      'state': {},
      'executedNodes': [],
      'skippedNodes': [],
      'stores': {
        'memory': {
          'version': 1,
          'type': 'wrong-type',   // MemoryStore expects 'memory-store'
          'entries': [],
        },
      },
    };

    const recalled = Checkpoint.load(badRaw);
    const freshMemory = new MemoryStore();

    await assert.rejects(
      () => recalled.restoreStores({ 'memory': freshMemory }),
      (err: unknown) => {
        assert.ok(err instanceof StoreError, `Expected StoreError, got ${String(err)}`);
        assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
        return true;
      },
    );
  });
});

// ── Test 7: Empty stores option ─────────────────────────────────────────────

void describe('Checkpoint.capture: empty stores option', () => {
  void it('succeeds without throwing; checkpoint has no stores entries', async () => {
    const result = await makeAbortedResult();
    const ckpt = await Checkpoint.capture('store-test', result, { 'stores': {} });

    // Implementation choice: empty stores map → no stores field in data
    // (or present but empty). Either is valid per spec.
    const storesField = ckpt.data.stores;
    const hasNoEntries =
      storesField === undefined ||
      Object.keys(storesField).length === 0;
    assert.ok(hasNoEntries, 'Expected no store entries in checkpoint from empty stores map');

    // restoreStores should be a no-op.
    const freshMemory = new MemoryStore();
    await assert.doesNotReject(
      () => ckpt.restoreStores({ 'memory': freshMemory }),
    );
  });
});

// ── Test 8: No stores option ─────────────────────────────────────────────────

void describe('Checkpoint.capture: no stores option', () => {
  void it('succeeds unchanged when called with no second argument', async () => {
    const result = await makeAbortedResult();
    const ckpt = await Checkpoint.capture('store-test', result);

    assert.ok(ckpt instanceof Checkpoint, 'Expected a Checkpoint instance');
    assert.equal(ckpt.data.dagName, 'store-test');
    assert.equal(ckpt.data.cursor, result.cursor);

    // restoreStores on a no-stores checkpoint should be a no-op.
    await assert.doesNotReject(() => ckpt.restoreStores({}));
  });
});

// ── Test 9: Non-KV Snapshottable participates in checkpointing ───────────────

/**
 * A `Snapshottable` that is NOT a `Store`. It holds an append-only list of
 * facts, exposes no `get`/`set`/`has`/`delete`/`update`/`connect`, and
 * implements only `snapshot()` / `restore()`. Checkpoint depends on the
 * capability, not the key-value surface, so this round-trips.
 */
class FactLog implements Snapshottable {
  #facts: string[] = [];
  add(fact: string): void { this.#facts.push(fact); }
  get facts(): readonly string[] { return this.#facts; }

  async snapshot(): Promise<StoreSnapshot> {
    return {
      'version': 1,
      'type':    'fact-log',
      'entries': this.#facts.map((fact, i) => ({ 'key': String(i), 'value': fact })),
    };
  }

  async restore(snapshot: StoreSnapshot): Promise<void> {
    if (snapshot.type !== 'fact-log') {
      throw new Error(`FactLog.restore: incompatible snapshot type '${snapshot.type}'`);
    }
    this.#facts = snapshot.entries.map((entry) => String(entry.value));
  }
}

void describe('Checkpoint.capture + restoreStores: non-KV Snapshottable', () => {
  void it('round-trips a snapshot-only store that implements no key-value methods', async () => {
    const log = new FactLog();
    log.add('born');
    log.add('crawled');

    const result = await makeAbortedResult();
    const ckpt = await Checkpoint.capture('store-test', result, { 'stores': { 'log': log } });

    const cpStore = new MemoryCheckpointStore();
    await cpStore.save('run:nonkv', ckpt.toJson());

    const json = await cpStore.load('run:nonkv');
    assert.ok(json !== null, 'Expected persisted checkpoint to be retrievable');
    const recalled = Checkpoint.load(JSON.parse(json) as unknown);

    const freshLog = new FactLog();
    await recalled.restoreStores({ 'log': freshLog });

    assert.deepEqual([...freshLog.facts], ['born', 'crawled']);
  });
});
