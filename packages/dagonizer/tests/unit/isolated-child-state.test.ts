/**
 * isolated-child-state: proves the DAG-scoped child-state factory primitive.
 *
 * Three invariants:
 *
 * 1. Embedded DAG with isolation factory — the child body runs on a fresh
 *    `ChildState` instance (different class from parent), and parent fields are
 *    not polluted by child-only writes; parent fields are not visible to the
 *    child body (isolation factory produces a fresh instance).
 *
 * 2. Scatter with isolation factory — each scatter item runs on a fresh
 *    `ItemState` instance; gather correctly folds child writes back to the
 *    parent via accessor; field isolation prevents cross-item bleed.
 *
 * 3. Backward-compat default — `registerDAG` with no factory argument uses
 *    `ChildStateFactory.cloneParent` (clone-parent), reproducing existing
 *    clone semantics exactly.
 */

import assert from 'node:assert/strict';
import { beforeEach, afterEach, describe, it } from 'node:test';

import type { ChildStateFactoryType } from '../../src/contracts/ChildStateFactoryType.js';
import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import type { StateAccessorInterface } from '../../src/contracts/StateAccessorInterface.js';
import type { GatherRecordType } from '../../src/core/GatherStrategies.js';
import { GatherStrategies, GatherStrategy } from '../../src/core/GatherStrategies.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { GatherConfigType } from '../../src/entities/dag/GatherConfig.js';
import type { DAGType } from '../../src/entities/index.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { ChildStateFactory } from '../../src/runtime/ChildStateFactory.js';

// ── Shared probe mechanism ────────────────────────────────────────────────────
//
// Each dispatcher is typed as the PARENT state. The child-body nodes (typed
// against the child state) are registered via the relaxed `registerNode<TNodeState>`
// signature which accepts any `NodeStateInterface` subtype. Isolation is verified
// by recording what class the body node receives and confirming parent fields
// are untouched.

// ── Scenario 1: Embedded DAG isolation ───────────────────────────────────────

/**
 * Parent state: carries a `parentValue` field and a `shared` counter.
 * The isolation factory must NOT clone this — child body must NOT see
 * `parentValue`.
 */
class EmbedParentState extends NodeStateBase {
  parentValue: string = 'parent-sentinel';
  shared: number = 0;

  protected override snapshotData(): JsonObjectType {
    return { 'parentValue': this.parentValue, 'shared': this.shared };
  }

  protected override restoreData(snap: JsonObjectType): void {
    if (typeof snap['parentValue'] === 'string') this.parentValue = snap['parentValue'];
    if (typeof snap['shared'] === 'number')     this.shared      = snap['shared'];
  }
}

/**
 * Child state: completely distinct from `EmbedParentState`. Has `childValue`
 * and `shared`. `shared` is seeded via stateMapping.
 */
class EmbedChildState extends NodeStateBase {
  childValue: string = '';
  shared: number = 0;

  protected override snapshotData(): JsonObjectType {
    return { 'childValue': this.childValue, 'shared': this.shared };
  }

  protected override restoreData(snap: JsonObjectType): void {
    if (typeof snap['childValue'] === 'string') this.childValue = snap['childValue'];
    if (typeof snap['shared'] === 'number')     this.shared     = snap['shared'];
  }
}

// Track what class the body node received.
let bodyReceivedClass: string = '';

/**
 * Body node that runs inside the child DAG. Increments `shared` and records
 * the runtime class of the state it received.
 */
class EmbedBodyNode extends ScalarNode<EmbedChildState, 'success'> {
  readonly name = 'embedBody';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<string, SchemaObjectType> { return { 'success': { 'type': 'object' } }; }

  protected async executeOne(state: EmbedChildState, _ctx: NodeContextType): Promise<NodeOutputType<'success'>> {
    bodyReceivedClass = state.constructor.name;
    state.childValue = 'written-by-child';
    state.shared     = state.shared + 10;
    return { 'errors': [], 'output': 'success' };
  }
}

/** Isolation factory for the child DAG: produces a fresh EmbedChildState. */
const embedChildFactory: ChildStateFactoryType = (_parent: NodeStateInterface): EmbedChildState =>
  new EmbedChildState();

class EmbedDag {
  private constructor() {}

