import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import { DAG_CONTEXT, DAGIdentity } from '../../src/entities/dag/DAG.js';
import type { ExecutionResultType } from '../../src/entities/execution/ExecutionResult.js';
import type { DAGType } from '../../src/entities/index.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeError } from '../../src/entities/node/NodeError.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';
import { TestDag } from '../_support/TestDag.js';
import { TestNode } from '../_support/TestNode.js';

// ── Deep-nesting fixtures ───────────────────────────────────────────────────

// A state carrying one accumulator threaded through every nesting level.
class CounterState extends NodeStateBase {
  value = 0;
}

// One increment node per level; each adds a distinct power of ten so the
// final total proves every level executed exactly once and in order.
class IncNode extends MonadicNode<CounterState, string> {
  readonly '@id': string;
  readonly name: string;
  readonly outputs: readonly string[];
  private readonly delta: number;

  constructor(name: string, outputs: readonly string[], delta: number) {
    super();
    this['@id'] = `urn:noocodec:node:${encodeURIComponent(name)}`;
    this.name = name;
    this.outputs = outputs;
    this.delta = delta;
  }

  override get outputSchema(): Record<string, SchemaObjectType> {
    const schema: Record<string, SchemaObjectType> = {};
    for (const port of this.outputs) schema[port] = { 'type': 'object' };
    return schema;
  }

  override async execute(
    batch: Batch<CounterState>,
    _ctx: NodeContextType,
  ): Promise<Map<string, Batch<CounterState>>> {
    for (const item of batch) item.state.value += this.delta;
    return new Map([['success', batch]]);
  }

  static of(name: string, delta: number): IncNode {
    return new IncNode(name, ['success'], delta);
  }
}

// Identity state mapping: seed the child's `value` from the parent and copy it
// back out. Applied at every embed boundary so the accumulator survives the
// full descent and ascent.
const VALUE_MAPPING = { 'input': { 'value': 'value' }, 'output': { 'value': 'value' } } as const;
const INNER_FAIL_DAG_IRI = 'urn:noocodec:dag:inner-fail';
const PARENT_FAIL_DAG_IRI = 'urn:noocodec:dag:parent';
const INNER_OK_DAG_IRI = 'urn:noocodec:dag:inner-ok';
const PARENT_OK_DAG_IRI = 'urn:noocodec:dag:parent-ok';
const INNER_NULL_DAG_IRI = 'urn:noocodec:dag:inner-null';
const PARENT_COMPLETED_DAG_IRI = 'urn:noocodec:dag:parent-completed';
const INNER_TOLERANT_DAG_IRI = 'urn:noocodec:dag:inner-tolerant';
const PARENT_TOLERANT_DAG_IRI = 'urn:noocodec:dag:parent-tolerant';
const TOP_DAG_IRI = 'urn:noocodec:dag:top';
const DEEP_CORE_DAG_IRI = 'urn:noocodec:dag:deep-core';
const DEEP_INNER_DAG_IRI = 'urn:noocodec:dag:deep-inner';
const DEEP_MID_DAG_IRI = 'urn:noocodec:dag:deep-mid';
const DEEP_OUTER_DAG_IRI = 'urn:noocodec:dag:deep-outer';
const CYC_A_DAG_IRI = 'urn:noocodec:dag:cyc-a';
const CYC_B_DAG_IRI = 'urn:noocodec:dag:cyc-b';
const LIFECYCLE_CHILD_DAG_IRI = 'urn:noocodec:dag:lifecycle-child';
const LIFECYCLE_PARENT_DAG_IRI = 'urn:noocodec:dag:lifecycle-parent';
const HELPER_DAG_IRI = 'urn:noocodec:dag:helper';
const NULL_PARENT_DAG_IRI = 'urn:noocodec:dag:null-parent';
const MIXED_PARENT_DAG_IRI = 'urn:noocodec:dag:mixed-parent';
const VALID_PARENT_DAG_IRI = 'urn:noocodec:dag:valid-parent';

class PlacementFixture {
  private constructor() {}

  static iri(dagIri: string, placementSegment: string): string {
    return DAGIdentity.placementId(dagIri, placementSegment);
  }

  static single(dag: string, placementSegment: string, outputs: Record<string, string>): DAGType['nodes'][number] {
    return {
      '@id': PlacementFixture.iri(dag, placementSegment),
      '@type': 'SingleNode',
      'name': placementSegment,
      'node': `urn:noocodec:node:${placementSegment}`,
      outputs,
    };
  }

  static embed(dag: string, placementSegment: string, childDag: string): DAGType['nodes'][number] {
    return {
      '@id': PlacementFixture.iri(dag, placementSegment),
      '@type': 'EmbeddedDAGNode',
      'name': placementSegment,
      'dag':   childDag,
      'stateMapping': VALUE_MAPPING,
      'outputs': { 'success': PlacementFixture.iri(dag, 'end'), 'error': PlacementFixture.iri(dag, 'end') },
    };
  }

