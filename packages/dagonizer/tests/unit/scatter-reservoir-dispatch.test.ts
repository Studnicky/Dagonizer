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
 *
 * Suite D — reservoir + DAG body through a REAL DagContainerBase (Branch C
 *   runDagBatch path):
 *   Wires a real DagHost + LoopbackChannel behind a DagContainerBase subclass
 *   so Branch C takes the `instanceof DagContainerBase` → runDagBatch branch
 *   (one transport round-trip per released batch). The host genuinely runs the
 *   sub-DAG, so per-item routing is real: even values route to the `accept`
 *   terminal (outcome completed → success), odd values to the `reject` terminal
 *   (outcome failed → error). Asserts (a) clean completion, (b) the per-item
 *   even/odd split is preserved across the transport, (c) the execute-message
 *   count equals the number of BATCHES (2), not items (8) — the proof the
 *   batch round-trip ran — and (d) parity with the in-process Branch B run.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CheckpointRestoreAdapter } from '../../src/checkpoint/Checkpoint.js';
import type { InitMessageShapeType } from '../../src/container/ChannelDispatch.js';
import { DagContainerBase } from '../../src/container/DagContainerBase.js';
import type { PoolEntryType } from '../../src/container/DagContainerBase.js';
import { DagHost } from '../../src/container/DagHost.js';
import type { DagOutcomeType } from '../../src/container/DagOutcome.js';
import type { DagTaskInterface } from '../../src/container/DagTask.js';
import type { CheckpointRestoreAdapterInterface } from '../../src/contracts/CheckpointRestoreAdapterInterface.js';
import type { DagContainerInterface } from '../../src/contracts/DagContainerInterface.js';
import type { DispatcherBundleType } from '../../src/contracts/DispatcherBundle.js';
import type { MessageChannelInterface } from '../../src/contracts/MessageChannelInterface.js';
import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import type { ObserverRelayInterface } from '../../src/contracts/ObserverRelayInterface.js';
import type { RegistryBundleInterface } from '../../src/contracts/RegistryBundleInterface.js';
import type { RegistryModuleInterface } from '../../src/contracts/RegistryModuleInterface.js';
import type { StateAccessorInterface } from '../../src/contracts/StateAccessorInterface.js';
import { GatherStrategies, GatherStrategy } from '../../src/core/GatherStrategies.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import type { ItemType } from '../../src/entities/batch/Item.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { GatherConfigType } from '../../src/entities/dag/GatherConfig.js';
import type { BridgeMessageType } from '../../src/entities/executor/BridgeMessage.js';
import type { DAGType } from '../../src/entities/index.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import { JsonValue } from '../../src/entities/JsonValue.js';
import { DagGraphProjector } from '../../src/graph/DagGraphProjector.js';
import { DagGraphQueries } from '../../src/graph/DagGraphQueries.js';
import { InMemoryTopologyStore } from '../../src/graph/InMemoryTopologyStore.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';

// ── shared state ──────────────────────────────────────────────────────────────

class ReservoirDispatchState extends NodeStateBase {
  counter: number = 0;
  items: Array<{ group: string; value: number; dagName?: string }> = [];
  /** Per-item output recorded by the recording gather: value → 'success'|'error'. */
  outputByValue: Record<string, string> = {};

  protected override snapshotData(): JsonObjectType {
    return {
      'counter': this.counter,
      'items': JsonValue.from(this.items),
      'outputByValue': JsonValue.from(this.outputByValue),
    };
  }

  protected override restoreData(snap: JsonObjectType): void {
    if (typeof snap['counter'] === 'number') this.counter = snap['counter'];
    const items = snap['items'];
    if (Array.isArray(items)) {
      this.items = items.filter(
        (x): x is { group: string; value: number; dagName?: string } =>
          typeof x === 'object' && x !== null && !Array.isArray(x) &&
          typeof x['group'] === 'string' && typeof x['value'] === 'number' &&
          (x['dagName'] === undefined || typeof x['dagName'] === 'string'),
      );
    }
    const recorded = snap['outputByValue'];
    if (recorded !== null && typeof recorded === 'object' && !Array.isArray(recorded)) {
      const safe: Record<string, string> = {};
      for (const [k, v] of Object.entries(recorded)) {
        if (typeof v === 'string') safe[k] = v;
      }
      this.outputByValue = safe;
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
    _config: GatherConfigType,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    const rawCounter = accessor.get(state, 'counter');
    const current = typeof rawCounter === 'number' ? rawCounter : 0;
    accessor.set(state, 'counter', current + batch.size);
  }
}

GatherStrategies.register(new ReservoirDispatchGather());

/** Type guard for gather record items with `group` and `value` fields. */
class ReservoirRecordGuard {
  private constructor() {}