  static child(name: string): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${name}`,
      '@type':    'DAG',
      'name':     name,
      'version':  '1',
      'entrypoint': 'embedBody',
      'nodes': [
        {
          '@id':   `urn:noocodex:dag:${name}/node/embedBody`,
          '@type': 'SingleNode',
          'name':  'embedBody',
          'node':  'embedBody',
          'outputs': { 'success': 'end' },
        },
        {
          '@id':     `urn:noocodex:dag:${name}/node/end`,
          '@type':   'TerminalNode',
          'name':    'end',
          'outcome': 'completed',
        },
      ],
    };
  }

  /** Outer DAG: embeds the child DAG with shared→shared mapping. */
  static outer(name: string, childDagName: string): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${name}`,
      '@type':    'DAG',
      'name':     name,
      'version':  '1',
      'entrypoint': 'embed',
      'nodes': [
        {
          '@id':   `urn:noocodex:dag:${name}/node/embed`,
          '@type': 'EmbeddedDAGNode',
          'name':  'embed',
          'dag':   childDagName,
          'stateMapping': {
            'input':  { 'shared': 'shared' },
            'output': { 'shared': 'shared' },
          },
          'outputs': { 'success': 'end', 'error': 'end' },
        },
        {
          '@id':     `urn:noocodex:dag:${name}/node/end`,
          '@type':   'TerminalNode',
          'name':    'end',
          'outcome': 'completed',
        },
      ],
    };
  }
}

void describe('Isolated child state: embedded DAG', () => {
  void it('child body receives a fresh EmbedChildState, not a clone of EmbedParentState', async () => {
    bodyReceivedClass = '';

    // Dispatcher typed as EmbedParentState — the outer DAG runs on EmbedParentState.
    // EmbedBodyNode (typed against EmbedChildState) is registered via the relaxed
    // registerNode<TNodeState> signature; it executes only within the child DAG body
    // which is seeded with EmbedChildState by the isolation factory.
    const dispatcher = new Dagonizer<EmbedParentState>();

    dispatcher.registerNode(new EmbedBodyNode());

    const childDag = EmbedDag.child('iso-embed-child');
    const outerDag = EmbedDag.outer('iso-embed-outer', 'iso-embed-child');

    // Register the child DAG with the isolation factory (fresh EmbedChildState).
    dispatcher.registerDAG(childDag, embedChildFactory);
    dispatcher.registerDAG(outerDag);

    const parent = new EmbedParentState();
    parent.shared = 5;

    const result = await dispatcher.execute('iso-embed-outer', parent);

    assert.equal(result.terminalOutcome, 'completed',
      'execution must complete successfully');

    // The body received a fresh EmbedChildState (not a clone of EmbedParentState).
    assert.equal(bodyReceivedClass, 'EmbedChildState',
      `body must receive EmbedChildState (isolation factory); got ${bodyReceivedClass}`);

    // `shared` was seeded (5) into child via stateMapping, incremented +10, echoed back.
    assert.equal(result.state.shared, 15,
      `expected shared=15 (seeded 5 + child +10), got ${result.state.shared}`);

    // `parentValue` must remain untouched: the isolation factory never gave the
    // child access to `parentValue` (fresh instance has no `parentValue`).
    assert.equal(result.state.parentValue, 'parent-sentinel',
      'parentValue must remain untouched on the parent state');
  });

  void it('ChildStateFactory.cloneParent clones parent — backward-compat', () => {
    const parent = new EmbedParentState();
    parent.shared = 42;
    parent.parentValue = 'test-marker';

    const child = ChildStateFactory.cloneParent(parent);

    // DEFAULT factory calls parent.clone() — child is the same class (EmbedParentState).
    assert.ok(child instanceof EmbedParentState,
      'DEFAULT factory must produce a clone of the same class');

    // Narrow the type so TypeScript can access EmbedParentState fields.
    if (!(child instanceof EmbedParentState)) throw new Error('unreachable: instanceof check above');

    // clone() produces a fresh instance with domain fields at their declared defaults
    // (not copied from parent). This is the existing clone semantics.
    assert.equal(child.shared, 0,
      'clone() starts domain fields at declared defaults, not copied from parent');

    // Mutation on clone must not bleed to parent.
    child.shared = 99;
    assert.equal(parent.shared, 42, 'mutating clone must not change parent');
  });

  void it('stateFactories map is populated at registerDAG time', () => {
    const dispatcher = new Dagonizer<EmbedParentState>();
    // Must register the body node so DAG validation passes.
    dispatcher.registerNode(new EmbedBodyNode());

    const childDag = EmbedDag.child('iso-factories-child');
    const outerDag = EmbedDag.outer('iso-factories-outer', 'iso-factories-child');

    // No explicit factory — should use DEFAULT.
    dispatcher.registerDAG(childDag);
    // Explicit isolation factory.
    dispatcher.registerDAG(outerDag, embedChildFactory);

    assert.ok(dispatcher.getChildStateFactory('iso-factories-child') !== undefined,
      'child DAG must have a factory entry (DEFAULT materialised at register time)');
    assert.ok(dispatcher.getChildStateFactory('iso-factories-outer') !== undefined,
      'outer DAG must have a factory entry');

    // The child DAG was registered without explicit factory — should be DEFAULT.
    const childFactory = dispatcher.getChildStateFactory('iso-factories-child');
    assert.strictEqual(childFactory, ChildStateFactory.cloneParent,
      'child DAG must use ChildStateFactory.cloneParent when no override is supplied');

    // The outer DAG was registered with embedChildFactory.
    const outerFactory = dispatcher.getChildStateFactory('iso-factories-outer');
    assert.strictEqual(outerFactory, embedChildFactory,
      'outer DAG must use the explicitly registered embedChildFactory');
  });
});

