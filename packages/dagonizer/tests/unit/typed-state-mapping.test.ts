/**
 * Tests for TypedDeepDAGOptionsInterface and the generic deepDAG() builder method.
 *
 * Covers:
 *   1. Runtime: inputs/outputs build the correct wire-shape stateMapping.
 *   2. Runtime: omitting inputs/outputs produces no stateMapping on the node.
 *   3. Compile-time: wrong child-state keys fail to typecheck (@ts-expect-error).
 *   4. Runtime execute: typed input/output mappings propagate state correctly.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TypedDeepDAGOptionsInterface } from '../../src/builder/DAGBuilder.js';
import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { DeepDAGNode } from '../../src/entities/dag/DeepDAGNode.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

// ── Domain child state ────────────────────────────────────────────────────────

class ChildState extends NodeStateBase {
  payload = '';
  result  = 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const terminal: NodeInterface<NodeStateBase, 'success'> = {
  'name': 'terminal',
  'outputs': ['success'],
  async execute() { return { 'output': 'success' }; },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

void describe('TypedDeepDAGOptionsInterface — compile-time shape', () => {
  void it('accepts valid TChildState keys in inputs', () => {
    // Both 'payload' and 'result' are declared keys of ChildState — should typecheck.
    const opts: TypedDeepDAGOptionsInterface<ChildState> = {
      'inputs':  { 'payload': 'parent.seed' },
      'outputs': { 'parent.result': 'result' },
    };
    assert.deepEqual(opts.inputs,  { 'payload': 'parent.seed' });
    assert.deepEqual(opts.outputs, { 'parent.result': 'result' });
  });

  void it('rejects unknown child-state keys in inputs — @ts-expect-error guard', () => {
    // @ts-expect-error — 'unknownKey' is not a key of ChildState; TypeScript must reject this
    const _bad: TypedDeepDAGOptionsInterface<ChildState> = { 'inputs': { 'unknownKey': 'parent.foo' } };
    void _bad;
  });
});

void describe('DAGBuilder.deepDAG — wire shape', () => {
  void it('inputs + outputs build the correct stateMapping wire shape', () => {
    const dag = new DAGBuilder('test', '1')
      .deepDAG<ChildState>('invoke', 'child-dag',
        { 'success': 'end', 'error': 'end' },
        {
          'inputs':  { 'payload': 'seed' },
          'outputs': { 'result': 'childResult' },
        },
      )
      .node('end', terminal, { 'success': null })
      .build();

    const deepNode = dag.nodes[0] as DeepDAGNode;
    assert.equal(deepNode['@type'], 'DeepDAGNode');
    assert.deepEqual(deepNode.stateMapping, {
      'input':  { 'payload': 'seed' },
      'output': { 'result': 'childResult' },
    });
  });

  void it('inputs-only produces stateMapping with only input key', () => {
    const dag = new DAGBuilder('test-inputs', '1')
      .deepDAG<ChildState>('invoke', 'child-dag',
        { 'success': null, 'error': null },
        { 'inputs': { 'result': 'parent.value' } },
      )
      .build();

    const deepNode = dag.nodes[0] as DeepDAGNode;
    assert.deepEqual(deepNode.stateMapping, {
      'input': { 'result': 'parent.value' },
    });
  });

  void it('outputs-only produces stateMapping with only output key', () => {
    const dag = new DAGBuilder('test-outputs', '1')
      .deepDAG<ChildState>('invoke', 'child-dag',
        { 'success': null, 'error': null },
        { 'outputs': { 'parent.result': 'result' } },
      )
      .build();

    const deepNode = dag.nodes[0] as DeepDAGNode;
    assert.deepEqual(deepNode.stateMapping, {
      'output': { 'parent.result': 'result' },
    });
  });

  void it('omitting options produces no stateMapping on the node', () => {
    const dag = new DAGBuilder('test-no-mapping', '1')
      .deepDAG('invoke', 'child-dag', { 'success': null, 'error': null })
      .build();

    const deepNode = dag.nodes[0] as DeepDAGNode;
    assert.equal(deepNode.stateMapping, undefined);
  });

  void it('empty options object produces no stateMapping', () => {
    const dag = new DAGBuilder('test-empty-opts', '1')
      .deepDAG<ChildState>('invoke', 'child-dag',
        { 'success': null, 'error': null },
        {},
      )
      .build();

    const deepNode = dag.nodes[0] as DeepDAGNode;
    assert.equal(deepNode.stateMapping, undefined);
  });
});

void describe('DAGBuilder.deepDAG — runtime execute with typed mapping', () => {
  void it('input+output mappings propagate state correctly across the deep-DAG boundary', async () => {
    // Child node reads childState.payload and writes childState.result.
    const childNode: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'child-node',
      'outputs': ['success'],
      async execute(state) {
        const s = state as unknown as ChildState;
        // result = length of payload (deterministic, easy to assert)
        s.result = s.payload.length;
        return { 'output': 'success' };
      },
    };

    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(childNode);
    dispatcher.registerNode(terminal);

    // Child DAG: just runs child-node and terminates.
    const childDag = new DAGBuilder('child', '1')
      .node('child-node', childNode, { 'success': null })
      .build();
    dispatcher.registerDAG(childDag);

    // Parent DAG:
    //   inputs:  { payload: 'seed' }   → child.payload ← parent.seed
    //   outputs: { count: 'result' }   → parent.count  ← child.result
    const parentDag = new DAGBuilder('parent', '1')
      .deepDAG<ChildState>('invoke', 'child',
        { 'success': 'end', 'error': 'end' },
        {
          'inputs':  { 'payload': 'seed' },
          'outputs': { 'count': 'result' },
        },
      )
      .node('end', terminal, { 'success': null })
      .build();
    dispatcher.registerDAG(parentDag);

    // Parent state: seed = 'hello' (5 chars) → expect count = 5 after execution.
    const parentState = new NodeStateBase() as NodeStateBase & { seed: string; count: number };
    parentState.seed  = 'hello';
    (parentState as unknown as { count: number }).count = 0;

    const result = await dispatcher.execute('parent', parentState);
    assert.equal(result.state.lifecycle.kind, 'completed');
    assert.equal((parentState as unknown as { count: number }).count, 5);
  });

  void it('untyped deepDAG (no generic) remains backward-compatible', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(terminal);

    const childDag = new DAGBuilder('compat-child', '1')
      .node('terminal', terminal, { 'success': null })
      .build();
    dispatcher.registerDAG(childDag);

    // No generic — defaults to NodeStateInterface; call site still typechecks.
    const parentDag = new DAGBuilder('compat-parent', '1')
      .deepDAG('run', 'compat-child',
        { 'success': 'end', 'error': 'end' },
        { 'outputs': { 'dest': 'src' } },
      )
      .node('end', terminal, { 'success': null })
      .build();
    dispatcher.registerDAG(parentDag);

    const result = await dispatcher.execute('compat-parent', new NodeStateBase());
    assert.equal(result.state.lifecycle.kind, 'completed');
  });
});