  static terminal(dag: string): DAGType['nodes'][number] {
    return {
      '@id': PlacementFixture.iri(dag, 'end'),
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    };
  }
}

// core ← inner ← mid ← outer  (three levels of embedding: nested in nested in nested)
const coreDAG  = TestDag.of(DEEP_CORE_DAG_IRI,  PlacementFixture.iri(DEEP_CORE_DAG_IRI, 'inc-core'),  [
  PlacementFixture.single(DEEP_CORE_DAG_IRI, 'inc-core', { 'success': PlacementFixture.iri(DEEP_CORE_DAG_IRI, 'end') }),
  PlacementFixture.terminal(DEEP_CORE_DAG_IRI),
], { 'name': 'deep-core' });
const innerDAG = TestDag.of(DEEP_INNER_DAG_IRI, PlacementFixture.iri(DEEP_INNER_DAG_IRI, 'inc-inner'), [
  PlacementFixture.single(DEEP_INNER_DAG_IRI, 'inc-inner', { 'success': PlacementFixture.iri(DEEP_INNER_DAG_IRI, 'embed-core') }),
  PlacementFixture.embed(DEEP_INNER_DAG_IRI, 'embed-core', DEEP_CORE_DAG_IRI),
  PlacementFixture.terminal(DEEP_INNER_DAG_IRI),
], { 'name': 'deep-inner' });
const midDAG = TestDag.of(DEEP_MID_DAG_IRI, PlacementFixture.iri(DEEP_MID_DAG_IRI, 'inc-mid'), [
  PlacementFixture.single(DEEP_MID_DAG_IRI, 'inc-mid', { 'success': PlacementFixture.iri(DEEP_MID_DAG_IRI, 'embed-inner') }),
  PlacementFixture.embed(DEEP_MID_DAG_IRI, 'embed-inner', DEEP_INNER_DAG_IRI),
  PlacementFixture.terminal(DEEP_MID_DAG_IRI),
], { 'name': 'deep-mid' });
const outerDAG = TestDag.of(DEEP_OUTER_DAG_IRI, PlacementFixture.iri(DEEP_OUTER_DAG_IRI, 'inc-outer'), [
  PlacementFixture.single(DEEP_OUTER_DAG_IRI, 'inc-outer', { 'success': PlacementFixture.iri(DEEP_OUTER_DAG_IRI, 'embed-mid') }),
  PlacementFixture.embed(DEEP_OUTER_DAG_IRI, 'embed-mid', DEEP_MID_DAG_IRI),
  PlacementFixture.terminal(DEEP_OUTER_DAG_IRI),
], { 'name': 'deep-outer' });

