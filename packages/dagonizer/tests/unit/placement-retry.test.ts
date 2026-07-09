import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { BackoffStrategyNames } from '../../src/entities/runtime/BackoffStrategy.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Clock } from '../../src/runtime/Clock.js';
import { Scheduler } from '../../src/runtime/Scheduler.js';
import { VirtualScheduler } from '../../testing/VirtualScheduler.js';
import { TestNode } from '../_support/TestNode.js';

const EXHAUST_DAG_IRI = 'urn:noocodec:dag:retry-exhaust';
const EXHAUST_STEP_IRI = 'urn:noocodec:dag:retry-exhaust/node/step';
const EXHAUST_END_IRI = 'urn:noocodec:dag:retry-exhaust/node/end';
const BACKOFF_DAG_IRI = 'urn:noocodec:dag:retry-backoff';
const BACKOFF_STEP_IRI = 'urn:noocodec:dag:retry-backoff/node/step';
const BACKOFF_END_IRI = 'urn:noocodec:dag:retry-backoff/node/end';
const ABORT_DAG_IRI = 'urn:noocodec:dag:retry-abort';
const ABORT_STEP_IRI = 'urn:noocodec:dag:retry-abort/node/step';
const ABORT_END_IRI = 'urn:noocodec:dag:retry-abort/node/end';
const ERROR_ROUTE_DAG_IRI = 'urn:noocodec:dag:retry-error-route';
const ERROR_ROUTE_STEP_IRI = 'urn:noocodec:dag:retry-error-route/node/step';
const ERROR_ROUTE_END_IRI = 'urn:noocodec:dag:retry-error-route/node/end';
const ERROR_ROUTE_FAIL_IRI = 'urn:noocodec:dag:retry-error-route/node/fail';

/**
 * Drive the VirtualScheduler forward until `promise` settles.
 * Yields to the microtask queue between each advance so async code
 * can queue new scheduler entries.
 */
async function drainScheduler(sched: VirtualScheduler, stepMs: number, promise: PromiseLike<unknown>): Promise<void> {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });

  for (let i = 0; i < 200 && !settled; i++) {
    await new Promise<void>((r) => setImmediate(r));
    sched.advance(stepMs);
    await new Promise<void>((r) => setImmediate(r));
  }
}

