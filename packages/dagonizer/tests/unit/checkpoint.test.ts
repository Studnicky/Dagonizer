import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  Checkpoint,
  CheckpointRestoreAdapter,
  MemoryCheckpointStore,
} from '../../src/checkpoint/index.js';
import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import type { SnapshottableInterface, StoreSnapshotEntryType, StoreSnapshotType } from '../../src/contracts/SnapshottableInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { CheckpointDataType, DAGType } from '../../src/entities/index.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { DAGError } from '../../src/errors/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Clock } from '../../src/runtime/Clock.js';
import { Scheduler } from '../../src/runtime/Scheduler.js';
import { MemoryStore } from '../../src/store/MemoryStore.js';
import { StoreError } from '../../src/store/StoreError.js';
import { VirtualClockProvider } from '../../testing/VirtualClock.js';
import { VirtualScheduler } from '../../testing/VirtualScheduler.js';
import { DAGErrorPredicate } from '../_support/DAGErrorPredicate.js';
import { TestNode } from '../_support/TestNode.js';

// ── State fixtures ───────────────────────────────────────────────────────────

class CountingState extends NodeStateBase {
  count = 0;
  log: string[] = [];

  protected override snapshotData(): JsonObjectType {
    return { 'count': this.count, 'log': [...this.log] };
  }

  protected override restoreData(snapshot: JsonObjectType): void {
    const c = snapshot['count'];
    if (typeof c === 'number') this.count = c;
    const l = snapshot['log'];
    if (Array.isArray(l)) this.log = l.filter((x): x is string => typeof x === 'string');
  }
}

class StoreState extends NodeStateBase {
  value = 0;
  protected override snapshotData(): { value: number } {
    return { 'value': this.value };
  }
  protected override restoreData(snap: Record<string, unknown>): void {
    if (typeof snap['value'] === 'number') this.value = snap['value'];
  }
}

// ── Shared DAG fixture for store-snapshot tests ──────────────────────────────
//
// Minimal abortable dispatcher + two-node DAG. The node signals readiness
// before waiting for its abort signal — the caller aborts immediately once the
// node is suspended, giving a deterministic interruption without any real timer
// dependencies.