void describe('EmbeddedDAGNode: deep recursive nesting', () => {
  void it('threads state down and back through three nesting levels (nested in nested in nested)', async () => {
    const dispatcher = new Dagonizer<CounterState>();
    dispatcher.registerNode(IncNode.of('inc-outer', 1000));
    dispatcher.registerNode(IncNode.of('inc-mid',    100));
    dispatcher.registerNode(IncNode.of('inc-inner',   10));
    dispatcher.registerNode(IncNode.of('inc-core',     1));
    for (const dag of [coreDAG, innerDAG, midDAG, outerDAG]) dispatcher.registerDAG(dag);

    const result = await dispatcher.execute(DEEP_OUTER_DAG_IRI, new CounterState());

    // 1000 (outer) → seed mid → +100 → seed inner → +10 → seed core → +1,
    // then 1111 copied back up through every output mapping.
    assert.equal(result.state.value, 1111);
    assert.equal(result.terminalOutcome, 'completed');
  });

  void it('accumulates placementPath one segment per nesting level', async () => {
    const seen = new Map<string, readonly string[]>();
    class PathProbe extends Dagonizer<CounterState> {
      protected override onNodeStart(nodeName: string, _state: CounterState, placementPath: readonly string[] = []): void {
        seen.set(nodeName, placementPath);
      }
    }
    const dispatcher = new PathProbe();
    dispatcher.registerNode(IncNode.of('inc-outer', 1000));
    dispatcher.registerNode(IncNode.of('inc-mid',    100));
    dispatcher.registerNode(IncNode.of('inc-inner',   10));
    dispatcher.registerNode(IncNode.of('inc-core',     1));
    for (const dag of [coreDAG, innerDAG, midDAG, outerDAG]) dispatcher.registerDAG(dag);

    await dispatcher.execute(DEEP_OUTER_DAG_IRI, new CounterState());

    // The deepest node ran three embed levels down.
    assert.deepEqual(seen.get('inc-outer'), []);
    assert.deepEqual(seen.get('inc-mid'),   ['embed-mid']);
    assert.deepEqual(seen.get('inc-inner'), ['embed-mid', 'embed-inner']);
    assert.deepEqual(seen.get('inc-core'),  ['embed-mid', 'embed-inner', 'embed-core']);
  });

  void it('cannot construct a cross-variant cycle: the append-only registry refuses the closing re-registration', () => {
    const dispatcher = new Dagonizer<CounterState>();
    dispatcher.registerNode(IncNode.of('na', 1));

    // a (standalone) ← b embeds a. Acyclic.
    dispatcher.registerDAG(TestDag.of(CYC_A_DAG_IRI, PlacementFixture.iri(CYC_A_DAG_IRI, 'na'), [
      PlacementFixture.single(CYC_A_DAG_IRI, 'na', { 'success': PlacementFixture.iri(CYC_A_DAG_IRI, 'end') }),
      PlacementFixture.terminal(CYC_A_DAG_IRI),
    ], { 'name': 'cyc-a' }));
    dispatcher.registerDAG(TestDag.of(CYC_B_DAG_IRI, PlacementFixture.iri(CYC_B_DAG_IRI, 'embed-a'), [
      PlacementFixture.embed(CYC_B_DAG_IRI, 'embed-a', CYC_A_DAG_IRI),
      PlacementFixture.terminal(CYC_B_DAG_IRI),
    ], { 'name': 'cyc-b' }));

    // The only way to close a cross-variant cycle (a SCATTERS into b → b embeds a)
    // is to re-register 'cyc-a' so it references 'cyc-b'. Because every sub-DAG
    // reference must resolve to an already-registered DAG, references are
    // constrained to registered DAGs; the sole route to a cycle is mutating an existing
    // registration. The registry is append-only, so this re-registration is
    // refused with 'already registered' before any cyclic state can install —
    // a cross-variant cycle is structurally unconstructable through the registry.
    const cyclicA = TestDag.of(CYC_A_DAG_IRI, PlacementFixture.iri(CYC_A_DAG_IRI, 'fork-b'), [{
      '@id': PlacementFixture.iri(CYC_A_DAG_IRI, 'fork-b'),
      '@type':  'ScatterNode',
      'name':   'fork-b',
      'source': 'items',
      'body': { 'dag': CYC_B_DAG_IRI },
      'outputs': {
        'all-success': PlacementFixture.iri(CYC_A_DAG_IRI, 'end'),
        'partial': PlacementFixture.iri(CYC_A_DAG_IRI, 'end'),
        'all-error': PlacementFixture.iri(CYC_A_DAG_IRI, 'end'),
        'empty': PlacementFixture.iri(CYC_A_DAG_IRI, 'end'),
      },
    },
      PlacementFixture.terminal(CYC_A_DAG_IRI),
    ], { 'name': 'cyc-a' });

    assert.throws(() => dispatcher.registerDAG(cyclicA), /already registered/u);
  });
});

// ── Lifecycle-scoping fixtures ──────────────────────────────────────────────

class CountingDagonizer<TState extends NodeStateBase> extends Dagonizer<TState> {
  flowStartCount  = 0;
  flowEndCount    = 0;
  nodeStartNames: string[] = [];
  nodeEndNames:   string[] = [];

  protected override onFlowStart(_dagName: string, _state: TState): void {
    this.flowStartCount++;
  }

  protected override onFlowEnd(_dagName: string, _state: TState, _result: ExecutionResultType<TState>): void {
    this.flowEndCount++;
  }

  protected override onNodeStart(nodeName: string, _state: TState): void {
    this.nodeStartNames.push(nodeName);
  }

  protected override onNodeEnd(nodeName: string, _output: string | null, _state: TState): void {
    this.nodeEndNames.push(nodeName);
  }
}

