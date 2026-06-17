/**
 * scatter-reservoir-dispatch: tests for reservoir scatter dispatching to
 * DAG bodies (both in-process and container-backed).
 *
 * Three suites:
 *
 * Suite A — reservoir + DAG body, in-process (Branch B of executeBatch):
 *   Verifies that a reservoir scatter whose body is a sub-DAG runs each
 *   batch of clones through the in-process runNodes path. Each clone's
 *   sub-DAG routes on `item.value % 2 === 0` (even → done-a, odd → done-b);
 *   all routes to 'completed'. The counting gather fold confirms all 8 items
 *   were processed.
 *
 * Suite B — reservoir + DAG body, container loopback (Branch C fallback):
 *   Uses a plain DagContainerInterface implementation (not a DagContainerBase
 *   subclass) to exercise the per-item fallback in Branch C. Asserts that
 *   container.runDag is called once per item and the gather accumulator
 *   reflects all 8 items.
 *
 * Suite C — reservoir + node body regression:
 *   Confirms that Branch A (node body) continues to work correctly with a
 *   reservoir + two-group source (6 items). Guards against the executeBatch
 *   refactor breaking the node-body path.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DagOutcomeInterface } from '../../src/container/DagOutcome.js';
import type { DagTaskInterface } from '../../src/container/DagTask.js';
import type { DagContainerInterface } from '../../src/contracts/DagContainerInterface.js';
import type { StateAccessor } from '../../src/contracts/StateAccessor.js';
import { GatherStrategies, GatherStrategy } from '../../src/core/GatherStrategies.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { ObserverRelay } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { GatherConfig } from '../../src/entities/dag/GatherConfig.js';
import type { DAG } from '../../src/entities/index.js';
import type { JsonObject } from '../../src/entities/json.js';
import type { NodeOutputInterface } from '../../src/entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';

// ── shared state ──────────────────────────────────────────────────────────────

class ReservoirDispatchState extends NodeStateBase {
  counter: number = 0;
  items: Array<{ group: string; value: number }> = [];

  protected override snapshotData(): JsonObject {
    return {
      'counter': this.counter,
      'items': this.items as unknown as JsonObject,
    };
  }

  protected override restoreData(snap: JsonObject): void {
    if (typeof snap['counter'] === 'number') this.counter = snap['counter'];
    const items = snap['items'];
    if (Array.isArray(items)) {
      this.items = items as Array<{ group: string; value: number }>;
    }
  }
}

// ── shared counting gather strategy ──────────────────────────────────────────

/**
 * ReservoirDispatchGather: compactable gather that increments `counter` by
 * batch.size for each reduce call. Named 'counting-test-reservoir' to avoid
 * conflicts with other test files that register 'counting-test'.
 */
class ReservoirDispatchGather extends GatherStrategy {
  readonly name = 'counting-test-reservoir';

  reduce(
    _config: GatherConfig,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    const current = accessor.get<number>(state, 'counter') ?? 0;
    accessor.set(state, 'counter', current + batch.size);
  }
}

GatherStrategies.register(new ReservoirDispatchGather());

// ── Suite A + B: sub-DAG route body ──────────────────────────────────────────

/**
 * RouterNode: reads `currentItem` metadata and routes `value % 2 === 0`
 * → 'even', otherwise → 'odd'.
 */
class RouterNode extends ScalarNode<ReservoirDispatchState, 'even' | 'odd'> {
  readonly name = 'router';
  readonly outputs = ['even', 'odd'] as const;

  protected async executeOne(state: ReservoirDispatchState): Promise<NodeOutputInterface<'even' | 'odd'>> {
    const item = state.getMetadata<{ group: string; value: number }>('currentItem');
    const output: 'even' | 'odd' = (item !== undefined && item.value % 2 === 0) ? 'even' : 'odd';
    return { 'errors': [], output };
  }
}

// Sub-DAG: router → (even → done-a, odd → done-b) → TerminalNode
const ROUTE_BODY_DAG_NAME = 'route-body';

const routeBodyDag: DAG = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:route-body',
  '@type': 'DAG',
  'name': ROUTE_BODY_DAG_NAME,
  'version': '1',
  'entrypoint': 'router',
  'nodes': [
    {
      '@id': 'urn:noocodex:dag:route-body/node/router',
      '@type': 'SingleNode',
      'name': 'router',
      'node': 'router',
      'outputs': { 'even': 'done-a', 'odd': 'done-b' },
    },
    {
      '@id': 'urn:noocodex:dag:route-body/node/done-a',
      '@type': 'TerminalNode',
      'name': 'done-a',
      'outcome': 'completed',
    },
    {
      '@id': 'urn:noocodex:dag:route-body/node/done-b',
      '@type': 'TerminalNode',
      'name': 'done-b',
      'outcome': 'completed',
    },
  ],
});

// Parent DAG for Suite A (no container)
const RESERVOIR_DAG_BODY_NAME = 'scatter-reservoir-dag';