  static is(v: unknown): v is { group: string; value: number } {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    const group = Reflect.get(v, 'group');
    const value = Reflect.get(v, 'value');
    return typeof group === 'string' && typeof value === 'number';
  }
}

/**
 * ReservoirRecordingGather: like the counting gather, but also records each
 * item's routing output keyed by the item's `value`. Lets Suite D assert the
 * per-item even/odd → success/error split survived the transport round-trip.
 */
class ReservoirRecordingGather extends GatherStrategy {
  readonly name = 'recording-test-reservoir';

  reduce(
    _config: GatherConfigType,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    const rawCounter2 = accessor.get(state, 'counter');
    const current = typeof rawCounter2 === 'number' ? rawCounter2 : 0;
    accessor.set(state, 'counter', current + batch.size);

    const rawRecorded = accessor.get(state, 'outputByValue');
    const recorded: Record<string, string> = (typeof rawRecorded === 'object' && rawRecorded !== null && !Array.isArray(rawRecorded))
      ? Object.fromEntries(Object.entries(rawRecorded).filter((e): e is [string, string] => typeof e[1] === 'string'))
      : {};
    for (const entry of batch) {
      const record = entry.state;
      if (ReservoirRecordGuard.is(record.item)) {
        recorded[String(record.item.value)] = record.output;
      }
    }
    accessor.set(state, 'outputByValue', recorded);
  }
}

GatherStrategies.register(new ReservoirRecordingGather());

// ── Suite A + B: sub-DAG route body ──────────────────────────────────────────

/** Type guard for items stored in `currentItem` metadata. */
class CurrentItemGuard {
  private constructor() {}

  static is(v: unknown): v is { group: string; value: number } {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    return typeof Reflect.get(v, 'value') === 'number';
  }
}

/**
 * RouterNode: reads `currentItem` metadata and routes `value % 2 === 0`
 * → 'even', otherwise → 'odd'.
 *
 * Extends MonadicNode<NodeStateBase> so the node is structurally compatible
 * with NodeInterface<NodeStateInterface> — required for Suite D's bundle
 * (DispatcherBundleType<NodeStateInterface>) without casting.
 * getMetadata is declared on NodeStateBase, so narrowing via the base type
 * is safe.
 */
class RouterNode extends MonadicNode<NodeStateBase, 'even' | 'odd'> {
  override readonly name = 'router';
  override readonly outputs = ['even', 'odd'] as const;

  override get outputSchema(): Record<'even' | 'odd', SchemaObjectType> {
    return { 'even': { 'type': 'object' }, 'odd': { 'type': 'object' } };
  }