// Child DAG (two nodes: start → finish).
const childDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id': LIFECYCLE_CHILD_DAG_IRI,
  '@type':    'DAG',
  'name':       'child',
  'version':    '1',
  'entrypoints': { 'main': PlacementFixture.iri(LIFECYCLE_CHILD_DAG_IRI, 'child-start') },
  'nodes': [
    {
      '@id': PlacementFixture.iri(LIFECYCLE_CHILD_DAG_IRI, 'child-start'),
      '@type': 'SingleNode',
      'name':  'child-start',
      'node':  'urn:noocodec:node:child-start',
      'outputs': { 'done': PlacementFixture.iri(LIFECYCLE_CHILD_DAG_IRI, 'child-finish') },
    },
    {
      '@id': PlacementFixture.iri(LIFECYCLE_CHILD_DAG_IRI, 'child-finish'),
      '@type': 'SingleNode',
      'name':  'child-finish',
      'node':  'urn:noocodec:node:child-finish',
      'outputs': { 'done': PlacementFixture.iri(LIFECYCLE_CHILD_DAG_IRI, 'end') },
    },
    { '@id': PlacementFixture.iri(LIFECYCLE_CHILD_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

// Parent DAG: entry → run-child (embedded-DAG node) → parent-end.
const parentDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id': LIFECYCLE_PARENT_DAG_IRI,
  '@type':    'DAG',
  'name':       'parent',
  'version':    '1',
  'entrypoints': { 'main': PlacementFixture.iri(LIFECYCLE_PARENT_DAG_IRI, 'parent-entry') },
  'nodes': [
    {
      '@id': PlacementFixture.iri(LIFECYCLE_PARENT_DAG_IRI, 'parent-entry'),
      '@type': 'SingleNode',
      'name':  'parent-entry',
      'node':  'urn:noocodec:node:parent-entry',
      'outputs': { 'next': PlacementFixture.iri(LIFECYCLE_PARENT_DAG_IRI, 'run-child') },
    },
    {
      '@id': PlacementFixture.iri(LIFECYCLE_PARENT_DAG_IRI, 'run-child'),
      '@type': 'EmbeddedDAGNode',
      'name':  'run-child',
      'dag':   LIFECYCLE_CHILD_DAG_IRI,
      'outputs': {
        'success': PlacementFixture.iri(LIFECYCLE_PARENT_DAG_IRI, 'parent-end'),
        'error': PlacementFixture.iri(LIFECYCLE_PARENT_DAG_IRI, 'parent-end'),
      },
    },
    {
      '@id': PlacementFixture.iri(LIFECYCLE_PARENT_DAG_IRI, 'parent-end'),
      '@type': 'SingleNode',
      'name':  'parent-end',
      'node':  'urn:noocodec:node:parent-end',
      'outputs': { 'done': PlacementFixture.iri(LIFECYCLE_PARENT_DAG_IRI, 'end') },
    },
    { '@id': PlacementFixture.iri(LIFECYCLE_PARENT_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

class LifecycleFixture {
  private constructor() {}

  /** Register the shared lifecycle node set + both DAGs on a fresh dispatcher. */
  static register(dispatcher: CountingDagonizer<NodeStateBase>): void {
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:child-start',  ['done']));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:child-finish', ['done']));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:parent-entry', ['next']));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:parent-end',   ['done']));
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);
  }
}

void describe('Embedded-DAG lifecycle scoping', () => {
  void it('fires flow/node observer hooks at the right scope and completes the lifecycle once', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();
    LifecycleFixture.register(dispatcher);

    const state = new NodeStateBase();
    assert.equal(state.lifecycle.variant, 'pending');

    const result = await dispatcher.execute(LIFECYCLE_PARENT_DAG_IRI, state);

    // Run completes cleanly; the state lifecycle transitions only once through
    // running → completed. No spurious markRunning / markCompleted from the
    // embedded-DAG body re-entry (which would throw on a terminal → running
    // transition and leave the lifecycle in an invalid state).
    assert.equal(result.state.lifecycle.variant, 'completed', 'run completed cleanly');
    assert.equal(state.lifecycle.variant, 'completed');

    // onFlowStart / onFlowEnd each fire exactly once per top-level execute().
    assert.equal(dispatcher.flowStartCount, 1, 'onFlowStart fired exactly once');
    assert.equal(dispatcher.flowEndCount,   1, 'onFlowEnd fired exactly once');

    // onNodeStart / onNodeEnd fire for both parent placements and embedded-DAG
    // inner nodes; parent placement names must appear.
    const allStarted = dispatcher.nodeStartNames;
    const allEnded   = dispatcher.nodeEndNames;
    assert.ok(allStarted.includes('parent-entry'), 'parent-entry started');
    assert.ok(allStarted.includes('parent-end'),   'parent-end started');
    assert.ok(allEnded.includes('parent-entry'),   'parent-entry ended');
    assert.ok(allEnded.includes('parent-end'),     'parent-end ended');

    // Embedded-DAG inner placement names must appear (engine fires
    // onNodeStart/End per child node).
    assert.ok(allStarted.includes('child-start'),  'child-start started');
    assert.ok(allStarted.includes('child-finish'), 'child-finish started');
    assert.ok(allEnded.includes('child-start'),    'child-start ended');
    assert.ok(allEnded.includes('child-finish'),   'child-finish ended');
  });

  void it('executedNodes reflects parent placements only (not embedded-body internals)', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();
    LifecycleFixture.register(dispatcher);

    const result = await dispatcher.execute(LIFECYCLE_PARENT_DAG_IRI, new NodeStateBase());

    // The top-level runNodes only records the placements it dispatches:
    // parent-entry, run-child (the embedded-DAG placement), parent-end, end.
    assert.ok(result.executedNodes.includes('parent-entry'), 'parent-entry executed');
    assert.ok(result.executedNodes.includes('run-child'),    'run-child (embedded) executed');
    assert.ok(result.executedNodes.includes('parent-end'),   'parent-end executed');
    assert.ok(result.executedNodes.includes('end'),          'terminal end executed');
    assert.equal(result.executedNodes.length, 4, 'exactly 4 parent-level nodes recorded (3 + terminal)');
  });
});

