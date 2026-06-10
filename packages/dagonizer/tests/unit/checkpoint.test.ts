import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Checkpoint, CheckpointRestoreAdapterFn } from '../../src/checkpoint/Checkpoint.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import type { JsonObject } from '../../src/entities/json.js';
import { DAGError, ValidationError } from '../../src/errors/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Clock } from '../../src/runtime/Clock.js';
import { Scheduler } from '../../src/runtime/Scheduler.js';
import { VirtualClockProvider } from '../../testing/VirtualClock.js';
import { VirtualScheduler } from '../../testing/VirtualScheduler.js';

class CountingState extends NodeStateBase {
  count = 0;
  log: string[] = [];

  protected override snapshotData(): JsonObject {
    return { 'count': this.count, 'log': [...this.log] };
  }

  protected override restoreData(snapshot: JsonObject): void {
    const c = snapshot['count'];
    if (typeof c === 'number') this.count = c;
    const l = snapshot['log'];
    if (Array.isArray(l)) this.log = l.filter((x): x is string => typeof x === 'string');
  }
}

void describe('NodeStateBase snapshot/restore', () => {
  void it('preserves metadata and warnings; errors are excluded; resets lifecycle to pending', () => {
    const s = new NodeStateBase();
    s.setMetadata('k', { 'nested': [1, 2] });
    s.collectError({ 'code': 'E', 'message': 'm', 'operation': 'op',
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
    assert.equal(restored.lifecycle.kind, 'pending');
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

void describe('cursor on ExecutionResultInterface', () => {
  void it('is null on a clean completion', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const op: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'op',
      'outputs': ['success'],
      async execute() { return { 'output': 'success' }; },
    };
    dispatcher.registerNode(op);
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:clean',
      '@type':    'DAG',
      'name': 'clean', 'version': '1', 'entrypoint': 's',
      'nodes': [{
        '@id': 'urn:noocodex:dag:clean/node/s', '@type': 'SingleNode',
        'name': 's', 'node': 'op', 'outputs': { 'success': null },
      }],
    });
    const result = await dispatcher.execute('clean', new NodeStateBase());
    assert.equal(result.cursor, null);
  });

  void it('is the next node on abort', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    // nodeReady resolves once the node body starts executing (signal received).
    let resolveNodeReady!: () => void;
    const nodeReady = new Promise<void>((r) => { resolveNodeReady = r; });

    const op: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'op',
      'outputs': ['success'],
      async execute(_state, context) {
        resolveNodeReady();
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener('abort', () => { reject(context.signal.reason); }, { 'once': true });
        });
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(op);
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:two',
      '@type':    'DAG',
      'name': 'two', 'version': '1', 'entrypoint': 'a',
      'nodes': [
        { '@id': 'urn:noocodex:dag:two/node/a', '@type': 'SingleNode',
          'name': 'a', 'node': 'op', 'outputs': { 'success': 'b' } },
        { '@id': 'urn:noocodex:dag:two/node/b', '@type': 'SingleNode',
          'name': 'b', 'node': 'op', 'outputs': { 'success': null } },
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

void describe('Checkpoint round-trip', () => {
  afterEach(() => { Scheduler.reset(); Clock.reset(); });

  void it('capture + restoreState yields a state that resume()s to the same final state', async () => {
    Clock.configure(new VirtualClockProvider(0n));
    Scheduler.configure(new VirtualScheduler(0));

    const dispatcher = new Dagonizer<CountingState>();
    const inc: NodeInterface<CountingState, 'success'> = {
      'name': 'inc',
      'outputs': ['success'],
      async execute(state) {
        state.count++;
        state.log.push(`tick:${state.count}`);
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(inc);
    const dag: DAG = {
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
          'name': 'c', 'node': 'inc', 'outputs': { 'success': null } },
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
    const parsed = JSON.parse(round) as unknown;
    const ckpt2 = Checkpoint.load(parsed);
    const { state, dagName, cursor } = ckpt2.restoreState(CheckpointRestoreAdapterFn.fromFn((snap) => CountingState.restore(snap)));
    assert.equal(state.count, 1);
    assert.equal(cursor, 'b');
    const resumed = await dispatcher.resume(dagName, state, cursor);
    assert.equal(resumed.cursor, null);
    assert.equal(resumed.state.count, 3);
    assert.deepEqual(resumed.state.log, reference.state.log);
  });

  void it('rejects checkpointing a completed DAG', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const op: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'op',
      'outputs': ['success'],
      async execute() { return { 'output': 'success' }; },
    };
    dispatcher.registerNode(op);
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:done',
      '@type':    'DAG',
      'name': 'done', 'version': '1', 'entrypoint': 's',
      'nodes': [{
        '@id': 'urn:noocodex:dag:done/node/s', '@type': 'SingleNode',
        'name': 's', 'node': 'op', 'outputs': { 'success': null },
      }],
    });
    const result = await dispatcher.execute('done', new NodeStateBase());
    await assert.rejects(() => Checkpoint.capture('done', result), DAGError);
  });

  void it('load rejects malformed CheckpointData', () => {
    assert.throws(() => Checkpoint.load({ 'version': '1' }), ValidationError);
  });

  void it('restoreState throws ValidationError on null cursor', async () => {
    const data = {
      'version': '2', 'dagName': 'x', 'cursor': null,
      'state': {}, 'executedNodes': [], 'skippedNodes': [], 'stores': {},
    };
    const ckpt = Checkpoint.load(data);
    assert.throws(() => ckpt.restoreState(CheckpointRestoreAdapterFn.fromFn((snap) => NodeStateBase.restore(snap))), ValidationError);
  });

  void it('CheckpointRestoreAdapterFn.fromFn wraps a restore function in the adapter contract', () => {
    const data = {
      'version': '2', 'dagName': 'wrap-test', 'cursor': 'node-b',
      'state': { 'count': 5 }, 'executedNodes': ['node-a'], 'skippedNodes': [], 'stores': {},
    };
    const ckpt = Checkpoint.load(data);
    const adapter = CheckpointRestoreAdapterFn.fromFn((snap) => CountingState.restore(snap));
    const { dagName, cursor, state } = ckpt.restoreState(adapter);
    assert.equal(dagName, 'wrap-test');
    assert.equal(cursor, 'node-b');
    assert.equal(state.count, 5);
  });
});