  override async execute(batch: Batch<NodeStateBase>): Promise<Map<'even' | 'odd', Batch<NodeStateBase>>> {
    const even: ItemType<NodeStateBase>[] = [];
    const odd: ItemType<NodeStateBase>[] = [];
    for (const item of batch) {
      const raw = item.state.getMetadata('currentItem');
      const output: 'even' | 'odd' = (CurrentItemGuard.is(raw) && raw.value % 2 === 0) ? 'even' : 'odd';
      if (output === 'even') even.push(item);
      else odd.push(item);
    }
    const routed = new Map<'even' | 'odd', Batch<NodeStateBase>>();
    if (even.length > 0) routed.set('even', Batch.from(even));
    if (odd.length > 0) routed.set('odd', Batch.from(odd));
    return routed;
  }
}

// Sub-DAG: router → (even → done-a, odd → done-b) → TerminalNode
const ROUTE_BODY_DAG_NAME = 'route-body';

const routeBodyDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:route-body',
  '@type': 'DAG',
  'name': ROUTE_BODY_DAG_NAME,
  'version': '1',
  'entrypoints': { 'main': 'router' },
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

const reservoirDagBodyDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:scatter-reservoir-dag',
  '@type': 'DAG',
  'name': RESERVOIR_DAG_BODY_NAME,
  'version': '1',
  'entrypoints': { 'main': 'fan' },
  'nodes': [
    {
      '@id': 'urn:noocodex:dag:scatter-reservoir-dag/node/fan',
      '@type': 'ScatterNode',
      'name': 'fan',
      'body': { 'dag': ROUTE_BODY_DAG_NAME },
      'source': 'items',
      'itemKey': 'currentItem',      'gather': { 'strategy': 'counting-test-reservoir' },
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'group', 'capacity': 4 }, 'concurrency': 2 },
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

const DYNAMIC_RESERVOIR_ACCEPT_DAG_NAME = 'dynamic-reservoir-accept';
const DYNAMIC_RESERVOIR_REJECT_DAG_NAME = 'dynamic-reservoir-reject';
const DYNAMIC_RESERVOIR_PARENT_DAG_NAME = 'dynamic-reservoir-parent';

const dynamicReservoirAcceptDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:dynamic-reservoir-accept',
  '@type': 'DAG',
  'name': DYNAMIC_RESERVOIR_ACCEPT_DAG_NAME,
  'version': '1',
  'entrypoints': { 'main': 'done' },
  'nodes': [
    {
      '@id': 'urn:noocodex:dag:dynamic-reservoir-accept/node/done',
      '@type': 'TerminalNode',
      'name': 'done',
      'outcome': 'completed',
    },
  ],
});

const dynamicReservoirRejectDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:dynamic-reservoir-reject',
  '@type': 'DAG',
  'name': DYNAMIC_RESERVOIR_REJECT_DAG_NAME,
  'version': '1',
  'entrypoints': { 'main': 'failed' },
  'nodes': [
    {
      '@id': 'urn:noocodex:dag:dynamic-reservoir-reject/node/failed',
      '@type': 'TerminalNode',
      'name': 'failed',
      'outcome': 'failed',
    },
  ],
});

const dynamicReservoirParentDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:dynamic-reservoir-parent',
  '@type': 'DAG',
  'name': DYNAMIC_RESERVOIR_PARENT_DAG_NAME,
  'version': '1',
  'entrypoints': { 'main': 'fan' },
  'nodes': [
    {
      '@id': 'urn:noocodex:dag:dynamic-reservoir-parent/node/fan',
      '@type': 'ScatterNode',
      'name': 'fan',
      'body': {
        'dag': {
          '@type': 'DagReference',
          'from': 'item',
          'path': 'dagName',
          'candidates': [DYNAMIC_RESERVOIR_ACCEPT_DAG_NAME, DYNAMIC_RESERVOIR_REJECT_DAG_NAME],
        },
      },
      'source': 'items',
      'itemKey': 'currentItem',
      'gather': { 'strategy': 'recording-test-reservoir' },
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'group', 'capacity': 4 }, 'concurrency': 1 },
      'outputs': {
        'all-success': 'end',
        'partial': 'end',
        'all-error': 'end',
        'empty': 'end',
      },
    },
    {
      '@id': 'urn:noocodex:dag:dynamic-reservoir-parent/node/end',
      '@type': 'TerminalNode',
      'name': 'end',
      'outcome': 'completed',
    },
  ],
});

// Parent DAG for Suite B (with container)
const RESERVOIR_DAG_BODY_CONTAINER_NAME = 'scatter-reservoir-dag-container';
const CONTAINER_ROLE = 'cpu';

const reservoirDagBodyContainerDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:scatter-reservoir-dag-container',
  '@type': 'DAG',
  'name': RESERVOIR_DAG_BODY_CONTAINER_NAME,
  'version': '1',
  'entrypoints': { 'main': 'fan' },
  'nodes': [
    {
      '@id': 'urn:noocodex:dag:scatter-reservoir-dag-container/node/fan',
      '@type': 'ScatterNode',
      'name': 'fan',
      'body': { 'dag': ROUTE_BODY_DAG_NAME },
      'source': 'items',
      'itemKey': 'currentItem',      'gather': { 'strategy': 'counting-test-reservoir' },
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'group', 'capacity': 4 }, 'concurrency': 2 },
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

class PassThroughNode extends MonadicNode<ReservoirDispatchState, 'done'> {
  override readonly name = 'pass-through';
  override readonly outputs = ['done'] as const;

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ReservoirDispatchState>): Promise<Map<'done', Batch<ReservoirDispatchState>>> {
    return new Map([['done', batch]]);
  }
}