// ── Terminal-outcome propagation fixtures ───────────────────────────────────

/**
 * Embedded-DAG terminal-outcome propagation.
 *
 * When an inner DAG exits via a `TerminalNode` placement, the inner
 * generator's `ExecutionResult.terminalOutcome` carries the outcome the
 * terminal declared. `executeScatter` reads that and uses it (in addition
 * to `cloneState.errors`) to decide whether the parent placement's
 * `success` or `error` output fires.
 *
 * Without this propagation, an inner `TerminalNode(failed)` would have
 * to be paired with an explicit `state.collectError()` call to surface
 * as `error` on the parent, losing the value of having an explicit
 * terminal placement in the inner DAG.
 */

class PassNode extends MonadicNode<NodeStateBase, 'ok'> {
  readonly name = 'pass';
  readonly '@id' = 'urn:noocodec:node:pass';
  readonly outputs = ['ok'] as const;
  override get outputSchema(): Record<string, SchemaObjectType> { return { 'ok': { 'type': 'object' } }; }
  override async execute(batch: Batch<NodeStateBase>): Promise<Map<'ok', Batch<NodeStateBase>>> { return new Map([['ok', batch]]); }
}

const passNode = new PassNode();

// Collects an unrecoverable error yet still routes its normal output. Models a
// node (or scatter clone) whose sub-failure the inner flow deliberately
// tolerates — e.g. one scout absorbed by an `any-success` reducer — while the
// run continues to a `completed` terminal. The error must surface on the parent
// state for observability without flipping the placement's terminal decision.
class TolerantNode extends MonadicNode<NodeStateBase, 'ok'> {
  readonly name = 'tolerant';
  readonly '@id' = 'urn:noocodec:node:tolerant';
  readonly outputs = ['ok'] as const;
  override get outputSchema(): Record<string, SchemaObjectType> { return { 'ok': { 'type': 'object' } }; }
  override async execute(batch: Batch<NodeStateBase>): Promise<Map<'ok', Batch<NodeStateBase>>> {
    const err = NodeError.create(
      'TOOL_HTTP_429',
      'tolerated upstream rate limit',
      'execute',
      false,
      '2020-01-01T00:00:00Z',
    );
    const output: NodeOutputType<'ok'> = { 'errors': [err], 'output': 'ok' };
    for (const item of batch) {
      for (const error of output.errors) item.state.collectError(error);
    }
    return new Map([[output.output, batch]]);
  }
}

const tolerantNode = new TolerantNode();

