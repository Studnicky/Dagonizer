/**
 * Per-node timeout tests.
 *
 * Verifies that a node's `timeoutMs` field causes the engine to pass a
 * scoped child signal, race the execute against a deadline, and surface a
 * `NodeTimeoutError` through the `onError` hook.
 *
 * Uses `VirtualScheduler` so the tests are deterministic and fast; no real
 * wall-clock timers fire.
 *
 * SCHEDULER ORDERING NOTE:
 * `Execution` is lazy; the generator starts when `Execution.then()` / `await`
 * is first awaited. To advance virtual time WHILE the node is executing, we
 * must start draining the execution, yield to the microtask queue so the node
 * begins, advance virtual time, then yield again so the timeout fires.
 *
 * Pattern used in every test:
 *   const runPromise = dispatcher.execute(...);
 *   // Start a concurrent advance loop
 *   const advancer = (async () => {
 *     await tick(); // let node execute start
 *     sched.advance(timeoutMs + 1);
 *     await tick(); // flush .then() microtasks
 *     sched.runAll();
 *     await tick(); // flush abort/race microtasks
 *   })();
 *   const result = await runPromise;
 *   await advancer; // ensure advancer completes
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import { NodeTimeoutError } from '../../src/errors/DAGError.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Scheduler } from '../../src/runtime/Scheduler.js';
import { VirtualScheduler } from '../../testing/VirtualScheduler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Yield to the microtask queue (one setImmediate cycle). */
const tick = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