// ── Scenario 2: Scatter with isolation factory ────────────────────────────────

/**
 * Item state: the scatter body runs on this class. Each clone gets a fresh
 * instance. `itemResult` records the per-item computation.
 */
class ScatterItemState extends NodeStateBase {
  itemResult: number = 0;

  protected override snapshotData(): JsonObjectType {
    return { 'itemResult': this.itemResult };
  }

  protected override restoreData(snap: JsonObjectType): void {
    if (typeof snap['itemResult'] === 'number') this.itemResult = snap['itemResult'];
  }
}

/**
 * Parent state: carries the items source array and the aggregated results.
 * Does NOT have `itemResult`.
 */
class ScatterParentState extends NodeStateBase {
  items: number[] = [];
  results: number[] = [];

  protected override snapshotData(): JsonObjectType {
    return { 'items': [...this.items], 'results': [...this.results] };
  }

  protected override restoreData(snap: JsonObjectType): void {
    if (Array.isArray(snap['items']))   this.items   = snap['items'].filter((e): e is number => typeof e === 'number');
    if (Array.isArray(snap['results'])) this.results = snap['results'].filter((e): e is number => typeof e === 'number');
  }
}

let scatterBodyClassSeen: Set<string>;

/**
 * Scatter body node: reads the item value from metadata and doubles it into `itemResult`.
 * Records the class of the state it received.
 */
class ScatterBodyNode extends ScalarNode<ScatterItemState, 'success'> {
  readonly name = 'scatterBody';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<string, SchemaObjectType> { return { 'success': { 'type': 'object' } }; }

  protected async executeOne(state: ScatterItemState, _ctx: NodeContextType): Promise<NodeOutputType<'success'>> {
    scatterBodyClassSeen.add(state.constructor.name);
    const item = state.getter.number('item');
    state.itemResult = item * 2;
    return { 'errors': [], 'output': 'success' };
  }
}

const scatterBodyNode = new ScatterBodyNode();

/** Isolation factory for scatter items: produces a fresh ScatterItemState. */
const scatterItemFactory: ChildStateFactoryType = (_parent: NodeStateInterface): ScatterItemState =>
  new ScatterItemState();

class ScatterDag {
  private constructor() {}

  static body(name: string): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${name}`,
      '@type':    'DAG',
      'name':     name,
      'version':  '1',
      'entrypoint': 'scatterBody',
      'nodes': [
        {
          '@id':   `urn:noocodex:dag:${name}/node/scatterBody`,
          '@type': 'SingleNode',
          'name':  'scatterBody',
          'node':  'scatterBody',
          'outputs': { 'success': 'end' },
        },
        {
          '@id':     `urn:noocodex:dag:${name}/node/end`,
          '@type':   'TerminalNode',
          'name':    'end',
          'outcome': 'completed',
        },
      ],
    };
  }

  static outer(name: string, bodyDagName: string): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${name}`,
      '@type':    'DAG',
      'name':     name,
      'version':  '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id':         `urn:noocodex:dag:${name}/node/fan`,
          '@type':       'ScatterNode',
          'name':        'fan',
          'body':        { 'dag': bodyDagName },
          'source':      'items',
          'itemKey':     'item',
          'execution': { 'mode': 'item', 'concurrency': 4 },
          'gather':      { 'strategy': 'item-result-gather', 'target': 'results' },
          'outputs': {
            'all-success': 'end',
            'partial':     'end',
            'all-error':   'end',
            'empty':       'end',
          },
        },
        {
          '@id':     `urn:noocodex:dag:${name}/node/end`,
          '@type':   'TerminalNode',
          'name':    'end',
          'outcome': 'completed',
        },
      ],
    };
  }
}