const RESERVOIR_NODE_BODY_NAME = 'scatter-reservoir-node-body';

const reservoirNodeBodyDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:scatter-reservoir-node-body',
  '@type': 'DAG',
  'name': RESERVOIR_NODE_BODY_NAME,
  'version': '1',
  'entrypoints': { 'main': 'fan' },
  'nodes': [
    {
      '@id': 'urn:noocodex:dag:scatter-reservoir-node-body/node/fan',
      '@type': 'ScatterNode',
      'name': 'fan',
      'body': { 'node': 'pass-through' },
      'source': 'items',
      'itemKey': 'item',      'gather': { 'strategy': 'counting-test-reservoir' },
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'group', 'capacity': 3 } },
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

void describe('Scatter reservoir: DAGType body in-process (Branch B)', () => {
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

  void it('partitions a mixed dynamic DagReference reservoir batch by selected DAG', async () => {
    const store = new InMemoryTopologyStore();
    const dispatcher = new Dagonizer<ReservoirDispatchState>({ 'executionTopologyStore': store });
    dispatcher.registerDAG(dynamicReservoirAcceptDag);
    dispatcher.registerDAG(dynamicReservoirRejectDag);
    dispatcher.registerDAG(dynamicReservoirParentDag);

    const state = new ReservoirDispatchState();
    state.items = [
      { 'group': 'A', 'value': 0, 'dagName': DYNAMIC_RESERVOIR_ACCEPT_DAG_NAME },
      { 'group': 'A', 'value': 1, 'dagName': DYNAMIC_RESERVOIR_REJECT_DAG_NAME },
      { 'group': 'A', 'value': 2, 'dagName': DYNAMIC_RESERVOIR_ACCEPT_DAG_NAME },
      { 'group': 'A', 'value': 3, 'dagName': DYNAMIC_RESERVOIR_REJECT_DAG_NAME },
    ];

    const result = await dispatcher.execute(DYNAMIC_RESERVOIR_PARENT_DAG_NAME, state);

    assert.strictEqual(result.cursor, null, 'flow must complete without a resume cursor');
    assert.deepStrictEqual(result.state.outputByValue, {
      '0': 'success',
      '1': 'error',
      '2': 'success',
      '3': 'error',
    });

    const ownerBaseIri = DagGraphProjector.placementIri(DagGraphProjector.dagIri(dynamicReservoirParentDag), 'fan');
    const acceptIri = DagGraphProjector.dagIri(dynamicReservoirAcceptDag);
    const rejectIri = DagGraphProjector.dagIri(dynamicReservoirRejectDag);
    const rows = [...DagGraphQueries.selectedDagRows(store)].sort((left, right) => left.ownerIri.localeCompare(right.ownerIri));
    assert.deepStrictEqual(rows, [
      { 'ownerIri': `${ownerBaseIri}/item/0`, 'dagIri': acceptIri },
      { 'ownerIri': `${ownerBaseIri}/item/1`, 'dagIri': rejectIri },
      { 'ownerIri': `${ownerBaseIri}/item/2`, 'dagIri': acceptIri },
      { 'ownerIri': `${ownerBaseIri}/item/3`, 'dagIri': rejectIri },
    ]);
  });
});

// ── Suite B ───────────────────────────────────────────────────────────────────

/** Loopback DagContainerInterface that runs sub-DAGs in-process for Suite B. */
class LoopbackContainer {
  private constructor() {}

