import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { ExecutionResultInterface } from '../../src/entities/execution/ExecutionResult.js';
import type { DAG } from '../../src/entities/index.js';
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

  protected override onNodeEnd(nodeName: string, _output: string | undefined, _state: TState): void {
    this.nodeEndNames.push(nodeName);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

const makeNode = (
  name: string,
  outputs: readonly string[],
): NodeInterface<NodeStateBase> => ({
  name,
  outputs,
  async execute() { return { 'output': outputs[0] as string }; },
});

// ── Sub-DAG (two nodes: start → finish) ──────────────────────────────────

const childDAG: DAG = {
  'name': 'child',
  'version': '1',
  'entrypoint': 'child-start',
  'nodes': [
    { 'type': 'single', 'name': 'child-start', 'node': 'child-start', 'outputs': { 'done': 'child-finish' } },
    { 'type': 'single', 'name': 'child-finish', 'node': 'child-finish', 'outputs': { 'done': null } },
  ],
};

// ── Parent DAG: entry → run-child (sub-dag) → parent-end ─────────────────

const parentDAG: DAG = {
  'name': 'parent',
  'version': '1',
  'entrypoint': 'parent-entry',
  'nodes': [
    { 'type': 'single', 'name': 'parent-entry', 'node': 'parent-entry',
      'outputs': { 'next': 'run-child' } },
    {
      'type': 'sub-dag',
      'name': 'run-child',
      'dag': 'child',
      'outputs': { 'success': 'parent-end', 'error': 'parent-end' },
    },
    { 'type': 'single', 'name': 'parent-end', 'node': 'parent-end',
      'outputs': { 'done': null } },
  ],
};

void describe('Sub-DAG lifecycle scoping', () => {
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

  void it('onNodeStart and onNodeEnd fire for both parent and sub-DAG nodes', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();

    dispatcher.registerNode(makeNode('child-start',  ['done']));
    dispatcher.registerNode(makeNode('child-finish', ['done']));
    dispatcher.registerNode(makeNode('parent-entry', ['next']));
    dispatcher.registerNode(makeNode('parent-end',   ['done']));

    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    await dispatcher.execute('parent', new NodeStateBase());

    // Parent nodes appear by their placement name; sub-DAG nodes appear
    // prefixed as "<sub-dag-placement>.<child-placement>" via intermediateResults
    // but onNodeStart/onNodeEnd fire for each node in the sub-DAG too.
    const allStarted = dispatcher.nodeStartNames;
    const allEnded   = dispatcher.nodeEndNames;

    // Parent placement names must appear
    assert.ok(allStarted.includes('parent-entry'), 'parent-entry started');
    assert.ok(allStarted.includes('parent-end'),   'parent-end started');
    assert.ok(allEnded.includes('parent-entry'),   'parent-entry ended');
    assert.ok(allEnded.includes('parent-end'),     'parent-end ended');

    // Sub-DAG placement names must appear (engine fires onNodeStart/End per child node)
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

    // State must complete cleanly — no spurious markRunning / markCompleted
    // from the sub-DAG re-entry (which would throw on a terminal → running
    // transition and leave the lifecycle in an invalid state).
    assert.equal(state.lifecycle.kind, 'completed');
  });

  void it('executedNodes reflects parent placements only (not sub-DAG internals)', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();

    dispatcher.registerNode(makeNode('child-start',  ['done']));
    dispatcher.registerNode(makeNode('child-finish', ['done']));
    dispatcher.registerNode(makeNode('parent-entry', ['next']));
    dispatcher.registerNode(makeNode('parent-end',   ['done']));

    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    const result = await dispatcher.execute('parent', new NodeStateBase());

    // The top-level runNodes only records the placements it dispatches:
    // parent-entry, run-child (the sub-dag placement), parent-end.
    assert.ok(result.executedNodes.includes('parent-entry'), 'parent-entry executed');
    assert.ok(result.executedNodes.includes('run-child'),    'run-child (sub-dag) executed');
    assert.ok(result.executedNodes.includes('parent-end'),   'parent-end executed');
    assert.equal(result.executedNodes.length, 3, 'exactly 3 parent-level nodes recorded');
  });
});