/**
 * Custom gather strategy: reads `itemResult` from each clone via the accessor
 * and appends it to the parent `results` array.
 */
class ItemResultGather extends GatherStrategy {
  readonly name = 'item-result-gather';

  override reduce(
    _config: GatherConfigType,
    batch: Batch<GatherRecordType>,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    for (const item of batch) {
      const record = item.state;
      const rawCurrent = accessor.get(state, 'results');
      const current: number[] = Array.isArray(rawCurrent) ? rawCurrent.filter((x): x is number => typeof x === 'number') : [];
      const rawItemResult = accessor.get(record.cloneState, 'itemResult');
      const itemResult: number = typeof rawItemResult === 'number' ? rawItemResult : 0;
      accessor.set(state, 'results', [...current, itemResult]);
    }
  }
}

void describe('Isolated child state: scatter with isolation factory', () => {
  beforeEach(() => {
    scatterBodyClassSeen = new Set();
    GatherStrategies.register(new ItemResultGather());
  });
  afterEach(() => {
    GatherStrategies.unregister('item-result-gather');
  });

  void it('scatter items run on fresh ScatterItemState; itemResult folded into parent results', async () => {
    // Dispatcher typed as ScatterParentState — the outer DAG runs on ScatterParentState.
    // ScatterBodyNode (typed against ScatterItemState) is registered via the relaxed
    // registerNode<TNodeState> signature; it executes only within the body DAG seeded
    // with ScatterItemState by the isolation factory.
    const dispatcher = new Dagonizer<ScatterParentState>();
    dispatcher.registerNode(scatterBodyNode);

    const bodyDag  = ScatterDag.body('scatter-iso-body');
    const outerDag = ScatterDag.outer('scatter-iso-outer', 'scatter-iso-body');

    // Register body DAG with isolation factory (fresh ScatterItemState per item).
    dispatcher.registerDAG(bodyDag, scatterItemFactory);
    dispatcher.registerDAG(outerDag);

    const parent = new ScatterParentState();
    parent.items = [1, 2, 3, 4];

    const result = await dispatcher.execute('scatter-iso-outer', parent);

    assert.equal(result.terminalOutcome, 'completed');

    // Body received ScatterItemState for every item.
    assert.ok(scatterBodyClassSeen.has('ScatterItemState'),
      `scatter body must receive ScatterItemState instances; saw: ${[...scatterBodyClassSeen].join(', ')}`);
    assert.ok(!scatterBodyClassSeen.has('ScatterParentState'),
      'scatter body must NOT receive ScatterParentState (isolation factory active)');

    // Each item's itemResult = item * 2. Results collected: [2, 4, 6, 8] (order may vary).
    assert.equal(result.state.results.length, 4,
      `expected 4 results, got ${result.state.results.length}: ${JSON.stringify(result.state.results)}`);

    const sorted = [...result.state.results].sort((a, b) => a - b);
    assert.deepEqual(sorted, [2, 4, 6, 8],
      `expected doubled items [2,4,6,8], got ${JSON.stringify(sorted)}`);
  });

  void it('field isolation: parent does not acquire child-only fields after scatter', async () => {
    const dispatcher = new Dagonizer<ScatterParentState>();
    dispatcher.registerNode(scatterBodyNode);

    const bodyDag  = ScatterDag.body('scatter-iso-fields-body');
    const outerDag = ScatterDag.outer('scatter-iso-fields-outer', 'scatter-iso-fields-body');

    dispatcher.registerDAG(bodyDag, scatterItemFactory);
    dispatcher.registerDAG(outerDag);

    const parent = new ScatterParentState();
    parent.items = [5];

    const result = await dispatcher.execute('scatter-iso-fields-outer', parent);

    assert.equal(result.terminalOutcome, 'completed');

    // `itemResult` must NOT have been written to the parent state.
    // ScatterParentState does not have this field; isolation is working if
    // the parent instance has no `itemResult` property after the scatter.
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.state, 'itemResult'),
      false,
      'itemResult must not appear on the ScatterParentState instance (field isolation)',
    );
  });
});
