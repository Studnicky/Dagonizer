import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { ExecutionResultType } from '../../src/entities/execution/ExecutionResult.js';
import type { DAGType } from '../../src/entities/index.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';
import { TestNode } from '../_support/TestNode.js';

// ── Deep-nesting fixtures ───────────────────────────────────────────────────

// A state carrying one accumulator threaded through every nesting level.
class CounterState extends NodeStateBase {
  value = 0;
}

// One increment node per level; each adds a distinct power of ten so the
// final total proves every level executed exactly once and in order.
class IncNodeImpl extends ScalarNode<CounterState, string> {
  readonly name: string;
  readonly outputs: readonly string[];
  private readonly delta: number;

  constructor(name: string, outputs: readonly string[], delta: number) {
    super();
    this.name = name;
    this.outputs = outputs;
    this.delta = delta;
  }

  protected async executeOne(
    state: CounterState,
    _ctx: NodeContextType,
  ): Promise<NodeOutputType<string>> {
    state.value += this.delta;
    return { 'errors': [], 'output': 'success' };
  }
}

const incNode = (name: string, delta: number): IncNodeImpl =>
  new IncNodeImpl(name, ['success'], delta);

// Identity state mapping: seed the child's `value` from the parent and copy it
// back out. Applied at every embed boundary so the accumulator survives the
// full descent and ascent.
const VALUE_MAPPING = { 'input': { 'value': 'value' }, 'output': { 'value': 'value' } } as const;

const singleNode = (dag: string, name: string, outputs: Record<string, string>): DAGType['nodes'][number] => ({
  '@id':   `urn:noocodex:dag:${dag}/node/${name}`,
  '@type': 'SingleNode',
  name,
  'node':  name,
  outputs,
});

const embedNode = (dag: string, name: string, childDag: string): DAGType['nodes'][number] => ({
  '@id':   `urn:noocodex:dag:${dag}/node/${name}`,
  '@type': 'EmbeddedDAGNode',
  name,
  'dag':   childDag,
  'stateMapping': VALUE_MAPPING,
  'outputs': { 'success': 'end', 'error': 'end' },
});

const makeDAG = (name: string, entrypoint: string, nodes: DAGType['nodes']): DAGType => ({
  '@context': DAG_CONTEXT,
  '@id':      `urn:noocodex:dag:${name}`,
  '@type':    'DAG',
  name,
  'version':  '1',
  entrypoint,
  nodes,
});

const terminalNode = (dag: string): DAGType['nodes'][number] => ({
  '@id':     `urn:noocodex:dag:${dag}/node/end`,
  '@type':   'TerminalNode',
  'name':    'end',
  'outcome': 'completed',
});

// core ← inner ← mid ← outer  (three levels of embedding: nested in nested in nested)
const coreDAG  = makeDAG('deep-core',  'inc-core',  [
  singleNode('deep-core', 'inc-core', { 'success': 'end' }),
  terminalNode('deep-core'),
]);
const innerDAG = makeDAG('deep-inner', 'inc-inner', [
  singleNode('deep-inner', 'inc-inner', { 'success': 'embed-core' }),
  embedNode('deep-inner', 'embed-core', 'deep-core'),
  terminalNode('deep-inner'),
]);
const midDAG = makeDAG('deep-mid', 'inc-mid', [
  singleNode('deep-mid', 'inc-mid', { 'success': 'embed-inner' }),
  embedNode('deep-mid', 'embed-inner', 'deep-inner'),
  terminalNode('deep-mid'),
]);
const outerDAG = makeDAG('deep-outer', 'inc-outer', [
  singleNode('deep-outer', 'inc-outer', { 'success': 'embed-mid' }),
  embedNode('deep-outer', 'embed-mid', 'deep-mid'),
  terminalNode('deep-outer'),
]);