void describe('embedded-DAG terminal-outcome propagation', () => {
  void it('inner TerminalNode(failed) routes parent to error without collectError', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(passNode);

    // Inner DAG: pass → terminal(failed). No collectError anywhere.
    const innerDag = new DAGBuilder(INNER_FAIL_DAG_IRI, '1', { 'name': 'inner-fail' })
      .node(PlacementFixture.iri(INNER_FAIL_DAG_IRI, 'pass'), passNode, { 'ok': PlacementFixture.iri(INNER_FAIL_DAG_IRI, 'end-fail') }, { 'name': 'pass' })
      .terminal(PlacementFixture.iri(INNER_FAIL_DAG_IRI, 'end-fail'), { 'name': 'end-fail', 'outcome': 'failed' })
      .build();
    dispatcher.registerDAG(innerDag);

    // Parent DAG: embedded-DAG node, success/error routing to distinct terminals.
    const parentDag = new DAGBuilder(PARENT_FAIL_DAG_IRI, '1', { 'name': 'parent' })
      .embed(PlacementFixture.iri(PARENT_FAIL_DAG_IRI, 'run-inner'), INNER_FAIL_DAG_IRI, {
        'success': PlacementFixture.iri(PARENT_FAIL_DAG_IRI, 'end-ok'),
        'error': PlacementFixture.iri(PARENT_FAIL_DAG_IRI, 'end-bad'),
      }, { 'name': 'run-inner' })
      .terminal(PlacementFixture.iri(PARENT_FAIL_DAG_IRI, 'end-ok'), { 'name': 'end-ok', 'outcome': 'completed' })
      .terminal(PlacementFixture.iri(PARENT_FAIL_DAG_IRI, 'end-bad'), { 'name': 'end-bad', 'outcome': 'failed' })
      .build();
    dispatcher.registerDAG(parentDag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute(PARENT_FAIL_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'failed', 'parent terminal outcome is failed');
    assert.equal(result.state.lifecycle.variant, 'failed', 'parent lifecycle is failed');
    assert.equal(result.state.errors.length, 0, 'no node errors collected');
    assert.ok(result.executedNodes.includes('end-bad'), 'parent routed through end-bad');
  });

  void it('inner TerminalNode(completed) routes parent to success', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(passNode);

    const innerDag = new DAGBuilder(INNER_OK_DAG_IRI, '1', { 'name': 'inner-ok' })
      .node(PlacementFixture.iri(INNER_OK_DAG_IRI, 'pass'), passNode, { 'ok': PlacementFixture.iri(INNER_OK_DAG_IRI, 'end-ok') }, { 'name': 'pass' })
      .terminal(PlacementFixture.iri(INNER_OK_DAG_IRI, 'end-ok'), { 'name': 'end-ok', 'outcome': 'completed' })
      .build();
    dispatcher.registerDAG(innerDag);

    const parentDag = new DAGBuilder(PARENT_OK_DAG_IRI, '1', { 'name': 'parent-ok' })
      .embed(PlacementFixture.iri(PARENT_OK_DAG_IRI, 'run-inner'), INNER_OK_DAG_IRI, {
        'success': PlacementFixture.iri(PARENT_OK_DAG_IRI, 'end-ok'),
        'error': PlacementFixture.iri(PARENT_OK_DAG_IRI, 'end-bad'),
      }, { 'name': 'run-inner' })
      .terminal(PlacementFixture.iri(PARENT_OK_DAG_IRI, 'end-ok'), { 'name': 'end-ok', 'outcome': 'completed' })
      .terminal(PlacementFixture.iri(PARENT_OK_DAG_IRI, 'end-bad'), { 'name': 'end-bad', 'outcome': 'failed' })
      .build();
    dispatcher.registerDAG(parentDag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute(PARENT_OK_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.state.lifecycle.variant, 'completed');
    assert.ok(result.executedNodes.includes('end-ok'));
  });

  void it('inner TerminalNode(completed) without errors routes parent to success (default propagation)', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(passNode);

    // Inner DAG exits via TerminalNode(completed) with no errors.
    const innerDag = new DAGBuilder(INNER_NULL_DAG_IRI, '1', { 'name': 'inner-null' })
      .node(PlacementFixture.iri(INNER_NULL_DAG_IRI, 'pass'), passNode, { 'ok': PlacementFixture.iri(INNER_NULL_DAG_IRI, 'inner-done') }, { 'name': 'pass' })
      .terminal(PlacementFixture.iri(INNER_NULL_DAG_IRI, 'inner-done'), { 'name': 'inner-done', 'outcome': 'completed' })
      .build();
    dispatcher.registerDAG(innerDag);

    const parentDag = new DAGBuilder(PARENT_COMPLETED_DAG_IRI, '1', { 'name': 'parent-completed' })
      .embed(PlacementFixture.iri(PARENT_COMPLETED_DAG_IRI, 'run-inner'), INNER_NULL_DAG_IRI, {
        'success': PlacementFixture.iri(PARENT_COMPLETED_DAG_IRI, 'end-ok'),
        'error': PlacementFixture.iri(PARENT_COMPLETED_DAG_IRI, 'end-bad'),
      }, { 'name': 'run-inner' })
      .terminal(PlacementFixture.iri(PARENT_COMPLETED_DAG_IRI, 'end-ok'), { 'name': 'end-ok', 'outcome': 'completed' })
      .terminal(PlacementFixture.iri(PARENT_COMPLETED_DAG_IRI, 'end-bad'), { 'name': 'end-bad', 'outcome': 'failed' })
      .build();
    dispatcher.registerDAG(parentDag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute(PARENT_COMPLETED_DAG_IRI, state);

    // Inner TerminalNode(completed) + no errors → parent routes via success.
    assert.equal(result.state.lifecycle.variant, 'completed');
    assert.ok(result.executedNodes.includes('end-ok'));
  });

  void it('inner TerminalNode(completed) with a tolerated unrecoverable error routes parent to success', async () => {
    // The inner flow collects an unrecoverable error (a tolerated sub-failure)
    // but still reaches its `completed` terminal — the shape an `any-success`
    // scatter produces when one clone fails and the survivors carry the run
    // through. The explicit `completed` terminal is authoritative: the parent
    // must route `success`, and the tolerated error must still be propagated to
    // the parent state so it stays observable.
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(tolerantNode);

    const innerDag = new DAGBuilder(INNER_TOLERANT_DAG_IRI, '1', { 'name': 'inner-tolerant' })
      .node(PlacementFixture.iri(INNER_TOLERANT_DAG_IRI, 'tolerant'), tolerantNode, { 'ok': PlacementFixture.iri(INNER_TOLERANT_DAG_IRI, 'found') }, { 'name': 'tolerant' })
      .terminal(PlacementFixture.iri(INNER_TOLERANT_DAG_IRI, 'found'), { 'name': 'found', 'outcome': 'completed' })
      .build();
    dispatcher.registerDAG(innerDag);

    const parentDag = new DAGBuilder(PARENT_TOLERANT_DAG_IRI, '1', { 'name': 'parent-tolerant' })
      .embed(PlacementFixture.iri(PARENT_TOLERANT_DAG_IRI, 'run-inner'), INNER_TOLERANT_DAG_IRI, {
        'success': PlacementFixture.iri(PARENT_TOLERANT_DAG_IRI, 'end-ok'),
        'error': PlacementFixture.iri(PARENT_TOLERANT_DAG_IRI, 'end-bad'),
      }, { 'name': 'run-inner' })
      .terminal(PlacementFixture.iri(PARENT_TOLERANT_DAG_IRI, 'end-ok'), { 'name': 'end-ok', 'outcome': 'completed' })
      .terminal(PlacementFixture.iri(PARENT_TOLERANT_DAG_IRI, 'end-bad'), { 'name': 'end-bad', 'outcome': 'failed' })
      .build();
    dispatcher.registerDAG(parentDag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute(PARENT_TOLERANT_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed', 'completed terminal wins over a tolerated error');
    assert.equal(result.state.lifecycle.variant, 'completed');
    assert.ok(result.executedNodes.includes('end-ok'), 'parent routed through the success terminal');
    assert.ok(!result.executedNodes.includes('end-bad'), 'parent did not route through the error terminal');
    assert.equal(
      result.state.errors.filter((e) => e.code === 'TOOL_HTTP_429').length,
      1,
      'the tolerated error is still propagated to the parent state for observability',
    );
  });

  void it('top-level execute() surfaces terminalOutcome matching the TerminalNode outcome field', async () => {
    // Every flow ends at an explicit TerminalNode; the returned result's
    // terminalOutcome reflects that terminal's declared outcome.
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(passNode);

    const dag = new DAGBuilder(TOP_DAG_IRI, '1', { 'name': 'top' })
      .node(PlacementFixture.iri(TOP_DAG_IRI, 'pass'), passNode, { 'ok': PlacementFixture.iri(TOP_DAG_IRI, 'flow-end') }, { 'name': 'pass' })
      .terminal(PlacementFixture.iri(TOP_DAG_IRI, 'flow-end'), { 'name': 'flow-end', 'outcome': 'completed' })
      .build();
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute(TOP_DAG_IRI, new NodeStateBase());
    assert.equal(result.terminalOutcome, 'completed');
  });
});

// ── Registration / validation fixtures ──────────────────────────────────────

// Sub-DAG used as a reusable component.
const helperDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id': HELPER_DAG_IRI,
  '@type':    'DAG',
  'name':       'helper',
  'version':    '1',
  'entrypoints': { 'main': PlacementFixture.iri(HELPER_DAG_IRI, 'step') },
  'nodes': [
    {
      '@id': PlacementFixture.iri(HELPER_DAG_IRI, 'step'),
      '@type': 'SingleNode',
      'name':  'step',
      'node':  'urn:noocodec:node:step',
      'outputs': { 'done': PlacementFixture.iri(HELPER_DAG_IRI, 'end') },
    },
    { '@id': PlacementFixture.iri(HELPER_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

void describe('registerDAG: embedded-DAG null-route acceptance', () => {
  void it('accepts embedded-DAG placement with success → end (sugar for terminate-completed)', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:step', ['done']));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:entry', ['next']));
    dispatcher.registerDAG(helperDAG);

    // Parent DAG where the embedded-DAG body routes 'success' → end (terminate-completed)
    const parentWithNullScatter: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': NULL_PARENT_DAG_IRI,
      '@type':    'DAG',
      'name':       'null-parent',
      'version':    '1',
      'entrypoints': { 'main': PlacementFixture.iri(NULL_PARENT_DAG_IRI, 'entry') },
      'nodes': [
        {
          '@id': PlacementFixture.iri(NULL_PARENT_DAG_IRI, 'entry'),
          '@type': 'SingleNode',
          'name':  'entry',
          'node':  'urn:noocodec:node:entry',
          'outputs': { 'next': PlacementFixture.iri(NULL_PARENT_DAG_IRI, 'run-helper') },
        },
        {
          '@id': PlacementFixture.iri(NULL_PARENT_DAG_IRI, 'run-helper'),
          '@type': 'EmbeddedDAGNode',
          'name':  'run-helper',
          'dag':   HELPER_DAG_IRI,
          'outputs': {
            'success': PlacementFixture.iri(NULL_PARENT_DAG_IRI, 'end'),
            'error': PlacementFixture.iri(NULL_PARENT_DAG_IRI, 'end'),
          },
        },
        { '@id': PlacementFixture.iri(NULL_PARENT_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(parentWithNullScatter));

    const state = new NodeStateBase();
    const result = await dispatcher.execute(NULL_PARENT_DAG_IRI, state);
    assert.equal(result.state.lifecycle.variant, 'completed', 'flow completes cleanly');
  });

  void it('accepts embedded-DAG placement with mixed null and explicit-target routes', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:step', ['done']));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:entry', ['next']));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:after', ['done']));

    dispatcher.registerDAG(helperDAG);

    const parentWithMixedRoutes: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': MIXED_PARENT_DAG_IRI,
      '@type':    'DAG',
      'name':       'mixed-parent',
      'version':    '1',
      'entrypoints': { 'main': PlacementFixture.iri(MIXED_PARENT_DAG_IRI, 'entry') },
      'nodes': [
        {
          '@id': PlacementFixture.iri(MIXED_PARENT_DAG_IRI, 'entry'),
          '@type': 'SingleNode',
          'name':  'entry',
          'node':  'urn:noocodec:node:entry',
          'outputs': { 'next': PlacementFixture.iri(MIXED_PARENT_DAG_IRI, 'run-helper') },
        },
        {
          '@id': PlacementFixture.iri(MIXED_PARENT_DAG_IRI, 'after'),
          '@type': 'SingleNode',
          'name':  'after',
          'node':  'urn:noocodec:node:after',
          'outputs': { 'done': PlacementFixture.iri(MIXED_PARENT_DAG_IRI, 'end') },
        },
        {
          '@id': PlacementFixture.iri(MIXED_PARENT_DAG_IRI, 'run-helper'),
          '@type': 'EmbeddedDAGNode',
          'name':  'run-helper',
          'dag':   HELPER_DAG_IRI,
          'outputs': {
            'error':   PlacementFixture.iri(MIXED_PARENT_DAG_IRI, 'after'),  // routes to a parent placement
            'success': PlacementFixture.iri(MIXED_PARENT_DAG_IRI, 'end'),     // terminate-completed
          },
        },
        { '@id': PlacementFixture.iri(MIXED_PARENT_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(parentWithMixedRoutes));

    const state = new NodeStateBase();
    const result = await dispatcher.execute(MIXED_PARENT_DAG_IRI, state);
    assert.equal(result.state.lifecycle.variant, 'completed', 'flow completes cleanly');
  });

  void it('accepts valid embedded-DAG placements where all outputs route to parent placements', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:step', ['done']));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:entry', ['next']));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:terminal', ['done']));
    dispatcher.registerDAG(helperDAG);

    // All embedded-DAG outputs route to a real parent placement; no nulls
    const validParent: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': VALID_PARENT_DAG_IRI,
      '@type':    'DAG',
      'name':       'valid-parent',
      'version':    '1',
      'entrypoints': { 'main': PlacementFixture.iri(VALID_PARENT_DAG_IRI, 'entry') },
      'nodes': [
        {
          '@id': PlacementFixture.iri(VALID_PARENT_DAG_IRI, 'entry'),
          '@type': 'SingleNode',
          'name':  'entry',
          'node':  'urn:noocodec:node:entry',
          'outputs': { 'next': PlacementFixture.iri(VALID_PARENT_DAG_IRI, 'run-helper') },
        },
        {
          '@id': PlacementFixture.iri(VALID_PARENT_DAG_IRI, 'terminal'),
          '@type': 'SingleNode',
          'name':  'terminal',
          'node':  'urn:noocodec:node:terminal',
          'outputs': { 'done': PlacementFixture.iri(VALID_PARENT_DAG_IRI, 'end') },
        },
        {
          '@id': PlacementFixture.iri(VALID_PARENT_DAG_IRI, 'run-helper'),
          '@type': 'EmbeddedDAGNode',
          'name':  'run-helper',
          'dag':   HELPER_DAG_IRI,
          'outputs': {
            'success': PlacementFixture.iri(VALID_PARENT_DAG_IRI, 'terminal'),
            'error':   PlacementFixture.iri(VALID_PARENT_DAG_IRI, 'terminal'),
          },
        },
        { '@id': PlacementFixture.iri(VALID_PARENT_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(validParent));
  });

  void it('rejects a DAG without @context, @id, @type fields', () => {
    // A flat (non-JSON-LD) DAG object must fail schema validation
    const flatDag = {
      'name':       'flat',
      'version':    '1',
      'entrypoints': { 'main': 'step' },
      'nodes': [
        { 'type': 'single', 'name': 'step', 'node': 'urn:noocodec:node:step', 'outputs': { 'done': 'end' } },
        { '@id': 'urn:noocodec:dag:x/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    assert.throws(() => Validator.dag.validate(flatDag));
  });

  void it('rejects a node placement using the old discriminator string (not ScatterNode)', () => {
    // Placements must use @type: 'ScatterNode'; the 'EmbeddedDAGNode' discriminator is invalid.
    const oldStylePlacement = {
      '@id': 'urn:noocodec:dag:x/node/run-helper',
      '@type': 'EmbeddedDAGNode',
      'name':  'run-helper',
      'dag':   'urn:noocodec:dag:helper',
      'outputs': { 'success': 'next', 'error': 'next' },
    };
    assert.equal(Validator.scatterNode.is(oldStylePlacement), false);
  });
});
