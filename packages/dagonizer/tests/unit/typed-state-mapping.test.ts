/**
 * Tests for TypedEmbeddedDAGOptionsInterface typed path narrowing and the
 * generic embeddedDAG() builder method.
 *
 * Covers:
 *   1. Runtime: inputs + outputs build the correct EmbeddedDAGNode wire shape.
 *   2. Runtime: omitting options produces no stateMapping on the node.
 *   3. Compile-time: invalid input values fail to typecheck (@ts-expect-error).
 *   4. Runtime execute: typed inputs + outputs mappings propagate state correctly.
 *   5. Path<TState>: positive compile-time check for valid nested paths in input values.
 *   6. Path<TState>: negative compile-time check rejects invalid paths in input values.
 *   7. Path<TState>: runtime smoke; typed generic form builds correct wire shape.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { TypedEmbeddedDAGOptionsInterface } from '../../src/builder/DAGBuilder.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { EmbeddedDAGNode } from '../../src/entities/dag/EmbeddedDAGNode.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

// ── Domain child state ────────────────────────────────────────────────────────

class ChildState extends NodeStateBase {
  payload = '';
  result  = 0;
}

// ── Domain parent state (nested shape for Path<T> tests) ──────────────────────

class ParentState extends NodeStateBase {
  user = { 'name': '', 'age': 0 };
  count = 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const terminal: NodeInterface<NodeStateBase, 'success'> = {
  'name': 'terminal',
  'outputs': ['success'],
  async execute() { return { 'output': 'success' }; },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

void describe('TypedEmbeddedDAGOptionsInterface<TChildState, TParentState>: compile-time shape', () => {
  void it('accepts valid TState paths in input values', () => {
    // input values are parent paths narrowed to Path<TParentState> when TParentState is concrete.
    // 'payload' and 'result' are valid paths on ChildState used as parent paths here.
    const opts: TypedEmbeddedDAGOptionsInterface<ChildState, ChildState> = {
      'inputs':  { 'payload': 'payload' },
      'outputs': { 'result': 'result' },
    };
    assert.deepEqual(opts.inputs,  { 'payload': 'payload' });
    assert.deepEqual(opts.outputs, { 'result': 'result' });
  });

  void it('rejects invalid TState paths in input values (@ts-expect-error guard)', () => {
    // @ts-expect-error: 'unknownParentPath' is not a Path<ChildState>; TypeScript must reject this
    const _bad: TypedEmbeddedDAGOptionsInterface<ChildState, ChildState> = { 'inputs': { 'payload': 'unknownParentPath' } };
    void _bad;
  });
});

void describe('DAGBuilder.embeddedDAG: wire shape', () => {
  void it('inputs + outputs build the correct EmbeddedDAGNode wire shape', () => {
    const dag = new DAGBuilder('test', '1')
      .embeddedDAG<ChildState, ChildState>('invoke', 'child-dag',
        { 'success': 'end', 'error': 'end' },
        {
          'inputs':  { 'payload': 'payload' },
          'outputs': { 'result': 'result' },
        },
      )
      .node('end', terminal, { 'success': null })
      .build();

    const embeddedPlacement = dag.nodes[0] as EmbeddedDAGNode;
    assert.equal(embeddedPlacement['@type'], 'EmbeddedDAGNode');
    assert.deepEqual(embeddedPlacement.stateMapping?.input,  { 'payload': 'payload' });
    assert.deepEqual(embeddedPlacement.stateMapping?.output, { 'result': 'result' });
  });

  void it('inputs-only produces EmbeddedDAGNode with stateMapping.input and no output', () => {
    const dag = new DAGBuilder('test-inputs', '1')
      .embeddedDAG<ChildState, ChildState>('invoke', 'child-dag',
        { 'success': null, 'error': null },
        { 'inputs': { 'result': 'result' } },
      )
      .build();

    const embeddedPlacement = dag.nodes[0] as EmbeddedDAGNode;
    assert.deepEqual(embeddedPlacement.stateMapping?.input, { 'result': 'result' });
    assert.equal(embeddedPlacement.stateMapping?.output, undefined);
  });

  void it('outputs-only produces EmbeddedDAGNode with stateMapping.output and no input', () => {
    const dag = new DAGBuilder('test-outputs', '1')
      .embeddedDAG<ChildState, ChildState>('invoke', 'child-dag',
        { 'success': null, 'error': null },
        { 'outputs': { 'result': 'result' } },
      )
      .build();

    const embeddedPlacement = dag.nodes[0] as EmbeddedDAGNode;
    assert.equal(embeddedPlacement.stateMapping?.input, undefined);
    assert.deepEqual(embeddedPlacement.stateMapping?.output, { 'result': 'result' });
  });

  void it('omitting options produces no stateMapping on the node', () => {
    const dag = new DAGBuilder('test-no-mapping', '1')
      .embeddedDAG('invoke', 'child-dag', { 'success': null, 'error': null })
      .build();

    const embeddedPlacement = dag.nodes[0] as EmbeddedDAGNode;
    assert.equal(embeddedPlacement.stateMapping, undefined);
  });

  void it('empty options object produces no stateMapping', () => {
    const dag = new DAGBuilder('test-empty-opts', '1')
      .embeddedDAG<ChildState, ChildState>('invoke', 'child-dag',
        { 'success': null, 'error': null },
        {},
      )
      .build();

    const embeddedPlacement = dag.nodes[0] as EmbeddedDAGNode;
    assert.equal(embeddedPlacement.stateMapping, undefined);
  });
});

void describe('DAGBuilder.embeddedDAG: runtime execute with typed mapping', () => {
  void it('inputs + outputs mappings propagate state correctly across the embedded-DAG boundary', async () => {
    // Child node reads cloneState.payload and writes cloneState.result.
    const childNode: NodeInterface<ChildState, 'success'> = {
      'name': 'child-node',
      'outputs': ['success'],
      async execute(state) {
        // result = length of payload (deterministic, easy to assert)
        state.result = state.payload.length;
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
    //   inputs:  { payload: 'payload' } → child.payload ← parent.payload
    //   outputs: { result: 'result' }   → parent.result ← child.result
    const parentDag = new DAGBuilder('parent', '1')
      .embeddedDAG<ChildState, ChildState>('invoke', 'child',
        { 'success': 'end', 'error': 'end' },
        {
          'inputs':  { 'payload': 'payload' },
          'outputs': { 'result': 'result' },
        },
      )
      .node('end', terminal, { 'success': null })
      .build();
    dispatcher.registerDAG(parentDag);

    // Use a state subclass that declares the fields we need.
    class WorkState extends NodeStateBase {
      payload = 'hello';
      result  = 0;
    }

    const workState = new WorkState();
    const dispatcher2 = new Dagonizer<WorkState>();
    dispatcher2.registerNode(childNode as NodeInterface<WorkState, 'success'>);
    dispatcher2.registerNode(terminal as NodeInterface<WorkState, 'success'>);
    dispatcher2.registerDAG(childDag);
    dispatcher2.registerDAG(parentDag);

    const result = await dispatcher2.execute('parent', workState);
    assert.equal(result.state.lifecycle.kind, 'completed');
    // payload = 'hello' (5 chars), so result = 5 after embedded-DAG
    assert.equal(workState.result, 5);
  });

  void it('untyped embeddedDAG (no generic) accepts loose string mappings', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(terminal);

    const childDag = new DAGBuilder('compat-child', '1')
      .node('terminal', terminal, { 'success': null })
      .build();
    dispatcher.registerDAG(childDag);

    // No generic; defaults to NodeStateInterface; paths are loose `string`.
    const parentDag = new DAGBuilder('compat-parent', '1')
      .embeddedDAG('run', 'compat-child',
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

void describe('DAGBuilder.embeddedDAG: Path<TState> narrowing', () => {
  void it('positive compile: typed form accepts valid nested parent paths in input values', () => {
    // ParentState has user.name, user.age, count; all valid Path<ParentState> values.
    const opts: TypedEmbeddedDAGOptionsInterface<ChildState, ParentState> = {
      'inputs': { 'payload': 'user.age' },
    };
    assert.deepEqual(opts.inputs, { 'payload': 'user.age' });
  });

  void it('negative compile: typed form rejects invalid parent paths in input values (@ts-expect-error guard)', () => {
    // 'user.notReal' is not a valid Path<ParentState>; TypeScript must reject this.
    // @ts-expect-error: 'user.notReal' does not exist on Path<ParentState>
    const _bad: TypedEmbeddedDAGOptionsInterface<ChildState, ParentState> = { 'inputs': { 'payload': 'user.notReal' } };
    void _bad;
  });

  void it('runtime smoke: typed generic embeddedDAG builds the correct wire-shape node', () => {
    const dag = new DAGBuilder('path-test', '1')
      .embeddedDAG<ChildState, ParentState>('invoke', 'child-dag',
        { 'success': null, 'error': null },
        {
          'inputs':  { 'payload': 'user.age' },
          'outputs': { 'user.age': 'result' },
        },
      )
      .build();

    const embeddedPlacement = dag.nodes[0] as EmbeddedDAGNode;
    assert.equal(embeddedPlacement['@type'], 'EmbeddedDAGNode');
    assert.deepEqual(embeddedPlacement.stateMapping?.input,  { 'payload': 'user.age' });
    assert.deepEqual(embeddedPlacement.stateMapping?.output, { 'user.age': 'result' });
  });
});