void describe('placement-level retry wiring', () => {
  afterEach(() => {
    Scheduler.reset();
    Clock.reset();
  });

  void it('(a) retries N times when the node throws and exhausts attempts', async () => {
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);

    const calls: number[] = [];
    const d = new Dagonizer<NodeStateBase>();

    const throwingNode = TestNode.make('urn:noocodec:node:throw-node', ['success'], () => {
      calls.push(calls.length + 1);
      throw new Error('always fails');
    });
    d.registerNode(throwingNode);

    const testDag = new DAGBuilder(EXHAUST_DAG_IRI, '1', { 'name': 'exhaust-dag' })
      .node(EXHAUST_STEP_IRI, throwingNode, { 'success': EXHAUST_END_IRI }, {
        'name': 'step',
        'retry': { 'maxAttempts': 3, 'baseDelay': 0, 'strategy': BackoffStrategyNames.CONSTANT, 'jitterFactor': 0 },
      })
      .terminal(EXHAUST_END_IRI, { 'name': 'end', 'outcome': 'failed' })
      .build();
    d.registerDAG(testDag);

    const state = new NodeStateBase();
    await d.execute(EXHAUST_DAG_IRI, state);

    // Node was called exactly maxAttempts (3) times before the error propagated
    assert.equal(calls.length, 3);
    assert.equal(state.lifecycle.variant, 'failed');
  });

  void it('(b) backoff delays match the configured strategy', async () => {
    // `RetryPolicy` delays are scheduled by `@studnicky/retry`'s `Retry` (a
    // real timer, not the injected `Scheduler`), so this asserts wall-clock
    // elapsed time against a small real `baseDelay` rather than driving a
    // `VirtualScheduler`.
    const BASE_DELAY_MS = 20;

    const calls: number[] = [];
    const d = new Dagonizer<NodeStateBase>();

    const flakyNode = TestNode.make('urn:noocodec:node:flaky', ['success'], () => {
      const attempt = calls.length + 1;
      calls.push(attempt);
      if (attempt < 3) throw new Error('transient');
      return 'success';
    });
    d.registerNode(flakyNode);

    const testDag = new DAGBuilder(BACKOFF_DAG_IRI, '1', { 'name': 'backoff-dag' })
      .node(BACKOFF_STEP_IRI, flakyNode, { 'success': BACKOFF_END_IRI }, {
        'name': 'step',
        'retry': { 'maxAttempts': 3, 'baseDelay': BASE_DELAY_MS, 'strategy': BackoffStrategyNames.CONSTANT, 'jitterFactor': 0 },
      })
      .terminal(BACKOFF_END_IRI, { 'name': 'end' })
      .build();
    d.registerDAG(testDag);

    const state = new NodeStateBase();
    const startedAt = Date.now();
    await d.execute(BACKOFF_DAG_IRI, state);
    const elapsedMs = Date.now() - startedAt;

    // Success on the 3rd attempt: 2 constant-strategy sleeps of BASE_DELAY_MS each.
    assert.equal(calls.length, 3);
    assert.ok(elapsedMs >= BASE_DELAY_MS * 2, `expected at least ${(BASE_DELAY_MS * 2).toString()}ms elapsed, got ${elapsedMs.toString()}ms`);
    assert.equal(state.lifecycle.variant, 'completed');
  });

  void it('(c) aborting mid-retry causes the run to resolve as cancelled', async () => {
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);

    const d = new Dagonizer<NodeStateBase>();
    const controller = new AbortController();

    const alwaysFails = TestNode.make('urn:noocodec:node:abort-node', ['success'], () => {
      throw new Error('transient');
    });
    d.registerNode(alwaysFails);

    const testDag = new DAGBuilder(ABORT_DAG_IRI, '1', { 'name': 'abort-dag' })
      .node(ABORT_STEP_IRI, alwaysFails, { 'success': ABORT_END_IRI }, {
        'name': 'step',
        'retry': { 'maxAttempts': 3, 'baseDelay': 100, 'strategy': BackoffStrategyNames.CONSTANT, 'jitterFactor': 0 },
      })
      .terminal(ABORT_END_IRI, { 'name': 'end' })
      .build();
    d.registerDAG(testDag);

    const state = new NodeStateBase();
    const runPromise = d.execute(ABORT_DAG_IRI, state, { 'signal': controller.signal });

    // Abort after the first attempt fails and the backoff sleep is queued.
    await new Promise<void>((r) => setImmediate(r));
    controller.abort(new Error('user cancelled'));

    // Advance the VirtualScheduler past all remaining retries so the loop
    // exhausts, then the dispatch layer detects signal.aborted and marks cancelled.
    await drainScheduler(sched, 100, runPromise);
    await runPromise;

    assert.equal(state.lifecycle.variant, 'cancelled');
  });

  void it('(d) a node that routes to error is not retried', async () => {
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);

    const calls: number[] = [];
    const d = new Dagonizer<NodeStateBase>();

    const errorRouteNode = TestNode.make('urn:noocodec:node:route-error', ['success', 'error'], () => {
      calls.push(calls.length + 1);
      return 'error';
    });
    d.registerNode(errorRouteNode);

    const testDag = new DAGBuilder(ERROR_ROUTE_DAG_IRI, '1', { 'name': 'error-route-dag' })
      .node(ERROR_ROUTE_STEP_IRI, errorRouteNode, { 'success': ERROR_ROUTE_END_IRI, 'error': ERROR_ROUTE_FAIL_IRI }, {
        'name': 'step',
        'retry': { 'maxAttempts': 3, 'baseDelay': 0, 'strategy': BackoffStrategyNames.CONSTANT, 'jitterFactor': 0 },
      })
      .terminal(ERROR_ROUTE_END_IRI, { 'name': 'end' })
      .terminal(ERROR_ROUTE_FAIL_IRI, { 'name': 'fail', 'outcome': 'failed' })
      .build();
    d.registerDAG(testDag);

    const state = new NodeStateBase();
    await d.execute(ERROR_ROUTE_DAG_IRI, state);

    // Routing to 'error' is not a throw — no retry, node called exactly once
    assert.equal(calls.length, 1);
    assert.equal(state.lifecycle.variant, 'failed');
  });
});