  static forDispatcher(
    innerDispatcher: Dagonizer<ReservoirDispatchState>,
    callCounter: { count: number },
  ): DagContainerInterface {
    return {
      async runDag(
        task: DagTaskInterface,
        _options?: { readonly relay?: ObserverRelayInterface },
      ): Promise<DagOutcomeType> {
        callCounter.count++;
        const rawState = task.state;
        if (!(rawState instanceof ReservoirDispatchState)) {
          throw new Error(`LoopbackContainer: expected ReservoirDispatchState, got ${rawState.constructor.name}`);
        }
        try {
          const exec = innerDispatcher.execute(task.dagName, rawState);
          const iter = exec[Symbol.asyncIterator]();
          let step = await iter.next();
          while (!step.done) {
            step = await iter.next();
          }
          const terminal = step.value;
          return {
            'terminalOutput': terminal.state.lifecycle.variant === 'failed' ? 'failed' : 'completed',
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
}

void describe('Scatter reservoir: DAGType body with container loopback (Branch C fallback)', () => {
  void it('routes each item through container.runDag; runDag called once per item; gather counter equals 8', async () => {
    // Inner dispatcher runs the sub-DAG in-process.
    const innerDispatcher = new Dagonizer<ReservoirDispatchState>();
    innerDispatcher.registerNode(new RouterNode());
    innerDispatcher.registerDAG(routeBodyDag);

    const callCounter = { 'count': 0 };
    const loopbackContainer = LoopbackContainer.forDispatcher(innerDispatcher, callCounter);

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

// ── Suite D: reservoir + DAG body through a REAL DagContainerBase ──────────────

// Sub-DAG: router → (even → accept[completed], odd → reject[failed]) → terminal.
// The `reject` terminal carries `outcome: 'failed'` so odd items route to the
// scatter's `error` output, producing a genuine success/error split that the
// transport must carry back per item.
const ROUTE_BODY_D_DAG_NAME = 'route-body-d';

const routeBodyDDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:route-body-d',
  '@type': 'DAG',
  'name': ROUTE_BODY_D_DAG_NAME,
  'version': '1',
  'entrypoints': { 'main': 'router' },
  'nodes': [
    {
      '@id': 'urn:noocodex:dag:route-body-d/node/router',
      '@type': 'SingleNode',
      'name': 'router',
      'node': 'router',
      'outputs': { 'even': 'accept', 'odd': 'reject' },
    },
    {
      '@id': 'urn:noocodex:dag:route-body-d/node/accept',
      '@type': 'TerminalNode',
      'name': 'accept',
      'outcome': 'completed',
    },
    {
      '@id': 'urn:noocodex:dag:route-body-d/node/reject',
      '@type': 'TerminalNode',
      'name': 'reject',
      'outcome': 'failed',
    },
  ],
});

// Parent DAG dispatched through the container (Branch C runDagBatch).
const RESERVOIR_D_CONTAINER_NAME = 'scatter-reservoir-d-container';
const RESERVOIR_D_INPROCESS_NAME = 'scatter-reservoir-d-inprocess';

const reservoirDContainerDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:scatter-reservoir-d-container',
  '@type': 'DAG',
  'name': RESERVOIR_D_CONTAINER_NAME,
  'version': '1',
  'entrypoints': { 'main': 'fan' },
  'nodes': [
    {
      '@id': 'urn:noocodex:dag:scatter-reservoir-d-container/node/fan',
      '@type': 'ScatterNode',
      'name': 'fan',
      'body': { 'dag': ROUTE_BODY_D_DAG_NAME },
      'source': 'items',
      'itemKey': 'currentItem',      'gather': { 'strategy': 'recording-test-reservoir' },
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'group', 'capacity': 4 }, 'concurrency': 4 },
      'container': CONTAINER_ROLE,
      'outputs': {
        'all-success': 'end',
        'partial': 'end',
        'all-error': 'end',
        'empty': 'end',
      },
    },
    {
      '@id': 'urn:noocodex:dag:scatter-reservoir-d-container/node/end',
      '@type': 'TerminalNode',
      'name': 'end',
      'outcome': 'completed',
    },
  ],
});

// Identical parent DAG, but no container → Branch B (in-process batch-native).
const reservoirDInProcessDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:scatter-reservoir-d-inprocess',
  '@type': 'DAG',
  'name': RESERVOIR_D_INPROCESS_NAME,
  'version': '1',
  'entrypoints': { 'main': 'fan' },
  'nodes': [
    {
      '@id': 'urn:noocodex:dag:scatter-reservoir-d-inprocess/node/fan',
      '@type': 'ScatterNode',
      'name': 'fan',
      'body': { 'dag': ROUTE_BODY_D_DAG_NAME },
      'source': 'items',
      'itemKey': 'currentItem',      'gather': { 'strategy': 'recording-test-reservoir' },
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'group', 'capacity': 4 }, 'concurrency': 4 },
      'outputs': {
        'all-success': 'end',
        'partial': 'end',
        'all-error': 'end',
        'empty': 'end',
      },
    },
    {
      '@id': 'urn:noocodex:dag:scatter-reservoir-d-inprocess/node/end',
      '@type': 'TerminalNode',
      'name': 'end',
      'outcome': 'completed',
    },
  ],
});

