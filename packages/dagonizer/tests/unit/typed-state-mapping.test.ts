/**
 * Tests for ScatterOptionsInterface typed path narrowing and the generic
 * scatter() builder method.
 *
 * Covers:
 *   1. Runtime: projection + gather.mapping build the correct wire shape.
 *   2. Runtime: omitting options produces no projection/gather on the node.
 *   3. Compile-time: invalid projection values fail to typecheck (@ts-expect-error).
 *   4. Runtime execute: typed projection + gather mappings propagate state correctly.
 *   5. Path<TState>: positive compile-time check for valid nested paths in projection values.
 *   6. Path<TState>: negative compile-time check rejects invalid paths in projection values.
 *   7. Path<TState>: runtime smoke — typed generic form builds correct wire shape.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { ScatterOptionsInterface } from '../../src/builder/DAGBuilder.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { ScatterNode } from '../../src/entities/dag/ScatterNode.js';
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

void describe('ScatterOptionsInterface<TState> — compile-time shape', () => {
  void it('accepts valid TState paths in projection values', () => {
    // projection values are parent paths narrowed to Path<TState> when TState is concrete.
    // 'payload' and 'result' are valid paths on ChildState.
    const opts: ScatterOptionsInterface<ChildState> = {
      'projection': { 'cloneField': 'payload' },
      'gather': { 'strategy': 'map', 'mapping': { 'result': 'result' } },
    };
    assert.deepEqual(opts.projection, { 'cloneField': 'payload' });
    assert.deepEqual(opts.gather, { 'strategy': 'map', 'mapping': { 'result': 'result' } });
  });

  void it('rejects invalid TState paths in projection values — @ts-expect-error guard', () => {
    // @ts-expect-error — 'unknownParentPath' is not a Path<ChildState>; TypeScript must reject this
    const _bad: ScatterOptionsInterface<ChildState> = { 'projection': { 'cloneField': 'unknownParentPath' } };
    void _bad;
  });
});

void describe('DAGBuilder.scatter — wire shape', () => {
  void it('projection + gather.mapping build the correct scatter wire shape', () => {
    const dag = new DAGBuilder('test', '1')
      .scatter<ChildState, string, undefined>('invoke', { 'dag': 'child-dag' },
        { 'success': 'end', 'error': 'end' },
        {
          'projection': { 'payload': 'payload' },
          'gather': { 'strategy': 'map', 'mapping': { 'result': 'result' } },
        },
      )
      .node('end', terminal, { 'success': null })
      .build();

    const scatterPlacement = dag.nodes[0] as ScatterNode;
    assert.equal(scatterPlacement['@type'], 'ScatterNode');
    assert.deepEqual(scatterPlacement.projection, { 'payload': 'payload' });
    assert.deepEqual(scatterPlacement.gather, { 'strategy': 'map', 'mapping': { 'result': 'result' } });
  });

  void it('projection-only produces scatter node with projection and no gather', () => {
    const dag = new DAGBuilder('test-projection', '1')
      .scatter<ChildState, string, undefined>('invoke', { 'dag': 'child-dag' },
        { 'success': null, 'error': null },
        { 'projection': { 'result': 'result' } },
      )
      .build();

    const scatterPlacement = dag.nodes[0] as ScatterNode;
    assert.deepEqual(scatterPlacement.projection, { 'result': 'result' });
    assert.equal(scatterPlacement.gather, undefined);
  });

  void it('gather-only produces scatter node with gather and no projection', () => {
    const dag = new DAGBuilder('test-gather', '1')
      .scatter<ChildState, string, undefined>('invoke', { 'dag': 'child-dag' },
        { 'success': null, 'error': null },
        { 'gather': { 'strategy': 'map', 'mapping': { 'result': 'result' } } },
      )
      .build();

    const scatterPlacement = dag.nodes[0] as ScatterNode;
    assert.equal(scatterPlacement.projection, undefined);
    assert.deepEqual(scatterPlacement.gather, { 'strategy': 'map', 'mapping': { 'result': 'result' } });
  });

  void it('omitting options produces no projection or gather on the node', () => {
    const dag = new DAGBuilder('test-no-mapping', '1')
      .scatter('invoke', { 'dag': 'child-dag' }, { 'success': null, 'error': null })
      .build();

    const scatterPlacement = dag.nodes[0] as ScatterNode;
    assert.equal(scatterPlacement.projection, undefined);
    assert.equal(scatterPlacement.gather, undefined);
  });

  void it('empty options object produces no projection or gather', () => {
    const dag = new DAGBuilder('test-empty-opts', '1')
      .scatter<ChildState, string, undefined>('invoke', { 'dag': 'child-dag' },
        { 'success': null, 'error': null },
        {},
      )
      .build();

    const scatterPlacement = dag.nodes[0] as ScatterNode;
    assert.equal(scatterPlacement.projection, undefined);
    assert.equal(scatterPlacement.gather, undefined);
  });
});

void describe('DAGBuilder.scatter — runtime execute with typed mapping', () => {
  void it('projection + gather mappings propagate state correctly across the scatter boundary', async () => {
    // Child node reads cloneState.payload and writes cloneState.result.
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
    //   projection: { payload: 'payload' }  → clone.payload ← parent.payload
    //   gather.mapping: { result: 'result' } → parent.result ← clone.result
    // We cast parentState to carry 'payload' and 'result' fields via metadata.
    const parentDag = new DAGBuilder('parent', '1')
      .scatter<ChildState, string, undefined>('invoke', { 'dag': 'child' },
        { 'success': 'end', 'error': 'end' },
        {
          'projection': { 'payload': 'payload' },
          'gather': { 'strategy': 'map', 'mapping': { 'result': 'result' } },
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
    // payload = 'hello' (5 chars), so result = 5 after scatter
    assert.equal(workState.result, 5);
  });

  void it('untyped scatter (no generic) remains backward-compatible', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(terminal);

    const childDag = new DAGBuilder('compat-child', '1')
      .node('terminal', terminal, { 'success': null })
      .build();
    dispatcher.registerDAG(childDag);

    // No generic — defaults to NodeStateInterface; call site still typechecks.
    const parentDag = new DAGBuilder('compat-parent', '1')
      .scatter('run', { 'dag': 'compat-child' },
        { 'success': 'end', 'error': 'end' },
        { 'gather': { 'strategy': 'map', 'mapping': { 'dest': 'src' } } },
      )
      .node('end', terminal, { 'success': null })
      .build();
    dispatcher.registerDAG(parentDag);

    const result = await dispatcher.execute('compat-parent', new NodeStateBase());
    assert.equal(result.state.lifecycle.kind, 'completed');
  });
});

void describe('DAGBuilder.scatter — Path<TState> narrowing', () => {
  void it('positive compile: typed form accepts valid nested parent paths in projection values', () => {
    // ParentState has user.name, user.age, count — all valid Path<ParentState> values.
    const opts: ScatterOptionsInterface<ParentState> = {
      'projection': { 'cloneAge': 'user.age' },
    };
    assert.deepEqual(opts.projection, { 'cloneAge': 'user.age' });
  });

  void it('negative compile: typed form rejects invalid parent paths in projection values — @ts-expect-error guard', () => {
    // 'user.notReal' is not a valid Path<ParentState> — TypeScript must reject this.
    // @ts-expect-error — 'user.notReal' does not exist on Path<ParentState>
    const _bad: ScatterOptionsInterface<ParentState> = { 'projection': { 'cloneField': 'user.notReal' } };
    void _bad;
  });

  void it('runtime smoke: typed generic scatter builds the correct wire-shape node', () => {
    const dag = new DAGBuilder('path-test', '1')
      .scatter<ParentState, string, undefined>('invoke', { 'dag': 'child-dag' },
        { 'success': null, 'error': null },
        {
          'projection': { 'cloneAge': 'user.age' },
          'gather': { 'strategy': 'map', 'mapping': { 'age': 'user.age' } },
        },
      )
      .build();

    const scatterPlacement = dag.nodes[0] as ScatterNode;
    assert.equal(scatterPlacement['@type'], 'ScatterNode');
    assert.deepEqual(scatterPlacement.projection, { 'cloneAge': 'user.age' });
    assert.deepEqual(scatterPlacement.gather, { 'strategy': 'map', 'mapping': { 'age': 'user.age' } });
  });
});