void describe('EmbeddedDAGNode: deep recursive nesting', () => {
  void it('threads state down and back through three nesting levels (nested in nested in nested)', async () => {
    const dispatcher = new Dagonizer<CounterState>();
    dispatcher.registerNode(incNode('inc-outer', 1000));
    dispatcher.registerNode(incNode('inc-mid',    100));
    dispatcher.registerNode(incNode('inc-inner',   10));
    dispatcher.registerNode(incNode('inc-core',     1));
    for (const dag of [coreDAG, innerDAG, midDAG, outerDAG]) dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('deep-outer', new CounterState());

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
    dispatcher.registerNode(incNode('inc-outer', 1000));
    dispatcher.registerNode(incNode('inc-mid',    100));
    dispatcher.registerNode(incNode('inc-inner',   10));
    dispatcher.registerNode(incNode('inc-core',     1));
    for (const dag of [coreDAG, innerDAG, midDAG, outerDAG]) dispatcher.registerDAG(dag);

    await dispatcher.execute('deep-outer', new CounterState());

    // The deepest node ran three embed levels down.
    assert.deepEqual(seen.get('inc-outer'), []);
    assert.deepEqual(seen.get('inc-mid'),   ['embed-mid']);
    assert.deepEqual(seen.get('inc-inner'), ['embed-mid', 'embed-inner']);
    assert.deepEqual(seen.get('inc-core'),  ['embed-mid', 'embed-inner', 'embed-core']);
  });

  void it('cannot construct a cross-kind cycle: the append-only registry refuses the closing re-registration', () => {
    const dispatcher = new Dagonizer<CounterState>();
    dispatcher.registerNode(incNode('na', 1));

    // a (standalone) ← b embeds a. Acyclic.
    dispatcher.registerDAG(makeDAG('cyc-a', 'na', [
      singleNode('cyc-a', 'na', { 'success': 'end' }),
      terminalNode('cyc-a'),
    ]));
    dispatcher.registerDAG(makeDAG('cyc-b', 'embed-a', [
      embedNode('cyc-b', 'embed-a', 'cyc-a'),
      terminalNode('cyc-b'),
    ]));

    // The only way to close a cross-kind cycle (a SCATTERS into b → b embeds a)
    // is to re-register 'cyc-a' so it references 'cyc-b'. Because every sub-DAG
    // reference must resolve to an already-registered DAG, references are
    // backward-only; the sole route to a cycle is mutating an existing
    // registration. The registry is append-only, so this re-registration is
    // refused with 'already registered' before any cyclic state can install —
    // a cross-kind cycle is structurally unconstructable through the registry.
    const cyclicA = makeDAG('cyc-a', 'fork-b', [{
      '@id':    'urn:noocodex:dag:cyc-a/node/fork-b',
      '@type':  'ScatterNode',
      'name':   'fork-b',
      'source': 'items',
      'body':   { 'dag': 'cyc-b' },
      'gather': { 'strategy': 'discard' },
      'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
    },
      terminalNode('cyc-a'),
    ]);

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

class MakeNodeImpl extends ScalarNode<NodeStateBase, string> {
  readonly name: string;
  readonly outputs: readonly string[];

  constructor(name: string, outputs: readonly string[]) {
    super();
    this.name = name;
    this.outputs = outputs;
  }

  protected async executeOne(
    _state: NodeStateBase,
    _ctx: NodeContextType,
  ): Promise<NodeOutputType<string>> {
    return { 'errors': [], 'output': this.outputs[0] as string };
  }
}

const makeNode = (name: string, outputs: readonly string[]): MakeNodeImpl =>
  new MakeNodeImpl(name, outputs);

// Child DAG (two nodes: start → finish).
const childDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:child',
  '@type':    'DAG',
  'name':       'child',
  'version':    '1',
  'entrypoint': 'child-start',
  'nodes': [
    {
      '@id':   'urn:noocodex:dag:child/node/child-start',
      '@type': 'SingleNode',
      'name':  'child-start',
      'node':  'child-start',
      'outputs': { 'done': 'child-finish' },
    },
    {
      '@id':   'urn:noocodex:dag:child/node/child-finish',
      '@type': 'SingleNode',
      'name':  'child-finish',
      'node':  'child-finish',
      'outputs': { 'done': 'end' },
    },
    { '@id': 'urn:noocodex:dag:child/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

// Parent DAG: entry → run-child (embedded-DAG node) → parent-end.
const parentDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:parent',
  '@type':    'DAG',
  'name':       'parent',
  'version':    '1',
  'entrypoint': 'parent-entry',
  'nodes': [
    {
      '@id':   'urn:noocodex:dag:parent/node/parent-entry',
      '@type': 'SingleNode',
      'name':  'parent-entry',
      'node':  'parent-entry',
      'outputs': { 'next': 'run-child' },
    },
    {
      '@id':   'urn:noocodex:dag:parent/node/run-child',
      '@type': 'EmbeddedDAGNode',
      'name':  'run-child',
      'dag':   'child',
      'outputs': { 'success': 'parent-end', 'error': 'parent-end' },
    },
    {
      '@id':   'urn:noocodex:dag:parent/node/parent-end',
      '@type': 'SingleNode',
      'name':  'parent-end',
      'node':  'parent-end',
      'outputs': { 'done': 'end' },
    },
    { '@id': 'urn:noocodex:dag:parent/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

// Register the shared lifecycle node set + both DAGs on a fresh dispatcher.
const registerLifecycleFixtures = (dispatcher: CountingDagonizer<NodeStateBase>): void => {
  dispatcher.registerNode(makeNode('child-start',  ['done']));
  dispatcher.registerNode(makeNode('child-finish', ['done']));
  dispatcher.registerNode(makeNode('parent-entry', ['next']));
  dispatcher.registerNode(makeNode('parent-end',   ['done']));
  dispatcher.registerDAG(childDAG);
  dispatcher.registerDAG(parentDAG);
};

void describe('Embedded-DAG lifecycle scoping', () => {
  void it('fires flow/node observer hooks at the right scope and completes the lifecycle once', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();
    registerLifecycleFixtures(dispatcher);

    const state = new NodeStateBase();
    assert.equal(state.lifecycle.kind, 'pending');

    const result = await dispatcher.execute('parent', state);

    // Run completes cleanly; the state lifecycle transitions only once through
    // running → completed. No spurious markRunning / markCompleted from the
    // embedded-DAG body re-entry (which would throw on a terminal → running
    // transition and leave the lifecycle in an invalid state).
    assert.equal(result.state.lifecycle.kind, 'completed', 'run completed cleanly');
    assert.equal(state.lifecycle.kind, 'completed');

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
    registerLifecycleFixtures(dispatcher);

    const result = await dispatcher.execute('parent', new NodeStateBase());

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

class PassNode extends ScalarNode<NodeStateBase, 'ok'> {
  readonly name = 'pass';
  readonly outputs = ['ok'] as const;
  protected async executeOne(): Promise<NodeOutputType<'ok'>> { return { 'errors': [], 'output': 'ok' as const }; }
}

const passNode = new PassNode();

void describe('embedded-DAG terminal-outcome propagation', () => {
  void it('inner TerminalNode(failed) routes parent to error without collectError', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(passNode);

    // Inner DAG: pass → terminal(failed). No collectError anywhere.
    const innerDag = new DAGBuilder('inner-fail', '1')
      .node('pass', passNode, { 'ok': 'end-fail' })
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();
    dispatcher.registerDAG(innerDag);

    // Parent DAG: embedded-DAG node, success/error routing to distinct terminals.
    const parentDag = new DAGBuilder('parent', '1')
      .embeddedDAG('run-inner', 'inner-fail', { 'success': 'end-ok', 'error': 'end-bad' })
      .terminal('end-ok', { 'outcome': 'completed' })
      .terminal('end-bad', { 'outcome': 'failed' })
      .build();
    dispatcher.registerDAG(parentDag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('parent', state);

    assert.equal(result.terminalOutcome, 'failed', 'parent terminal outcome is failed');
    assert.equal(result.state.lifecycle.kind, 'failed', 'parent lifecycle is failed');
    assert.equal(result.state.errors.length, 0, 'no node errors collected');
    assert.ok(result.executedNodes.includes('end-bad'), 'parent routed through end-bad');
  });

  void it('inner TerminalNode(completed) routes parent to success', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(passNode);

    const innerDag = new DAGBuilder('inner-ok', '1')
      .node('pass', passNode, { 'ok': 'end-ok' })
      .terminal('end-ok', { 'outcome': 'completed' })
      .build();
    dispatcher.registerDAG(innerDag);

    const parentDag = new DAGBuilder('parent-ok', '1')
      .embeddedDAG('run-inner', 'inner-ok', { 'success': 'end-ok', 'error': 'end-bad' })
      .terminal('end-ok', { 'outcome': 'completed' })
      .terminal('end-bad', { 'outcome': 'failed' })
      .build();
    dispatcher.registerDAG(parentDag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('parent-ok', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.state.lifecycle.kind, 'completed');
    assert.ok(result.executedNodes.includes('end-ok'));
  });

  void it('inner TerminalNode(completed) without errors routes parent to success (default propagation)', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(passNode);

    // Inner DAG exits via TerminalNode(completed) with no errors.
    const innerDag = new DAGBuilder('inner-null', '1')
      .node('pass', passNode, { 'ok': 'inner-done' })
      .terminal('inner-done', { 'outcome': 'completed' })
      .build();
    dispatcher.registerDAG(innerDag);

    const parentDag = new DAGBuilder('parent-completed', '1')
      .embeddedDAG('run-inner', 'inner-null', { 'success': 'end-ok', 'error': 'end-bad' })
      .terminal('end-ok', { 'outcome': 'completed' })
      .terminal('end-bad', { 'outcome': 'failed' })
      .build();
    dispatcher.registerDAG(parentDag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('parent-completed', state);

    // Inner TerminalNode(completed) + no errors → parent routes via success.
    assert.equal(result.state.lifecycle.kind, 'completed');
    assert.ok(result.executedNodes.includes('end-ok'));
  });

  void it('top-level execute() surfaces terminalOutcome matching the TerminalNode outcome field', async () => {
    // Every flow ends at an explicit TerminalNode; the returned result's
    // terminalOutcome reflects that terminal's declared outcome.
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(passNode);

    const dag = new DAGBuilder('top', '1')
      .node('pass', passNode, { 'ok': 'flow-end' })
      .terminal('flow-end', { 'outcome': 'completed' })
      .build();
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('top', new NodeStateBase());
    assert.equal(result.terminalOutcome, 'completed');
  });
});

// ── Registration / validation fixtures ──────────────────────────────────────

// Sub-DAG used as a reusable component.
const helperDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:helper',
  '@type':    'DAG',
  'name':       'helper',
  'version':    '1',
  'entrypoint': 'step',
  'nodes': [
    {
      '@id':   'urn:noocodex:dag:helper/node/step',
      '@type': 'SingleNode',
      'name':  'step',
      'node':  'step',
      'outputs': { 'done': 'end' },
    },
    { '@id': 'urn:noocodex:dag:helper/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

void describe('registerDAG: embedded-DAG null-route acceptance', () => {
  void it('accepts embedded-DAG placement with success → end (sugar for terminate-completed)', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('step', ['done']));
    dispatcher.registerNode(TestNode.make('entry', ['next']));
    dispatcher.registerDAG(helperDAG);

    // Parent DAG where the embedded-DAG body routes 'success' → end (terminate-completed)
    const parentWithNullScatter: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:null-parent',
      '@type':    'DAG',
      'name':       'null-parent',
      'version':    '1',
      'entrypoint': 'entry',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:null-parent/node/entry',
          '@type': 'SingleNode',
          'name':  'entry',
          'node':  'entry',
          'outputs': { 'next': 'run-helper' },
        },
        {
          '@id':   'urn:noocodex:dag:null-parent/node/run-helper',
          '@type': 'EmbeddedDAGNode',
          'name':  'run-helper',
          'dag':   'helper',
          'outputs': { 'success': 'end', 'error': 'end' },
        },
        { '@id': 'urn:noocodex:dag:null-parent/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(parentWithNullScatter));

    const state = new NodeStateBase();
    const result = await dispatcher.execute('null-parent', state);
    assert.equal(result.state.lifecycle.kind, 'completed', 'flow completes cleanly');
  });

  void it('accepts embedded-DAG placement with mixed null and explicit-target routes', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('step', ['done']));
    dispatcher.registerNode(TestNode.make('entry', ['next']));
    dispatcher.registerNode(TestNode.make('after', ['done']));

    dispatcher.registerDAG(helperDAG);

    const parentWithMixedRoutes: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:mixed-parent',
      '@type':    'DAG',
      'name':       'mixed-parent',
      'version':    '1',
      'entrypoint': 'entry',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:mixed-parent/node/entry',
          '@type': 'SingleNode',
          'name':  'entry',
          'node':  'entry',
          'outputs': { 'next': 'run-helper' },
        },
        {
          '@id':   'urn:noocodex:dag:mixed-parent/node/after',
          '@type': 'SingleNode',
          'name':  'after',
          'node':  'after',
          'outputs': { 'done': 'end' },
        },
        {
          '@id':   'urn:noocodex:dag:mixed-parent/node/run-helper',
          '@type': 'EmbeddedDAGNode',
          'name':  'run-helper',
          'dag':   'helper',
          'outputs': {
            'error':   'after',  // routes to a parent placement
            'success': 'end',     // terminate-completed
          },
        },
        { '@id': 'urn:noocodex:dag:mixed-parent/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(parentWithMixedRoutes));

    const state = new NodeStateBase();
    const result = await dispatcher.execute('mixed-parent', state);
    assert.equal(result.state.lifecycle.kind, 'completed', 'flow completes cleanly');
  });

  void it('accepts valid embedded-DAG placements where all outputs route to parent placements', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('step', ['done']));
    dispatcher.registerNode(TestNode.make('entry', ['next']));
    dispatcher.registerNode(TestNode.make('terminal', ['done']));
    dispatcher.registerDAG(helperDAG);

    // All embedded-DAG outputs route to a real parent placement; no nulls
    const validParent: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:valid-parent',
      '@type':    'DAG',
      'name':       'valid-parent',
      'version':    '1',
      'entrypoint': 'entry',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:valid-parent/node/entry',
          '@type': 'SingleNode',
          'name':  'entry',
          'node':  'entry',
          'outputs': { 'next': 'run-helper' },
        },
        {
          '@id':   'urn:noocodex:dag:valid-parent/node/terminal',
          '@type': 'SingleNode',
          'name':  'terminal',
          'node':  'terminal',
          'outputs': { 'done': 'end' },
        },
        {
          '@id':   'urn:noocodex:dag:valid-parent/node/run-helper',
          '@type': 'EmbeddedDAGNode',
          'name':  'run-helper',
          'dag':   'helper',
          'outputs': {
            'success': 'terminal',
            'error':   'terminal',
          },
        },
        { '@id': 'urn:noocodex:dag:valid-parent/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(validParent));
  });

  void it('rejects a DAG without @context, @id, @type fields', () => {
    // A flat (non-JSON-LD) DAG object must fail schema validation
    const flatDag = {
      'name':       'flat',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        { 'type': 'single', 'name': 'step', 'node': 'step', 'outputs': { 'done': 'end' } },
        { '@id': 'urn:noocodex:dag:x/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    assert.throws(() => Validator.dag.validate(flatDag));
  });

  void it('rejects a node placement using the old discriminator string (not ScatterNode)', () => {
    // Placements must use @type: 'ScatterNode'; the 'EmbeddedDAGNode' discriminator is invalid.
    const oldStylePlacement = {
      '@id':   'urn:noocodex:dag:x/node/run-helper',
      '@type': 'EmbeddedDAGNode',
      'name':  'run-helper',
      'dag':   'helper',
      'outputs': { 'success': 'next', 'error': 'next' },
    };
    assert.equal(Validator.scatterNode.is(oldStylePlacement), false);
  });
});
