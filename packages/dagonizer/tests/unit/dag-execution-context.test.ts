import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { DagExecutionContext, DagExecutionContextKeys, DEFAULT_EXECUTION_SCOPE_CAPACITY } from '../../src/runtime/DagExecutionContext.js';
import { TestNode } from '../_support/TestNode.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const CORRELATED_DAG_IRI = 'urn:noocodec:dag:correlated';
const CORRELATED_FIRST_IRI = 'urn:noocodec:dag:correlated/node/first';
const CORRELATED_SECOND_IRI = 'urn:noocodec:dag:correlated/node/second-step';
const CORRELATED_END_IRI = 'urn:noocodec:dag:correlated/node/end';
const TERMINATES_DAG_IRI = 'urn:noocodec:dag:terminates';
const TERMINATES_ONLY_IRI = 'urn:noocodec:dag:terminates/node/only';
const TERMINATES_END_IRI = 'urn:noocodec:dag:terminates/node/end';
const SINGLE_RUN_DAG_IRI = 'urn:noocodec:dag:single-run';
const SINGLE_RUN_ONLY_IRI = 'urn:noocodec:dag:single-run/node/only';
const SINGLE_RUN_END_IRI = 'urn:noocodec:dag:single-run/node/end';
const SLOW_DAG_IRI = 'urn:noocodec:dag:slow-dag';
const SLOW_STEP_IRI = 'urn:noocodec:dag:slow-dag/node/step';
const SLOW_END_IRI = 'urn:noocodec:dag:slow-dag/node/end';
const FAST_DAG_IRI = 'urn:noocodec:dag:fast-dag';
const FAST_STEP_IRI = 'urn:noocodec:dag:fast-dag/node/step';
const FAST_END_IRI = 'urn:noocodec:dag:fast-dag/node/end';
const CLEANUP_DAG_IRI = 'urn:noocodec:dag:cleanup-run';
const CLEANUP_ONLY_IRI = 'urn:noocodec:dag:cleanup-run/node/only';
const CLEANUP_END_IRI = 'urn:noocodec:dag:cleanup-run/node/end';

/** A signal with no registered `DagExecutionContext` scope — used for the "no active run" assertions. */
const UNSCOPED_SIGNAL = new AbortController().signal;

class SeenState extends NodeStateBase {
  seen: { nodeName: string; correlationId: string | undefined; dagName: string | undefined; dagIri: string | undefined; runIri: string | undefined }[] = [];
}

