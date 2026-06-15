import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { ExecutionResultInterface } from '../../src/entities/execution/ExecutionResult.js';
import type { DAG } from '../../src/entities/index.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import type { NodeOutputInterface } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

// ── Observer subclass ─────────────────────────────────────────────────────

class CountingDagonizer<TState extends NodeStateBase> extends Dagonizer<TState> {
  flowStartCount  = 0;
  flowEndCount    = 0;
  nodeStartNames: string[] = [];
  nodeEndNames:   string[] = [];

  protected override onFlowStart(_dagName: string, _state: TState): void {
    this.flowStartCount++;
  }

  protected override onFlowEnd(_dagName: string, _state: TState, _result: ExecutionResultInterface<TState>): void {
    this.flowEndCount++;
  }

  protected override onNodeStart(nodeName: string, _state: TState): void {
    this.nodeStartNames.push(nodeName);
  }

  protected override onNodeEnd(nodeName: string, _output: string | null, _state: TState): void {
    this.nodeEndNames.push(nodeName);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

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
    _ctx: NodeContextInterface,
  ): Promise<NodeOutputInterface<string>> {
    return { 'errors': [], 'output': this.outputs[0] as string };
  }
}

const makeNode = (name: string, outputs: readonly string[]): MakeNodeImpl =>
  new MakeNodeImpl(name, outputs);

// ── Child DAG (two nodes: start → finish) ────────────────────────────────

const childDAG: DAG = {
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

// ── Parent DAG: entry → run-child (scatter/dag-body singleton) → parent-end ──

const parentDAG: DAG = {
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

void describe('Embedded-DAG lifecycle scoping', () => {
  void it('onFlowStart and onFlowEnd each fire exactly once per top-level execute()', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();

    dispatcher.registerNode(makeNode('child-start',  ['done']));
    dispatcher.registerNode(makeNode('child-finish', ['done']));
    dispatcher.registerNode(makeNode('parent-entry', ['next']));
    dispatcher.registerNode(makeNode('parent-end',   ['done']));

    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('parent', state);

    assert.equal(result.state.lifecycle.kind, 'completed', 'run completed cleanly');
    assert.equal(dispatcher.flowStartCount, 1, 'onFlowStart fired exactly once');
    assert.equal(dispatcher.flowEndCount,   1, 'onFlowEnd fired exactly once');
  });

  void it('onNodeStart and onNodeEnd fire for both parent and embedded-DAG nodes', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();

    dispatcher.registerNode(makeNode('child-start',  ['done']));
    dispatcher.registerNode(makeNode('child-finish', ['done']));
    dispatcher.registerNode(makeNode('parent-entry', ['next']));
    dispatcher.registerNode(makeNode('parent-end',   ['done']));

    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    await dispatcher.execute('parent', new NodeStateBase());

    // Parent nodes appear by their placement name; scatter/dag-body inner nodes
    // fire onNodeStart/onNodeEnd as well.
    const allStarted = dispatcher.nodeStartNames;
    const allEnded   = dispatcher.nodeEndNames;

    // Parent placement names must appear
    assert.ok(allStarted.includes('parent-entry'), 'parent-entry started');
    assert.ok(allStarted.includes('parent-end'),   'parent-end started');
    assert.ok(allEnded.includes('parent-entry'),   'parent-entry ended');
    assert.ok(allEnded.includes('parent-end'),     'parent-end ended');

    // Scatter/dag-body inner placement names must appear (engine fires onNodeStart/End per child node)
    assert.ok(allStarted.includes('child-start'),  'child-start started');
    assert.ok(allStarted.includes('child-finish'), 'child-finish started');
    assert.ok(allEnded.includes('child-start'),    'child-start ended');
    assert.ok(allEnded.includes('child-finish'),   'child-finish ended');
  });

  void it('state lifecycle transitions only once through running → completed', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();

    dispatcher.registerNode(makeNode('child-start',  ['done']));
    dispatcher.registerNode(makeNode('child-finish', ['done']));
    dispatcher.registerNode(makeNode('parent-entry', ['next']));
    dispatcher.registerNode(makeNode('parent-end',   ['done']));

    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    const state = new NodeStateBase();
    assert.equal(state.lifecycle.kind, 'pending');

    await dispatcher.execute('parent', state);

    // State must complete cleanly; no spurious markRunning / markCompleted
    // from the scatter body re-entry (which would throw on a terminal → running
    // transition and leave the lifecycle in an invalid state).
    assert.equal(state.lifecycle.kind, 'completed');
  });

  void it('executedNodes reflects parent placements only (not scatter-body internals)', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();

    dispatcher.registerNode(makeNode('child-start',  ['done']));
    dispatcher.registerNode(makeNode('child-finish', ['done']));
    dispatcher.registerNode(makeNode('parent-entry', ['next']));
    dispatcher.registerNode(makeNode('parent-end',   ['done']));

    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    const result = await dispatcher.execute('parent', new NodeStateBase());

    // The top-level runNodes only records the placements it dispatches:
    // parent-entry, run-child (the scatter placement), parent-end.
    assert.ok(result.executedNodes.includes('parent-entry'), 'parent-entry executed');
    assert.ok(result.executedNodes.includes('run-child'),    'run-child (scatter) executed');
    assert.ok(result.executedNodes.includes('parent-end'),   'parent-end executed');
    assert.ok(result.executedNodes.includes('end'),          'terminal end executed');
    assert.equal(result.executedNodes.length, 4, 'exactly 4 parent-level nodes recorded (3 + terminal)');
  });
});