// Registry version used for the init ↔ ready handshake.
const SUITE_D_REGISTRY_VERSION = '1.0.0';

/**
 * Static registry injected into the real DagHost. Carries the router node and
 * the route-body-d sub-DAG so the host genuinely runs per-item routing. The
 * restore adapter rehydrates a fresh ReservoirDispatchState (metadata, set by
 * the scatter clone seeding, survives the snapshot round-trip — that is how the
 * router reads `currentItem` on the host side).
 */
const suiteDRestoreAdapter: CheckpointRestoreAdapterInterface<NodeStateInterface> =
  CheckpointRestoreAdapter.wrap((snap: JsonObjectType): NodeStateInterface => {
    const state = new ReservoirDispatchState();
    state.applySnapshot(snap);
    return state;
  });

const suiteDBundle: DispatcherBundleType<NodeStateInterface> = {
  // RouterNode extends MonadicNode<NodeStateBase, ...> which is structurally
  // compatible with NodeInterface<NodeStateInterface, string, unknown> —
  // no cast required.
  'nodes': [new RouterNode()],
  'dags': [routeBodyDDag],
};

const suiteDRegistry: RegistryModuleInterface = {
  instantiate(_servicesConfig: JsonObjectType): Promise<RegistryBundleInterface> {
    return Promise.resolve({
      'bundle': suiteDBundle,
      'services': undefined,
      'registryVersion': SUITE_D_REGISTRY_VERSION,
      'restoreState': suiteDRestoreAdapter,
    });
  },
};

/**
 * Counting wrapper around a channel: delegates everything to the wrapped side
 * but increments `executeCount` for each outbound `execute` BridgeMessageType. The
 * proof that the batch round-trip ran is `executeCount === number of batches`.
 */
class ExecuteCountingChannel implements MessageChannelInterface {
  readonly #inner: MessageChannelInterface;
  executeCount: number = 0;

  constructor(inner: MessageChannelInterface) {
    this.#inner = inner;
  }

  send(msg: BridgeMessageType): void {
    if (msg.variant === 'execute') this.executeCount += 1;
    this.#inner.send(msg);
  }

  onMessage(handler: (msg: BridgeMessageType) => void): void {
    this.#inner.onMessage(handler);
  }

  close(): void {
    this.#inner.close();
  }
}

/**
 * SingleChannelContainer: DagContainerBase subclass that always routes through
 * one pre-built channel. Pool seams are no-ops; the channel is the real
 * LoopbackChannel parent side wired to a real DagHost. The init handshake uses
 * the SAME registryVersion the host's bundle reports.
 */
const SUITE_D_INIT: InitMessageShapeType = {
  'registryModule': 'suite-d',
  'registryVersion': SUITE_D_REGISTRY_VERSION,
  'servicesConfig': {},
};

class SingleChannelContainer extends DagContainerBase<null> {
  readonly #channel: MessageChannelInterface;
  /** Single-flight init promise: shared across concurrent acquireChannel calls. */
  #initPromise: Promise<void> | null = null;

  constructor(channel: MessageChannelInterface) {
    super({
      ...DagContainerBase.defaultOptions,
      'poolSize': 1,
      'init': SUITE_D_INIT,
    });
    this.#channel = channel;
  }

  // The init↔ready handshake runs once before the first request. The base
  // `acquireChannel` drives init through the pool; this override bypasses the
  // pool, so it performs the same one-time handshake against the real host via
  // the protected `initializeChannel` seam. Concurrent acquireChannel calls
  // (the reservoir releases batches in parallel) share ONE init promise so the
  // init message is sent exactly once — a second in-flight init would corrupt
  // the channel's init waiter.
  protected override async acquireChannel(): Promise<MessageChannelInterface> {
    if (this.#initPromise === null) {
      this.#initPromise = this.initializeChannel(this.#channel, SUITE_D_INIT);
    }
    await this.#initPromise;
    return this.#channel;
  }

  protected override releaseChannel(_channel: MessageChannelInterface): void { /* bypass pool */ }