void describe('DagExecutionContext correlation propagation', () => {
  void it('seeds a correlation id and dagName readable from every node during one run, without NodeContextType', async () => {
    const dispatcher = new Dagonizer<SeenState>();
    const record = (name: string): (state: SeenState, context: NodeContextType) => string => (state, context) => {
      state.seen.push({
        'nodeName': name,
        'correlationId': DagExecutionContext.tryGet(context.signal, DagExecutionContextKeys.CORRELATION_ID),
        'dagName': DagExecutionContext.tryGet(context.signal, DagExecutionContextKeys.DAG_NAME),
        'dagIri': DagExecutionContext.dagIriOf(context.signal),
        'runIri': DagExecutionContext.runIriOf(context.signal),
      });
      return 'success';
    };
    const firstNode = TestNode.make<SeenState>('urn:noocodec:node:first', ['success'], record('first'));
    const secondNode = TestNode.make<SeenState>('urn:noocodec:node:second', ['success'], record('second'));
    dispatcher.registerNode(firstNode);
    dispatcher.registerNode(secondNode);

    const dag = new DAGBuilder(CORRELATED_DAG_IRI, '1', { 'name': 'correlated' })
      .node(CORRELATED_FIRST_IRI, firstNode, { 'success': CORRELATED_SECOND_IRI }, { 'name': 'first' })
      .node(CORRELATED_SECOND_IRI, secondNode, { 'success': CORRELATED_END_IRI }, { 'name': 'second-step' })
      .terminal(CORRELATED_END_IRI, { 'name': 'end' })
      .build();
    dispatcher.registerDAG(dag);

    const state = new SeenState();
    await dispatcher.execute(CORRELATED_DAG_IRI, state);

    assert.equal(state.seen.length, 2);
    const [seenFirst, seenSecond] = state.seen;
    assert.ok(seenFirst);
    assert.ok(seenSecond);

    // Both nodes ran inside the same run and observed the same correlation id.
    assert.equal(seenFirst.correlationId, seenSecond.correlationId);
    assert.ok(seenFirst.correlationId !== undefined && UUID_PATTERN.test(seenFirst.correlationId));

    // Both nodes see the running DAG's name without it being threaded through
    // NodeContextType or any node constructor argument.
    assert.equal(seenFirst.dagName, CORRELATED_DAG_IRI);
    assert.equal(seenSecond.dagName, CORRELATED_DAG_IRI);
    assert.equal(seenFirst.dagIri, CORRELATED_DAG_IRI);
    assert.equal(seenSecond.dagIri, CORRELATED_DAG_IRI);
    assert.equal(seenFirst.runIri, seenSecond.runIri);
    assert.equal(seenFirst.runIri, state.runIri);
    assert.match(seenFirst.runIri ?? '', /\/run\//u);
  });

  void it('the scope is terminated once the run completes: its bindings are no longer readable', async () => {
    const dispatcher = new Dagonizer<SeenState>();
    let capturedSignal: AbortSignal | undefined;
    const only = TestNode.make<SeenState>('urn:noocodec:node:only', ['success'], (_state, context) => {
      capturedSignal = context.signal;
      return 'success';
    });
    dispatcher.registerNode(only);
    const dag = new DAGBuilder(TERMINATES_DAG_IRI, '1', { 'name': 'terminates' })
      .node(TERMINATES_ONLY_IRI, only, { 'success': TERMINATES_END_IRI }, { 'name': 'only' })
      .terminal(TERMINATES_END_IRI, { 'name': 'end' })
      .build();
    dispatcher.registerDAG(dag);

    await dispatcher.execute(TERMINATES_DAG_IRI, new SeenState());

    assert.ok(capturedSignal !== undefined);
    assert.equal(DagExecutionContext.tryGet(capturedSignal, DagExecutionContextKeys.CORRELATION_ID), undefined);
  });

  void it('generates a distinct correlation id per execute() call', async () => {
    const dispatcher = new Dagonizer<SeenState>();
    const seenIds: string[] = [];
    const only = TestNode.make<SeenState>('urn:noocodec:node:only', ['success'], (_state, context) => {
      const id = DagExecutionContext.tryGet(context.signal, DagExecutionContextKeys.CORRELATION_ID);
      if (id !== undefined) seenIds.push(id);
      return 'success';
    });
    dispatcher.registerNode(only);
    const dag = new DAGBuilder(SINGLE_RUN_DAG_IRI, '1', { 'name': 'single-run' })
      .node(SINGLE_RUN_ONLY_IRI, only, { 'success': SINGLE_RUN_END_IRI }, { 'name': 'only' })
      .terminal(SINGLE_RUN_END_IRI, { 'name': 'end' })
      .build();
    dispatcher.registerDAG(dag);

    await dispatcher.execute(SINGLE_RUN_DAG_IRI, new SeenState());
    await dispatcher.execute(SINGLE_RUN_DAG_IRI, new SeenState());

    assert.equal(seenIds.length, 2);
    assert.notEqual(seenIds[0], seenIds[1]);
  });

  void it('tryGet returns undefined for a signal with no registered scope', () => {
    assert.equal(DagExecutionContext.tryGet(UNSCOPED_SIGNAL, DagExecutionContextKeys.CORRELATION_ID), undefined);
  });

  /**
   * The correctness gap the trie-of-Maps design could not close: a node body
   * that reads context AFTER its own first internal `await` must still
   * observe its OWN run's scope, even while a second `Dagonizer.execute()`
   * call is interleaved on the event loop with a node body of its own doing
   * the same thing. A single swapped "current scope" pointer cannot
   * guarantee this — whichever run's synchronous turn happened to run last
   * before the awaits resolve would "win" for both. The `AbortSignal`-keyed
   * anchor is immune: each run's `context.signal` is a distinct object,
   * so `DagExecutionContext.tryGet(context.signal, ...)` resolves the right
   * scope purely by object identity, independent of the swapped-pointer
   * eliminated in this design and unaffected by execution-order timing.
   */
  void it('two concurrent execute() calls: a node reading context after its own await never observes the other run\'s correlation id', async () => {
    const dispatcher = new Dagonizer<SeenState>();

    // Deliberately staggered: 'slow' awaits longer than 'fast', so if any
    // ambient/swapped-pointer state leaked between runs, 'slow' would be the
    // one to observe 'fast's id (the last-set "current" scope by the time
    // 'slow' resumes) rather than its own.
    const makeDelayedReader = (delayMs: number): (state: SeenState, context: NodeContextType) => Promise<string> =>
      async (state, context) => {
        await new Promise<void>((resolve) => { setTimeout(resolve, delayMs); });
        const correlationId = DagExecutionContext.tryGet(context.signal, DagExecutionContextKeys.CORRELATION_ID);
        state.seen.push({ 'nodeName': 'delayed', correlationId, 'dagName': undefined, 'dagIri': undefined, 'runIri': undefined });
        return 'success';
      };

    const slowNode = TestNode.make<SeenState>('urn:noocodec:node:slow-node', ['success'], makeDelayedReader(20));
    const fastNode = TestNode.make<SeenState>('urn:noocodec:node:fast-node', ['success'], makeDelayedReader(1));
    dispatcher.registerNode(slowNode);
    dispatcher.registerNode(fastNode);

    const slowDag = new DAGBuilder(SLOW_DAG_IRI, '1', { 'name': 'slow-dag' })
      .node(SLOW_STEP_IRI, slowNode, { 'success': SLOW_END_IRI }, { 'name': 'step' })
      .terminal(SLOW_END_IRI, { 'name': 'end' })
      .build();
    const fastDag = new DAGBuilder(FAST_DAG_IRI, '1', { 'name': 'fast-dag' })
      .node(FAST_STEP_IRI, fastNode, { 'success': FAST_END_IRI }, { 'name': 'step' })
      .terminal(FAST_END_IRI, { 'name': 'end' })
      .build();
    dispatcher.registerDAG(slowDag);
    dispatcher.registerDAG(fastDag);

    const slowState = new SeenState();
    const fastState = new SeenState();

    // Launch both concurrently — the fast run's node body runs its own
    // `await`, resumes, and completes entirely while the slow run's node
    // body is still suspended in its own (longer) `await`.
    const [slowResult, fastResult] = await Promise.all([
      dispatcher.execute(SLOW_DAG_IRI, slowState),
      dispatcher.execute(FAST_DAG_IRI, fastState),
    ]);

    assert.equal(slowResult.terminalOutcome, 'completed');
    assert.equal(fastResult.terminalOutcome, 'completed');

    const slowSeen = slowState.seen[0];
    const fastSeen = fastState.seen[0];
    assert.ok(slowSeen);
    assert.ok(fastSeen);
    assert.ok(slowSeen.correlationId !== undefined && UUID_PATTERN.test(slowSeen.correlationId));
    assert.ok(fastSeen.correlationId !== undefined && UUID_PATTERN.test(fastSeen.correlationId));

    // Each run's own delayed read resolved its own correlation id — never
    // the other run's, despite the fast run fully completing while the slow
    // run was still suspended mid-`await`.
    assert.notEqual(slowSeen.correlationId, fastSeen.correlationId);
  });

  void it('explicit cleanup: a completed Execution removes its scope\'s bindings, not just anchors', async () => {
    // Distinct from the "scope is terminated" test above in intent: this
    // proves the underlying graph store itself no longer holds the
    // completed run's quads (the leak this scope's `terminate()` closes),
    // not merely that the anchor map forgot the signal.
    const dispatcher = new Dagonizer<SeenState>();
    let capturedSignal: AbortSignal | undefined;
    const only = TestNode.make<SeenState>('urn:noocodec:node:only', ['success'], (_state, context) => {
      capturedSignal = context.signal;
      return 'success';
    });
    dispatcher.registerNode(only);
    const dag = new DAGBuilder(CLEANUP_DAG_IRI, '1', { 'name': 'cleanup-run' })
      .node(CLEANUP_ONLY_IRI, only, { 'success': CLEANUP_END_IRI }, { 'name': 'only' })
      .terminal(CLEANUP_END_IRI, { 'name': 'end' })
      .build();
    dispatcher.registerDAG(dag);

    await dispatcher.execute(CLEANUP_DAG_IRI, new SeenState());

    assert.ok(capturedSignal !== undefined);
    // The signal is still referenced (held by this test), so the WeakMap
    // anchor itself has not been GC'd — yet the binding is gone, proving the
    // graph store's own quads were explicitly cleared by `terminate()`.
    assert.equal(DagExecutionContext.tryGet(capturedSignal, DagExecutionContextKeys.CORRELATION_ID), undefined);
    assert.equal(DagExecutionContext.tryGet(capturedSignal, DagExecutionContextKeys.DAG_NAME), undefined);
  });

  void it('bounded backstop: exceeding DEFAULT_EXECUTION_SCOPE_CAPACITY evicts the oldest never-terminated scope', () => {
    // Simulate `DEFAULT_EXECUTION_SCOPE_CAPACITY + 1` runs that never drain
    // (never call `terminate()`) — the exact failure mode explicit cleanup
    // alone would leave unbounded. `DagExecutionContext.initialize` is the
    // same entry point `Dagonizer.dagExecutionScope` uses, exercised
    // directly here so the test is a fast, focused unit of the backstop
    // rather than DEFAULT_EXECUTION_SCOPE_CAPACITY full DAG executions.
    const oldestSignal = new AbortController().signal;
    DagExecutionContext.initialize(
      { [DagExecutionContextKeys.CORRELATION_ID]: 'oldest' },
      oldestSignal,
    );

    let newestSignal: AbortSignal = oldestSignal;
    for (let i = 1; i < DEFAULT_EXECUTION_SCOPE_CAPACITY; i += 1) {
      const signal = new AbortController().signal;
      DagExecutionContext.initialize({ [DagExecutionContextKeys.CORRELATION_ID]: `run-${i}` }, signal);
      newestSignal = signal;
    }

    // Still within capacity: the oldest scope's binding is still readable.
    assert.equal(DagExecutionContext.tryGet(oldestSignal, DagExecutionContextKeys.CORRELATION_ID), 'oldest');

    // One more root scope pushes the registry past capacity, evicting the
    // least-recently-touched (oldest) entry.
    const overflowSignal = new AbortController().signal;
    DagExecutionContext.initialize({ [DagExecutionContextKeys.CORRELATION_ID]: 'overflow' }, overflowSignal);

    assert.equal(DagExecutionContext.tryGet(oldestSignal, DagExecutionContextKeys.CORRELATION_ID), undefined);
    // Scopes minted after the oldest remain intact — only capacity overflow evicts.
    assert.equal(DagExecutionContext.tryGet(newestSignal, DagExecutionContextKeys.CORRELATION_ID), `run-${DEFAULT_EXECUTION_SCOPE_CAPACITY - 1}`);
    assert.equal(DagExecutionContext.tryGet(overflowSignal, DagExecutionContextKeys.CORRELATION_ID), 'overflow');
  });
});
