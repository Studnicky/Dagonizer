/**
 * placement-retry.test.ts — declarative per-placement retry.
 *
 * Tests engine behaviour when `SingleNodePlacementType.retry` is configured.
 * Uses VirtualScheduler so retry sleeps are instant; all timing is deterministic.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeOutputBuilder } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Scheduler } from '../../src/runtime/Scheduler.js';
import { VirtualScheduler } from '../../testing/VirtualScheduler.js';

// ---------------------------------------------------------------------------
// Support types
// ---------------------------------------------------------------------------

class RetryState extends NodeStateBase {
  result = '';
  attemptCount = 0;
}

// ---------------------------------------------------------------------------
// ThrowN node: throws for the first N-1 attempts, succeeds on attempt N.
// ---------------------------------------------------------------------------

class ThrowNNode extends ScalarNode<RetryState, 'success' | 'error'> {
  readonly name = 'throwN';
  readonly outputs = ['success', 'error'] as const;
  #failFor: number;
  #attempts = 0;

  constructor(failFor: number) {
    super();
    this.#failFor = failFor;
  }

  get attempts(): number { return this.#attempts; }

  override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return { 'success': { 'type': 'object' }, 'error': { 'type': 'object' } };
  }

  protected override async executeOne(
    state: RetryState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'success' | 'error'>> {
    this.#attempts++;
    state.attemptCount = this.#attempts;
    if (this.#attempts <= this.#failFor) {
      throw new Error(`attempt ${this.#attempts} failed`);
    }
    state.result = 'ok';
    return NodeOutputBuilder.of('success');
  }
}

// ---------------------------------------------------------------------------
// AlwaysThrowNode: always throws; used to test exhaustion.
// ---------------------------------------------------------------------------

class AlwaysThrowNode extends ScalarNode<RetryState, 'success' | 'error'> {
  readonly name = 'alwaysThrow';
  readonly outputs = ['success', 'error'] as const;
  #attempts = 0;

  get attempts(): number { return this.#attempts; }

  override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return { 'success': { 'type': 'object' }, 'error': { 'type': 'object' } };
  }

  protected override async executeOne(
    state: RetryState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'success' | 'error'>> {
    this.#attempts++;
    state.attemptCount = this.#attempts;
    throw new Error('always fails');
  }
}

// ---------------------------------------------------------------------------
// SlowNode: takes time so the abort signal fires mid-retry.
// ---------------------------------------------------------------------------

class SlowNode extends ScalarNode<RetryState, 'success' | 'error'> {
  readonly name = 'slowNode';
  readonly outputs = ['success', 'error'] as const;

  override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return { 'success': { 'type': 'object' }, 'error': { 'type': 'object' } };
  }

  protected override async executeOne(
    _state: RetryState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'success' | 'error'>> {
    // Throw immediately; we want the retry sleep to be interruptible.
    if (context.signal.aborted) throw new Error('aborted before attempt');
    throw new Error('slow node transient error');
  }
}

// ---------------------------------------------------------------------------
// TaggedThrowNode: throws an error whose message contains the output name tag.
// Used to test the `on` output filter.
// ---------------------------------------------------------------------------

class TaggedThrowNode extends ScalarNode<RetryState, 'success' | 'error' | 'timeout'> {
  readonly name = 'taggedThrow';
  readonly outputs = ['success', 'error', 'timeout'] as const;
  readonly #throwTag: string;
  #attempts = 0;

  constructor(throwTag: 'error' | 'timeout') {
    super();
    this.#throwTag = throwTag;
  }

  get attempts(): number { return this.#attempts; }

  override get outputSchema(): Record<'success' | 'error' | 'timeout', SchemaObjectType> {
    return {
      'success': { 'type': 'object' },
      'error':   { 'type': 'object' },
      'timeout': { 'type': 'object' },
    };
  }

  protected override async executeOne(
    state: RetryState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'success' | 'error' | 'timeout'>> {
    this.#attempts++;
    state.attemptCount = this.#attempts;
    // Throw with message containing the tag so the `on` filter can match it.
    throw new Error(`${this.#throwTag}: tagged failure`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDag(node: ThrowNNode | AlwaysThrowNode | SlowNode, maxAttempts: number): ReturnType<DAGBuilder['build']> {
  return new DAGBuilder('retry-test', '1')
    .node(
      node.name,
      node as Parameters<DAGBuilder['node']>[1],
      { 'success': 'end', 'error': 'end-error' },
      { "retry": { maxAttempts, "strategy": 'constant', "baseDelay": 100, "jitterFactor": 0 } },
    )
    .terminal('end')
    .terminal('end-error', { "outcome": 'failed' })
    .build();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void describe('Placement-level retry', () => {
  afterEach(() => { Scheduler.reset(); });

  void it('retries on node throw and succeeds within maxAttempts', async () => {
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);

    const throwN = new ThrowNNode(2);   // fails attempts 1 & 2, succeeds on 3
    const dag = buildDag(throwN, 3);

    const dispatcher = new Dagonizer<RetryState>();
    dispatcher.registerNode(throwN);
    dispatcher.registerDAG(dag);

    const state = new RetryState();
    // Kick-start the lazy Execution so the generator begins before the drive loop.
    const resultPromise = dispatcher.execute('retry-test', state).then((r) => r);

    // Drain two retry sleeps (100ms each under VirtualScheduler).
    for (let i = 0; i < 10; i++) {
      await new Promise<void>((r) => setImmediate(r));
      sched.advance(100);
    }

    const result = await resultPromise;
    assert.equal(state.result, 'ok');
    assert.equal(state.attemptCount, 3);
    assert.equal(throwN.attempts, 3);
    assert.equal(result.terminalOutcome, 'completed');
  });

  void it('routes to error output after retries are exhausted', async () => {
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);

    const alwaysThrow = new AlwaysThrowNode();
    const dag = buildDag(alwaysThrow, 2);

    const dispatcher = new Dagonizer<RetryState>();
    dispatcher.registerNode(alwaysThrow);
    dispatcher.registerDAG(dag);

    const state = new RetryState();
    // Kick-start the lazy Execution so the generator begins before the drive loop.
    const resultPromise = dispatcher.execute('retry-test', state).then((r) => r);

    for (let i = 0; i < 10; i++) {
      await new Promise<void>((r) => setImmediate(r));
      sched.advance(100);
    }

    const result = await resultPromise;
    // Exhausted maxAttempts (2); engine caught the throw; no TerminalNode reached.
    // terminalOutcome is null (throw path, not routed path); state lifecycle is failed.
    assert.equal(result.terminalOutcome, null);
    assert.equal(result.interruptedAt, null);
    assert.equal(state.lifecycle.variant, 'failed');
    assert.equal(alwaysThrow.attempts, 2);
  });

  void it('respects the on filter — retries when error matches, propagates when it does not', async () => {
    // Two sub-cases: one where the tag is in `on` (should retry), and one where
    // it is not (should not retry).
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);

    // Case A: throw tag = 'error', on = ['error'] → should retry.
    const errorNode = new TaggedThrowNode('error');
    const dagA = new DAGBuilder('on-filter-a', '1')
      .node(
        errorNode.name,
        errorNode as Parameters<DAGBuilder['node']>[1],
        { 'success': 'end', 'error': 'end-error', 'timeout': 'end-error' },
        { "retry": { "maxAttempts": 3, "strategy": 'constant', "baseDelay": 0, "jitterFactor": 0, "on": ['error'] } },
      )
      .terminal('end')
      .terminal('end-error', { "outcome": 'failed' })
      .build();

    const dispatcherA = new Dagonizer<RetryState>();
    dispatcherA.registerNode(errorNode);
    dispatcherA.registerDAG(dagA);

    const stateA = new RetryState();
    const promiseA = dispatcherA.execute('on-filter-a', stateA);
    for (let i = 0; i < 10; i++) {
      await new Promise<void>((r) => setImmediate(r));
      sched.advance(0);
    }
    const resultA = await promiseA;
    // Retried up to maxAttempts (3) since tag 'error' is in `on`.
    // Exhausted retries → throw path → state failed, no TerminalNode reached.
    assert.equal(resultA.terminalOutcome, null);
    assert.equal(stateA.lifecycle.variant, 'failed');
    assert.equal(errorNode.attempts, 3);

    // Case B: throw tag = 'timeout', on = ['error'] → should NOT retry.
    const timeoutNode = new TaggedThrowNode('timeout');
    const dagB = new DAGBuilder('on-filter-b', '1')
      .node(
        timeoutNode.name,
        timeoutNode as Parameters<DAGBuilder['node']>[1],
        { 'success': 'end', 'error': 'end-error', 'timeout': 'end-error' },
        { "retry": { "maxAttempts": 3, "strategy": 'constant', "baseDelay": 0, "jitterFactor": 0, "on": ['error'] } },
      )
      .terminal('end')
      .terminal('end-error', { "outcome": 'failed' })
      .build();

    const dispatcherB = new Dagonizer<RetryState>();
    dispatcherB.registerNode(timeoutNode);
    dispatcherB.registerDAG(dagB);

    const stateB = new RetryState();
    const resultB = await dispatcherB.execute('on-filter-b', stateB);
    // Did NOT retry — the 'timeout' tag is not in `on: ['error']`.
    // Throw propagated immediately → state failed, no TerminalNode reached.
    assert.equal(resultB.terminalOutcome, null);
    assert.equal(stateB.lifecycle.variant, 'failed');
    assert.equal(timeoutNode.attempts, 1);
  });

  void it('stops retrying immediately when the abort signal fires mid-sleep', async () => {
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);

    const slow = new SlowNode();
    const dag = new DAGBuilder('abort-retry', '1')
      .node(
        slow.name,
        slow as Parameters<DAGBuilder['node']>[1],
        { 'success': 'end', 'error': 'end-error' },
        { "retry": { "maxAttempts": 10, "strategy": 'constant', "baseDelay": 10_000, "jitterFactor": 0 } },
      )
      .terminal('end')
      .terminal('end-error', { "outcome": 'failed' })
      .build();

    const dispatcher = new Dagonizer<RetryState>();
    dispatcher.registerNode(slow);
    dispatcher.registerDAG(dag);

    const controller = new AbortController();
    const state = new RetryState();
    // Kick-start the lazy Execution so the generator begins before the abort.
    const resultPromise = dispatcher.execute('abort-retry', state, { "signal": controller.signal }).then((r) => r);

    // Let the first attempt throw and enter the sleep.
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setImmediate(r));
    // Abort mid-sleep instead of advancing 10 seconds.
    controller.abort(new Error('cancelled-by-test'));

    const result = await resultPromise;
    // Aborted mid-retry: engine records the interruption in interruptedAt.
    assert.ok(result.interruptedAt !== null, 'expected interruptedAt to be set on abort');
    assert.equal(result.interruptedAt.reason, 'abort');
  });
});