/** Build a minimal single-node DAG wired to a single registered node. */
function buildSingleNodeDag(
  dispatcher: Dagonizer<NodeStateBase>,
  node: NodeInterface<NodeStateBase, string>,
  dagName: string,
  output: string,
): void {
  dispatcher.registerNode(node);
  dispatcher.registerDAG({
    '@context': DAG_CONTEXT,
    '@id':      `urn:noocodex:dag:${dagName}`,
    '@type':    'DAG',
    'name': dagName,
    'version': '1',
    'entrypoint': 'stage',
    'nodes': [{
      '@id':   `urn:noocodex:dag:${dagName}/node/stage`,
      '@type': 'SingleNode',
      'name':  'stage',
      'node':  node.name,
      'outputs': { [output]: null },
    }],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void describe('per-node timeoutMs', () => {
  afterEach(() => { Scheduler.reset(); });

  void it('aborts the node signal and rejects after timeoutMs elapses', async () => {
    const sched = new VirtualScheduler();
    Scheduler.configure(sched);

    let receivedSignal: AbortSignal | undefined;

    const slowNode: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'slow',
      'outputs': ['success'],
      'timeoutMs': 500,
      async execute(_state, context) {
        receivedSignal = context.signal;
        // Suspend indefinitely; the per-node deadline race wins.
        await new Promise<never>((_resolve, _reject) => {
          context.signal.addEventListener('abort', () => {
            _reject(context.signal.reason);
          }, { 'once': true });
        });
        return { 'output': 'success' };
      },
    };

    const dispatcher = new Dagonizer<NodeStateBase>();
    buildSingleNodeDag(dispatcher, slowNode, 'timeout-dag', 'success');

    const state = new NodeStateBase();
    const runPromise = dispatcher.execute('timeout-dag', state);

    // Advance virtual time concurrently while the execution is awaiting.
    // The execution is lazy; we must start awaiting it BEFORE advancing,
    // then yield so the scheduler entry is registered in VirtualScheduler.
    const advancer = (async (): Promise<void> => {
      await tick();                // let the generator start and register .after(500)
      sched.advance(501);          // trigger the timeout
      await tick();                // flush .then() → deadlineReject + childCtrl.abort
      sched.runAll();              // drain any remaining entries
      await tick();                // flush abort propagation to node signal
    })();

    const result = await runPromise;
    await advancer;

    // The child signal passed to the node must have fired.
    assert.ok(receivedSignal !== undefined, 'node should have received a signal');
    assert.equal(receivedSignal.aborted, true, 'node signal should be aborted after timeout');

    // The run must be marked failed (node timeout surfaces as failure).
    assert.equal(result.state.lifecycle.kind, 'failed');
    // Cursor points back at the timed-out stage.
    assert.equal(result.cursor, 'stage');
    // Cancellation telemetry records the node + reason.
    assert.deepEqual(result.interruptedAt, { 'nodeName': 'stage', 'reason': 'timeout' });
  });

  void it('fires onError with NodeTimeoutError when the node times out', async () => {
    const sched = new VirtualScheduler();
    Scheduler.configure(sched);

    const errors: Array<{ nodeName: string; error: Error }> = [];

    class ObservingDagonizer extends Dagonizer<NodeStateBase> {
      protected override onError(nodeName: string, error: Error): void {
        errors.push({ nodeName, error });
      }
    }

    const slowNode: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'tardy',
      'outputs': ['success'],
      'timeoutMs': 200,
      async execute(_state, context) {
        await new Promise<never>((_resolve, _reject) => {
          context.signal.addEventListener('abort', () => { _reject(context.signal.reason); }, { 'once': true });
        });
        return { 'output': 'success' };
      },
    };

    const dispatcher = new ObservingDagonizer();
    buildSingleNodeDag(dispatcher, slowNode, 'err-dag', 'success');

    const state = new NodeStateBase();
    const runPromise = dispatcher.execute('err-dag', state);

    const advancer = (async (): Promise<void> => {
      await tick();
      sched.advance(201);
      await tick();
      sched.runAll();
      await tick();
    })();

    await runPromise;
    await advancer;

    assert.equal(errors.length, 1, 'onError should fire exactly once');
    const [entry] = errors;
    assert.ok(entry !== undefined);
    assert.ok(
      entry.error instanceof NodeTimeoutError,
      `expected NodeTimeoutError, got ${entry.error.constructor.name}`,
    );
    const tErr = entry.error as NodeTimeoutError;
    assert.equal(tErr.nodeName, 'tardy');
    assert.equal(tErr.timeoutMs, 200);
  });

  void it('nodes without timeoutMs complete normally', async () => {
    const sched = new VirtualScheduler();
    Scheduler.configure(sched);

    const fastNode: NodeInterface<NodeStateBase, 'done'> = {
      'name': 'fast',
      'outputs': ['done'],
      async execute() {
        return { 'output': 'done' };
      },
    };

    const dispatcher = new Dagonizer<NodeStateBase>();
    buildSingleNodeDag(dispatcher, fastNode, 'fast-dag', 'done');

    const state = new NodeStateBase();
    const result = await dispatcher.execute('fast-dag', state);

    assert.equal(result.state.lifecycle.kind, 'completed');
    assert.equal(result.cursor, null);
    assert.equal(result.interruptedAt, null);
  });

  void it('run-level signal abort still cancels a node with timeoutMs', async () => {
    const sched = new VirtualScheduler();
    Scheduler.configure(sched);

    const slowNode: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'slow-cancel',
      'outputs': ['success'],
      'timeoutMs': 60_000, // very long node budget; run-level cancel wins
      async execute(_state, context) {
        await new Promise<never>((_resolve, _reject) => {
          context.signal.addEventListener('abort', () => { _reject(context.signal.reason); }, { 'once': true });
        });
        return { 'output': 'success' };
      },
    };

    const dispatcher = new Dagonizer<NodeStateBase>();
    buildSingleNodeDag(dispatcher, slowNode, 'cancel-dag', 'success');

    const state = new NodeStateBase();
    const ctrl = new AbortController();
    const runPromise = dispatcher.execute('cancel-dag', state, { 'signal': ctrl.signal });

    const advancer = (async (): Promise<void> => {
      await tick(); // let node execute start
      ctrl.abort(new Error('visitor cancelled'));
      await tick(); // flush the abort propagation
    })();

    const result = await runPromise;
    await advancer;

    assert.equal(result.state.lifecycle.kind, 'cancelled');
    assert.deepEqual(result.interruptedAt, { 'nodeName': 'stage', 'reason': 'abort' });
  });
});