const reservoirDagBodyDag: DAG = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:scatter-reservoir-dag',
  '@type': 'DAG',
  'name': RESERVOIR_DAG_BODY_NAME,
  'version': '1',
  'entrypoint': 'fan',
  'nodes': [
    {
      '@id': 'urn:noocodex:dag:scatter-reservoir-dag/node/fan',
      '@type': 'ScatterNode',
      'name': 'fan',
      'body': { 'dag': ROUTE_BODY_DAG_NAME },
      'source': 'items',
      'itemKey': 'currentItem',
      'reservoir': { 'keyField': 'group', 'capacity': 4 },
      'gather': { 'strategy': 'counting-test-reservoir' },
      'concurrency': 2,
      'outputs': {
        'all-success': 'end',
        'partial': 'end',
        'all-error': 'end',
        'empty': 'end',
      },
    },
    {
      '@id': 'urn:noocodex:dag:scatter-reservoir-dag/node/end',
      '@type': 'TerminalNode',
      'name': 'end',
      'outcome': 'completed',
    },
  ],
});

// Parent DAG for Suite B (with container)
const RESERVOIR_DAG_BODY_CONTAINER_NAME = 'scatter-reservoir-dag-container';
const CONTAINER_ROLE = 'cpu';

const reservoirDagBodyContainerDag: DAG = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:scatter-reservoir-dag-container',
  '@type': 'DAG',
  'name': RESERVOIR_DAG_BODY_CONTAINER_NAME,
  'version': '1',
  'entrypoint': 'fan',
  'nodes': [
    {
      '@id': 'urn:noocodex:dag:scatter-reservoir-dag-container/node/fan',
      '@type': 'ScatterNode',
      'name': 'fan',
      'body': { 'dag': ROUTE_BODY_DAG_NAME },
      'source': 'items',
      'itemKey': 'currentItem',
      'reservoir': { 'keyField': 'group', 'capacity': 4 },
      'gather': { 'strategy': 'counting-test-reservoir' },
      'concurrency': 2,
      'container': CONTAINER_ROLE,
      'outputs': {
        'all-success': 'end',
        'partial': 'end',
        'all-error': 'end',
        'empty': 'end',
      },
    },
    {
      '@id': 'urn:noocodex:dag:scatter-reservoir-dag-container/node/end',
      '@type': 'TerminalNode',
      'name': 'end',
      'outcome': 'completed',
    },
  ],
});

// ── Suite C: node body regression ─────────────────────────────────────────────

class PassThroughNode extends ScalarNode<ReservoirDispatchState, 'done'> {
  readonly name = 'pass-through';
  readonly outputs = ['done'] as const;

  protected async executeOne(): Promise<NodeOutputInterface<'done'>> {
    return { 'errors': [], 'output': 'done' };
  }
}

const RESERVOIR_NODE_BODY_NAME = 'scatter-reservoir-node-body';

const reservoirNodeBodyDag: DAG = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:scatter-reservoir-node-body',
  '@type': 'DAG',
  'name': RESERVOIR_NODE_BODY_NAME,
  'version': '1',
  'entrypoint': 'fan',
  'nodes': [
    {
      '@id': 'urn:noocodex:dag:scatter-reservoir-node-body/node/fan',
      '@type': 'ScatterNode',
      'name': 'fan',
      'body': { 'node': 'pass-through' },
      'source': 'items',
      'itemKey': 'item',
      'reservoir': { 'keyField': 'group', 'capacity': 3 },
      'gather': { 'strategy': 'counting-test-reservoir' },
      'outputs': {
        'all-success': 'end',
        'partial': 'end',
        'all-error': 'end',
        'empty': 'end',
      },
    },
    {
      '@id': 'urn:noocodex:dag:scatter-reservoir-node-body/node/end',
      '@type': 'TerminalNode',
      'name': 'end',
      'outcome': 'completed',
    },
  ],
});

// ── Suite A ───────────────────────────────────────────────────────────────────

void describe('Scatter reservoir: DAG body in-process (Branch B)', () => {
  void it('processes all 8 items through the sub-DAG; gather counter equals 8', async () => {
    const dispatcher = new Dagonizer<ReservoirDispatchState>();
    dispatcher.registerNode(new RouterNode());
    dispatcher.registerDAG(routeBodyDag);
    dispatcher.registerDAG(reservoirDagBodyDag);

    const state = new ReservoirDispatchState();
    state.items = [
      { 'group': 'A', 'value': 0 },
      { 'group': 'A', 'value': 1 },
      { 'group': 'A', 'value': 2 },
      { 'group': 'A', 'value': 3 },
      { 'group': 'A', 'value': 4 },
      { 'group': 'A', 'value': 5 },
      { 'group': 'A', 'value': 6 },
      { 'group': 'A', 'value': 7 },
    ];

    const result = await dispatcher.execute(RESERVOIR_DAG_BODY_NAME, state);

    assert.strictEqual(result.cursor, null, 'flow must complete without a resume cursor');
    assert.strictEqual(
      result.state.errors.filter((e) => e.recoverable === false).length,
      0,
      'no unrecoverable errors expected',
    );
    assert.strictEqual(
      result.state.counter,
      8,
      `gather counter must equal 8 (one reduce call per item); got ${result.state.counter}`,
    );
  });
});