  protected override composeEntry(): PoolEntryType<null> {
    return { 'worker': null, 'channel': this.#channel, 'initialized': false };
  }

  protected override attachDeathListeners(_entry: PoolEntryType<null>): void { /* no-op */ }
  protected override terminateWorker(_worker: null): void { /* no-op */ }
  protected override awaitWorkerExit(_worker: null): Promise<void> {
    return new Promise(() => { /* never */ });
  }
}

const SUITE_D_ITEMS: Array<{ group: string; value: number }> = [
  { 'group': 'A', 'value': 0 },
  { 'group': 'A', 'value': 1 },
  { 'group': 'A', 'value': 2 },
  { 'group': 'A', 'value': 3 },
  { 'group': 'A', 'value': 4 },
  { 'group': 'A', 'value': 5 },
  { 'group': 'A', 'value': 6 },
  { 'group': 'A', 'value': 7 },
];

void describe('Scatter reservoir: DAGType body through real DagContainerBase (Branch C runDagBatch)', () => {
  void it('routes 8 items through runDagBatch (2 batches, 2 execute messages); even→success, odd→error; parity with in-process', async () => {
    // ── Real DagHost behind a LoopbackChannel, fronted by DagContainerBase ──
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const countingParent = new ExecuteCountingChannel(parentSide);
    const host = new DagHost(hostSide, { 'registry': suiteDRegistry });
    host.start();

    const container = new SingleChannelContainer(countingParent);

    const dispatcher = new Dagonizer<ReservoirDispatchState>({
      'containers': { [CONTAINER_ROLE]: container },
    });
    dispatcher.registerNode(new RouterNode());
    dispatcher.registerDAG(routeBodyDDag);
    dispatcher.registerDAG(reservoirDContainerDag);

    const state = new ReservoirDispatchState();
    state.items = [...SUITE_D_ITEMS];

    const result = await dispatcher.execute(RESERVOIR_D_CONTAINER_NAME, state);

    // (a) Clean completion.
    assert.strictEqual(result.cursor, null, 'flow must complete without a resume cursor');

    // (b) All 8 items folded by the recording gather.
    assert.strictEqual(
      result.state.counter,
      8,
      `gather counter must equal 8 (one per item); got ${result.state.counter}`,
    );

    // (b) Per-item routing carried back through the transport: even→success, odd→error.
    const containerOutputs = result.state.outputByValue;
    for (let v = 0; v < 8; v++) {
      const expected = v % 2 === 0 ? 'success' : 'error';
      assert.strictEqual(
        containerOutputs[String(v)],
        expected,
        `value ${v} must route to ${expected} through runDagBatch; got ${containerOutputs[String(v)]}`,
      );
    }
    // Prove the failed terminal was genuinely reached for odd items.
    assert.strictEqual(
      Object.values(containerOutputs).filter((o) => o === 'error').length,
      4,
      'exactly 4 odd items must reach the failed (reject) terminal',
    );

    // (c) PROOF the runDagBatch path ran: one execute message PER BATCH (2),
    //     not per item (8). reservoir capacity 4 over 8 same-group items → 2
    //     released batches → 2 transport round-trips.
    assert.strictEqual(
      countingParent.executeCount,
      2,
      `execute messages must equal the number of batches (2), not items (8); got ${countingParent.executeCount}`,
    );

    await dispatcher.destroy();

    // ── (d) PARITY: same items through the in-process Branch B run ──────────
    const inProcDispatcher = new Dagonizer<ReservoirDispatchState>();
    inProcDispatcher.registerNode(new RouterNode());
    inProcDispatcher.registerDAG(routeBodyDDag);
    inProcDispatcher.registerDAG(reservoirDInProcessDag);

    const inProcState = new ReservoirDispatchState();
    inProcState.items = [...SUITE_D_ITEMS];

    const inProcResult = await inProcDispatcher.execute(RESERVOIR_D_INPROCESS_NAME, inProcState);

    assert.strictEqual(inProcResult.cursor, null, 'in-process flow must complete cleanly');
    assert.strictEqual(
      inProcResult.state.counter,
      result.state.counter,
      'gather counter must match between container and in-process runs',
    );
    assert.deepStrictEqual(
      inProcResult.state.outputByValue,
      result.state.outputByValue,
      'per-item output map must be identical between runDagBatch and in-process batch-native',
    );

    await inProcDispatcher.destroy();
  });
});