class SlowNode extends MonadicNode<NodeStateBase, 'done'> {
  readonly name = 'slow';
  readonly outputs = ['done'] as const;
  readonly #onReady: () => void;
  constructor(onReady: () => void) { super(); this.#onReady = onReady; }
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  override async execute(batch: Batch<NodeStateBase>, context: NodeContextType): Promise<Map<'done', Batch<NodeStateBase>>> {
    this.#onReady();
    await new Promise<void>((_resolve, reject) => {
      context.signal.addEventListener('abort', () => {
        reject(context.signal.reason);
      }, { 'once': true });
    });
    return new Map([['done', batch]]);
  }
}

class TestCheckpoint {
  private constructor() {}
  static async abortedResult(): Promise<Awaited<ReturnType<typeof Dagonizer.prototype.execute>>> {
  const dispatcher = new Dagonizer<NodeStateBase>();

  let resolveNodeReady!: () => void;
  const nodeReady = new Promise<void>((r) => { resolveNodeReady = r; });

  dispatcher.registerNode(new SlowNode(resolveNodeReady));
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
}

/**
 * A `SnapshottableInterface` that is NOT a `StoreInterface`. It holds an append-only list of
 * facts, exposes no `get`/`set`/`has`/`delete`/`update`/`connect`, and
 * implements only `snapshot()` / `restore()`. Checkpoint depends on the
 * capability, not the key-value surface, so this round-trips.
 */
class FactLog implements SnapshottableInterface {
  #facts: string[] = [];
  add(fact: string): void { this.#facts.push(fact); }
  get facts(): readonly string[] { return this.#facts; }

  async snapshot(): Promise<StoreSnapshotType> {
    return {
      'version': 1,
      'type':    'fact-log',
      'entries': this.#facts.map((fact, i) => ({ 'key': String(i), 'value': fact })),
    };
  }

  async restore(snapshot: StoreSnapshotType): Promise<void> {
    if (snapshot.type !== 'fact-log') {
      throw new Error(`FactLog.restore: incompatible snapshot type '${snapshot.type}'`);
    }
    this.#facts = snapshot.entries.map((entry) => String(entry.value));
  }

  async *snapshotStream(): AsyncIterable<StoreSnapshotEntryType> {
    for (let i = 0; i < this.#facts.length; i += 1) {
      yield { 'key': String(i), 'value': this.#facts[i] ?? '' };
    }
  }

  async restoreStream(entries: AsyncIterable<StoreSnapshotEntryType>): Promise<void> {
    const facts: string[] = [];
    for await (const entry of entries) {
      facts.push(String(entry.value));
    }
    this.#facts = facts;
  }
}

class ConcurrencyProbeStore implements SnapshottableInterface {
  readonly #name: string;
  readonly #stats: { active: number; max: number };

  constructor(name: string, stats: { active: number; max: number }) {
    this.#name = name;
    this.#stats = stats;
  }

  async snapshot(): Promise<StoreSnapshotType> {
    this.#stats.active += 1;
    this.#stats.max = Math.max(this.#stats.max, this.#stats.active);
    await Scheduler.current().after(1);
    this.#stats.active -= 1;
    return {
      'version': 1,
      'type':    'concurrency-probe',
      'entries': [{ 'key': this.#name, 'value': this.#name }],
    };
  }

  async restore(_snapshot: StoreSnapshotType): Promise<void> {
    this.#stats.active += 1;
    this.#stats.max = Math.max(this.#stats.max, this.#stats.active);
    await Scheduler.current().after(1);
    this.#stats.active -= 1;
  }

  async *snapshotStream(): AsyncIterable<StoreSnapshotEntryType> {
    yield { 'key': this.#name, 'value': this.#name };
  }

  async restoreStream(entries: AsyncIterable<StoreSnapshotEntryType>): Promise<void> {
    for await (const _entry of entries) {
      await Promise.resolve();
    }
  }
}

const SAMPLE_CHECKPOINT: CheckpointDataType = {
  'dagName': 'demo',
  'cursor': 'next-node',
  'state': { 'metadata': {}, 'errors': [], 'warnings': [], 'value': 7 },
  'executedNodes': ['first'],
  'skippedNodes': [],
  'stores': {},
};

// ── NodeStateBase snapshot/restore ───────────────────────────────────────────

void describe('NodeStateBase snapshot/restore', () => {
  void it('preserves metadata and warnings; errors are excluded; resets lifecycle to pending', () => {
    const s = new NodeStateBase();
    s.setMetadata('k', { 'nested': [1, 2] });
    s.collectError({ 'code': 'E', 'context': {}, 'message': 'm', 'operation': 'op',
      'recoverable': false, 'timestamp': '2026-05-13T00:00:00Z' });
    s.markRunning();

    const restored = NodeStateBase.restore(s.snapshot());
    assert.deepEqual(restored.getMetadata('k'), { 'nested': [1, 2] });
    // Errors are intentionally NOT captured in the snapshot — they flow via
    // outcome.errors as the single authoritative channel (matching lifecycle
    // which is also excluded). Checkpointed errors are diagnostic; domain
    // state (metadata, retries, warnings, subclass fields) is what matters for
    // deterministic resume.
    assert.equal(restored.errors.length, 0);
    assert.equal(restored.lifecycle.variant, 'pending');
  });

  void it('subclass snapshotData/restoreData round-trips domain fields', () => {
    const s = new CountingState();
    s.count = 42;
    s.log = ['a', 'b'];
    s.setMetadata('top', 'level');

    const restored = CountingState.restore(s.snapshot());
    assert.equal(restored.count, 42);
    assert.deepEqual(restored.log, ['a', 'b']);
    assert.equal(restored.getMetadata('top'), 'level');
  });
});

// ── cursor on ExecutionResultType ───────────────────────────────────────

void describe('cursor on ExecutionResultType', () => {
  void it('is null on a clean completion', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('op', ['success']));
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:clean',
      '@type':    'DAG',
      'name': 'clean', 'version': '1', 'entrypoint': 's',
      'nodes': [{
        '@id': 'urn:noocodex:dag:clean/node/s', '@type': 'SingleNode',
        'name': 's', 'node': 'op', 'outputs': { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:clean/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    });
    const result = await dispatcher.execute('clean', new NodeStateBase());
    assert.equal(result.cursor, null);
  });

  void it('is the next node on abort', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    // nodeReady resolves once the node body starts executing (signal received).
    let resolveNodeReady!: () => void;
    const nodeReady = new Promise<void>((r) => { resolveNodeReady = r; });

    class OpNode extends MonadicNode<NodeStateBase, 'success'> {
      readonly name = 'op';
      readonly outputs = ['success'] as const;
      override get outputSchema(): Record<'success', SchemaObjectType> {
        return { 'success': { 'type': 'object' } };
      }
      override async execute(batch: Batch<NodeStateBase>, context: NodeContextType): Promise<Map<'success', Batch<NodeStateBase>>> {
        resolveNodeReady();
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener('abort', () => { reject(context.signal.reason); }, { 'once': true });
        });
        return new Map([['success', batch]]);
      }
    }
    dispatcher.registerNode(new OpNode());
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:two',
      '@type':    'DAG',
      'name': 'two', 'version': '1', 'entrypoint': 'a',
      'nodes': [
        { '@id': 'urn:noocodex:dag:two/node/a', '@type': 'SingleNode',
          'name': 'a', 'node': 'op', 'outputs': { 'success': 'b' } },
        { '@id': 'urn:noocodex:dag:two/node/b', '@type': 'SingleNode',
          'name': 'b', 'node': 'op', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:two/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    });
    const ctl = new AbortController();
    // Start execution, then abort immediately once the node body is suspended.
    const execution = dispatcher.execute('two', new NodeStateBase(), { 'signal': ctl.signal });
    // Wait for node to signal it is running, then abort deterministically.
    nodeReady.then(() => { ctl.abort(new Error('stop')); });
    const result = await execution;
    assert.equal(result.cursor, 'a');
    assert.equal(result.executedNodes.length, 0);
  });
});

// ── Checkpoint round-trip ─────────────────────────────────────────────────────

void describe('Checkpoint round-trip', () => {
  afterEach(() => { Scheduler.reset(); Clock.reset(); });

  void it('capture + restoreState yields a state that resume()s to the same final state', async () => {
    Clock.configure(new VirtualClockProvider(0n));
    Scheduler.configure(new VirtualScheduler(0));

    const dispatcher = new Dagonizer<CountingState>();
    dispatcher.registerNode(TestNode.make<CountingState>('inc', ['success'], (state) => {
      state.count++;
      state.log.push(`tick:${state.count}`);
      return 'success';
    }));
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:count',
      '@type':    'DAG',
      'name': 'count', 'version': '1', 'entrypoint': 'a',
      'nodes': [
        { '@id': 'urn:noocodex:dag:count/node/a', '@type': 'SingleNode',
          'name': 'a', 'node': 'inc', 'outputs': { 'success': 'b' } },
        { '@id': 'urn:noocodex:dag:count/node/b', '@type': 'SingleNode',
          'name': 'b', 'node': 'inc', 'outputs': { 'success': 'c' } },
        { '@id': 'urn:noocodex:dag:count/node/c', '@type': 'SingleNode',
          'name': 'c', 'node': 'inc', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:count/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    // Reference run: no checkpoint.
    const reference = await dispatcher.execute('count', new CountingState());
    assert.equal(reference.cursor, null);
    assert.equal(reference.state.count, 3);

    // Aborted run: stop after first node.
    const ctl = new AbortController();
    let nodesRun = 0;
    const initial = new CountingState();
    const execution = dispatcher.execute('count', initial, { 'signal': ctl.signal });
    for await (const _stage of execution) {
      nodesRun++;
      if (nodesRun === 1) ctl.abort(new Error('pause'));
    }
    const partial = await execution;
    assert.equal(partial.cursor, 'b');
    assert.equal(partial.state.count, 1);

    // Checkpoint → persist → load → restoreState → resume.
    const ckpt = await Checkpoint.capture('count', partial);
    const round = ckpt.toJson();
    const parsed: unknown = JSON.parse(round);
    const ckpt2 = Checkpoint.load(parsed);
    const { state, dagName, cursor } = ckpt2.restoreState(CheckpointRestoreAdapter.wrap((snap) => CountingState.restore(snap)));
    assert.equal(state.count, 1);
    assert.equal(cursor, 'b');
    const resumed = await dispatcher.resume(dagName, state, cursor);
    assert.equal(resumed.cursor, null);
    assert.equal(resumed.state.count, 3);
    assert.deepEqual(resumed.state.log, reference.state.log);
  });

  void it('rejects checkpointing a completed DAG', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('op', ['success']));
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:done',
      '@type':    'DAG',
      'name': 'done', 'version': '1', 'entrypoint': 's',
      'nodes': [{
        '@id': 'urn:noocodex:dag:done/node/s', '@type': 'SingleNode',
        'name': 's', 'node': 'op', 'outputs': { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:done/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    });
    const result = await dispatcher.execute('done', new NodeStateBase());
    await assert.rejects(() => Checkpoint.capture('done', result), DAGError);
  });

  void it('load rejects malformed CheckpointData', () => {
    assert.throws(() => Checkpoint.load({ 'version': '1' }), DAGErrorPredicate.isValidationError);
  });

  void it('load rejects a checkpoint missing the stores field (no silent acceptance of stale checkpoints)', () => {
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

  void it('restoreState throws ValidationError when checkpoint cursor is null (completed run)', () => {
    // A completed run stores cursor=null in CheckpointData (no resumable position).
    // restoreState must reject this because there is no node to resume from.
    const data = {
      'dagName': 'x', 'cursor': null,
      'state': {}, 'executedNodes': ['a', 'b'], 'skippedNodes': [], 'stores': {},
    };
    const ckpt = Checkpoint.load(data);
    assert.throws(() => ckpt.restoreState(CheckpointRestoreAdapter.wrap((snap) => NodeStateBase.restore(snap))), DAGErrorPredicate.isValidationError);
  });

  void it('CheckpointRestoreAdapter.wrap wraps a restore function in the adapter contract', () => {
    const data = {
      'dagName': 'wrap-test', 'cursor': 'node-b',
      'state': { 'count': 5 }, 'executedNodes': ['node-a'], 'skippedNodes': [], 'stores': {},
    };
    const ckpt = Checkpoint.load(data);
    const adapter = CheckpointRestoreAdapter.wrap((snap) => CountingState.restore(snap));
    const { dagName, cursor, state } = ckpt.restoreState(adapter);
    assert.equal(dagName, 'wrap-test');
    assert.equal(cursor, 'node-b');
    assert.equal(state.count, 5);
  });
});

// ── MemoryCheckpointStore ─────────────────────────────────────────────────────

void describe('MemoryCheckpointStore', () => {
  void it('save then load returns the persisted JSON', async () => {
    const store = new MemoryCheckpointStore();
    await store.save('k', '{"hello":1}');
    assert.equal(await store.load('k'), '{"hello":1}');
  });

  void it('load returns null when key is absent', async () => {
    const store = new MemoryCheckpointStore();
    assert.equal(await store.load('missing'), null);
  });

  void it('delete removes the entry', async () => {
    const store = new MemoryCheckpointStore();
    await store.save('k', 'x');
    await store.delete('k');
    assert.equal(await store.load('k'), null);
    assert.equal(store.size, 0);
  });

  void it('evicts the least-recently-used entry once capacity is exceeded', async () => {
    const store = new MemoryCheckpointStore({ 'capacity': 2 });
    await store.save('a', '1');
    await store.save('b', '2');
    // Insert a third distinct key: capacity 2 forces an LRU eviction. 'a' was
    // least-recently touched (no load/save since 'b'), so 'a' is evicted.
    await store.save('c', '3');

    assert.equal(store.size, 2);
    assert.equal(await store.load('a'), null);
    assert.equal(await store.load('b'), '2');
    assert.equal(await store.load('c'), '3');
  });

  void it('promotes an entry to most-recently-used on load, protecting it from eviction', async () => {
    const store = new MemoryCheckpointStore({ 'capacity': 2 });
    await store.save('a', '1');
    await store.save('b', '2');
    // Touch 'a' so it becomes MRU; 'b' is now the LRU entry.
    await store.load('a');
    await store.save('c', '3');

    assert.equal(await store.load('a'), '1');
    assert.equal(await store.load('b'), null);
    assert.equal(await store.load('c'), '3');
  });

  void it('defaults to DEFAULT_CHECKPOINT_CAPACITY when no options are supplied', async () => {
    const store = new MemoryCheckpointStore();
    assert.equal(MemoryCheckpointStore.defaultOptions.capacity, 500);
    for (let i = 0; i < 500; i += 1) {
      await store.save(`k${i}`, String(i));
    }
    assert.equal(store.size, 500);
    // One more entry past the default capacity evicts the oldest ('k0').
    await store.save('k500', '500');
    assert.equal(store.size, 500);
    assert.equal(await store.load('k0'), null);
    assert.equal(await store.load('k500'), '500');
  });
});

// ── ckpt.persist + Checkpoint.recall ──────────────────────────────────────────

void describe('ckpt.persist + Checkpoint.recall', () => {
  void it('round-trips a checkpoint through a CheckpointStoreInterface', async () => {
    const cpStore = new MemoryCheckpointStore();
    const ckpt = Checkpoint.load(SAMPLE_CHECKPOINT);
    await ckpt.persist(cpStore, 'demo:1');

    const recalled = await Checkpoint.recall(cpStore, 'demo:1');
    assert.ok(recalled !== null);

    const { dagName, cursor, state, executedNodes } = recalled.restoreState<StoreState>(
      CheckpointRestoreAdapter.wrap((snap) => StoreState.restore(snap)),
    );
    assert.equal(dagName, 'demo');
    assert.equal(cursor, 'next-node');
    assert.equal(state.value, 7);
    assert.deepEqual([...executedNodes], ['first']);
  });

  void it('recall returns null when no entry exists', async () => {
    const cpStore = new MemoryCheckpointStore();
    const recalled = await Checkpoint.recall(cpStore, 'missing');
    assert.equal(recalled, null);
  });

  void it('recall throws ValidationError on malformed JSON', async () => {
    const cpStore = new MemoryCheckpointStore();
    await cpStore.save('bad', '{not json');
    await assert.rejects(
      Checkpoint.recall(cpStore, 'bad'),
      DAGErrorPredicate.isValidationError,
    );
  });
});

// ── Checkpoint.capture + restoreStores ────────────────────────────────────────
//
// Verifies that `Checkpoint.capture()` snapshots named stores into
// `CheckpointData.stores`, and that `Checkpoint.restoreStores()` repopulates
// fresh store instances from those snapshots on resume.

void describe('Checkpoint.capture + restoreStores', () => {
  void it('round-trips a single named store through persist + load', async () => {
    const memory = new MemoryStore();
    await memory.set('counter', 42);
    await memory.set('label', 'hello');

    const result = await TestCheckpoint.abortedResult();
    const ckpt = await Checkpoint.capture('store-test', result, { 'stores': { memory } });

    assert.ok(ckpt.data.stores !== undefined, 'stores should be present on checkpoint data');
    assert.ok('memory' in (ckpt.data.stores ?? {}), 'stores.memory should be present');

    // Persist via CheckpointStoreInterface → load back.
    const cpStore = new MemoryCheckpointStore();
    await cpStore.save('run:1', ckpt.toJson());

    const json1 = await cpStore.load('run:1');
    assert.ok(json1 !== null, 'Expected persisted checkpoint to be retrievable');
    const raw: unknown = JSON.parse(json1);
    const recalled = Checkpoint.load(raw);

    const freshMemory = new MemoryStore();
    await recalled.restoreStores({ 'memory': freshMemory });

    assert.equal(await freshMemory.get('counter'), 42);
    assert.equal(await freshMemory.get('label'), 'hello');
  });

  void it('isolates two named stores; each restores independently', async () => {
    const memory = new MemoryStore();
    const audit  = new MemoryStore();
    await memory.set('x', 1);
    await audit.set('event', 'login');

    const result = await TestCheckpoint.abortedResult();
    const ckpt = await Checkpoint.capture('store-test', result, { 'stores': { memory, audit } });

    const cpStore = new MemoryCheckpointStore();
    await cpStore.save('run:2', ckpt.toJson());

    const json2 = await cpStore.load('run:2');
    assert.ok(json2 !== null, 'Expected persisted checkpoint to be retrievable');
    const raw: unknown = JSON.parse(json2);
    const recalled = Checkpoint.load(raw);

    const freshMemory = new MemoryStore();
    const freshAudit  = new MemoryStore();
    await recalled.restoreStores({ 'memory': freshMemory, 'audit': freshAudit });

    assert.equal(await freshMemory.get('x'), 1);
    assert.equal(await freshMemory.get('event'), null, 'audit entry should not bleed into memory');
    assert.equal(await freshAudit.get('event'), 'login');
    assert.equal(await freshAudit.get('x'), null, 'memory entry should not bleed into audit');
  });

  void it('restoreStores throws DAGError naming a store present in the checkpoint but absent from the map', async () => {
    const memory = new MemoryStore();
    await memory.set('k', 'v');

    const result = await TestCheckpoint.abortedResult();
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

  void it('restoreStores ignores extra stores in the map that are absent from the checkpoint', async () => {
    const memory = new MemoryStore();
    await memory.set('k', 'v');

    const result = await TestCheckpoint.abortedResult();
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

  void it('restoreStores propagates StoreError with INCOMPATIBLE_SNAPSHOT from store.restore', async () => {
    // Hand-construct a checkpoint whose stores.memory has the wrong type.
    const badRaw = {
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

  void it('capture with an empty stores option produces no store entries and a no-op restoreStores', async () => {
    const result = await TestCheckpoint.abortedResult();
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

  void it('capture with no stores option succeeds unchanged with a no-op restoreStores', async () => {
    const result = await TestCheckpoint.abortedResult();
    const ckpt = await Checkpoint.capture('store-test', result);

    assert.ok(ckpt instanceof Checkpoint, 'Expected a Checkpoint instance');
    assert.equal(ckpt.data.dagName, 'store-test');
    assert.equal(ckpt.data.cursor, result.cursor);

    // restoreStores on a no-stores checkpoint should be a no-op.
    await assert.doesNotReject(() => ckpt.restoreStores({}));
  });

  void it('round-trips a non-KV SnapshottableInterface that implements no key-value methods', async () => {
    const log = new FactLog();
    log.add('born');
    log.add('crawled');

    const result = await TestCheckpoint.abortedResult();
    const ckpt = await Checkpoint.capture('store-test', result, { 'stores': { 'log': log } });

    const cpStore = new MemoryCheckpointStore();
    await cpStore.save('run:nonkv', ckpt.toJson());

    const json = await cpStore.load('run:nonkv');
    assert.ok(json !== null, 'Expected persisted checkpoint to be retrievable');
    const parsedJson: unknown = JSON.parse(json);
    const recalled = Checkpoint.load(parsedJson);

    const freshLog = new FactLog();
    await recalled.restoreStores({ 'log': freshLog });

    assert.deepEqual([...freshLog.facts], ['born', 'crawled']);
  });

  void it('capture defaults store snapshots to one in-flight operation', async () => {
    const stats = { 'active': 0, 'max': 0 };
    const result = await TestCheckpoint.abortedResult();

    await Checkpoint.capture('store-test', result, {
      'stores': {
        'a': new ConcurrencyProbeStore('a', stats),
        'b': new ConcurrencyProbeStore('b', stats),
        'c': new ConcurrencyProbeStore('c', stats),
      },
    });

    assert.equal(stats.max, 1);
  });

  void it('capture accepts execution concurrency for store snapshots', async () => {
    const stats = { 'active': 0, 'max': 0 };
    const result = await TestCheckpoint.abortedResult();

    await Checkpoint.capture('store-test', result, {
      'execution': { 'concurrency': 2 },
      'stores': {
        'a': new ConcurrencyProbeStore('a', stats),
        'b': new ConcurrencyProbeStore('b', stats),
        'c': new ConcurrencyProbeStore('c', stats),
      },
    });

    assert.equal(stats.max, 2);
  });

  void it('restoreStores accepts execution concurrency for store restores', async () => {
    const captureStats = { 'active': 0, 'max': 0 };
    const restoreStats = { 'active': 0, 'max': 0 };
    const result = await TestCheckpoint.abortedResult();
    const ckpt = await Checkpoint.capture('store-test', result, {
      'execution': { 'concurrency': 3 },
      'stores': {
        'a': new ConcurrencyProbeStore('a', captureStats),
        'b': new ConcurrencyProbeStore('b', captureStats),
        'c': new ConcurrencyProbeStore('c', captureStats),
      },
    });

    await ckpt.restoreStores(
      {
        'a': new ConcurrencyProbeStore('a', restoreStats),
        'b': new ConcurrencyProbeStore('b', restoreStats),
        'c': new ConcurrencyProbeStore('c', restoreStats),
      },
      { 'execution': { 'concurrency': 2 } },
    );

    assert.equal(restoreStats.max, 2);
  });
});