// ── Suite B ───────────────────────────────────────────────────────────────────

/**
 * Build a plain DagContainerInterface loopback that runs the sub-DAG
 * in-process. This is NOT a DagContainerBase subclass, so it exercises the
 * per-item fallback path in Branch C of executeBatch.
 */
function buildLoopbackContainer(
  innerDispatcher: Dagonizer<ReservoirDispatchState>,
  callCounter: { count: number },
): DagContainerInterface<ReservoirDispatchState> {
  return {
    async runDag(
      task: DagTaskInterface<ReservoirDispatchState, unknown>,
      _options?: { readonly relay?: ObserverRelay },
    ): Promise<DagOutcomeInterface> {
      callCounter.count++;
      const cloneState = task.state;
      try {
        const exec = innerDispatcher.execute(task.dagName, cloneState);
        const iter = exec[Symbol.asyncIterator]();
        let step = await iter.next();
        while (!step.done) {
          step = await iter.next();
        }
        const terminal = step.value;
        return {
          'terminalOutput': terminal.state.lifecycle.kind === 'failed' ? 'failed' : 'completed',
          'errors': [...terminal.state.errors],
          'stateSnapshot': terminal.state.snapshot(),
          'intermediates': [],
        };
      } catch (err: unknown) {
        return {
          'terminalOutput': 'failed',
          'errors': [{
            'code': 'CONTAINER_ERROR',
            'context': {},
            'message': err instanceof Error ? err.message : String(err),
            'operation': 'runDag',
            'recoverable': false,
            'timestamp': new Date().toISOString(),
          }],
          'stateSnapshot': null,
          'intermediates': [],
        };
      }
    },
  };
}

void describe('Scatter reservoir: DAG body with container loopback (Branch C fallback)', () => {
  void it('routes each item through container.runDag; runDag called once per item; gather counter equals 8', async () => {
    // Inner dispatcher runs the sub-DAG in-process.
    const innerDispatcher = new Dagonizer<ReservoirDispatchState>();
    innerDispatcher.registerNode(new RouterNode());
    innerDispatcher.registerDAG(routeBodyDag);

    const callCounter = { 'count': 0 };
    const loopbackContainer = buildLoopbackContainer(innerDispatcher, callCounter);

    const dispatcher = new Dagonizer<ReservoirDispatchState>({
      'containers': { [CONTAINER_ROLE]: loopbackContainer },
    });
    dispatcher.registerNode(new RouterNode());
    dispatcher.registerDAG(routeBodyDag);
    dispatcher.registerDAG(reservoirDagBodyContainerDag);

    const state = new ReservoirDispatchState();
    state.items = [
      { 'group': 'A', 'value': 0 },
      { 'group': 'A', 'value': 1 },
      { 'group': 'A', 'value': 2 },
      { 'group': 'A', 'value': 3 },
      { 'group': 'A', 'value': 4 },
      { 'group': 'A', 'value': 5 },
      { 'group': 'A', 'value': 6 },
      { 'group': 'A', 'value': 7 },
    ];

    const result = await dispatcher.execute(RESERVOIR_DAG_BODY_CONTAINER_NAME, state);

    assert.strictEqual(result.cursor, null, 'flow must complete without a resume cursor');
    assert.strictEqual(
      result.state.errors.filter((e) => e.recoverable === false).length,
      0,
      'no unrecoverable errors expected',
    );
    assert.strictEqual(
      result.state.counter,
      8,
      `gather counter must equal 8; got ${result.state.counter}`,
    );
    // Branch C fallback: plain DagContainerInterface → per-item runDag calls.
    assert.strictEqual(
      callCounter.count,
      8,
      `container.runDag must be called once per item (8 total); got ${callCounter.count}`,
    );
  });
});

// ── Suite C ───────────────────────────────────────────────────────────────────

void describe('Scatter reservoir: node body regression (Branch A)', () => {
  void it('processes 6 items across two reservoir groups; gather counter equals 6', async () => {
    const dispatcher = new Dagonizer<ReservoirDispatchState>();
    dispatcher.registerNode(new PassThroughNode());
    dispatcher.registerDAG(reservoirNodeBodyDag);

    const state = new ReservoirDispatchState();
    // Two groups of 3 items each; reservoir capacity=3 releases per group.
    state.items = [
      { 'group': 'A', 'value': 0 },
      { 'group': 'A', 'value': 1 },
      { 'group': 'A', 'value': 2 },
      { 'group': 'B', 'value': 3 },
      { 'group': 'B', 'value': 4 },
      { 'group': 'B', 'value': 5 },
    ];

    const result = await dispatcher.execute(RESERVOIR_NODE_BODY_NAME, state);

    assert.strictEqual(result.cursor, null, 'flow must complete without a resume cursor');
    assert.strictEqual(
      result.state.errors.filter((e) => e.recoverable === false).length,
      0,
      'no unrecoverable errors expected',
    );
    assert.strictEqual(
      result.state.counter,
      6,
      `gather counter must equal 6 (one per item); got ${result.state.counter}`,
    );
  });
});
