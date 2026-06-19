/**
 * Tests for TypedEmbeddedDAGOptionsType typed path narrowing and the
 * generic embeddedDAG() builder method.
 *
 * Covers:
 *   - Compile-time: input/output values narrow to Path<TParentState>; valid
 *     flat and nested paths are accepted, invalid paths fail to typecheck
 *     (@ts-expect-error guards).
 *   - Runtime wire shape: inputs/outputs (and their flat or nested combinations)
 *     build the correct EmbeddedDAGNodeType stateMapping; absent or empty options
 *     produce no stateMapping.
 *   - Runtime execute: typed and untyped inputs/outputs mappings propagate state
 *     correctly across the embedded-DAG boundary.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { TypedEmbeddedDAGOptionsType } from '../../src/builder/DAGBuilder.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { EmbeddedDAGNodeType } from '../../src/entities/dag/EmbeddedDAGNode.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
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

class TerminalNode extends ScalarNode<NodeStateBase, 'success'> {
  readonly name = 'terminal';
  readonly outputs = ['success'] as const;
  protected async executeOne(): Promise<NodeOutputType<'success'>> { return { 'errors': [], 'output': 'success' as const }; }
}
const terminal = new TerminalNode();

// ── Tests ─────────────────────────────────────────────────────────────────────

void describe('TypedEmbeddedDAGOptionsType<TChildState, TParentState>: compile-time path narrowing', () => {
  void it('accepts valid flat TState paths in input/output values', () => {
    // Values are parent paths narrowed to Path<TParentState> when TParentState
    // is concrete. 'payload' and 'result' are valid flat paths on ChildState.
    const opts: TypedEmbeddedDAGOptionsType<ChildState, ChildState> = {
      'inputs':  { 'payload': 'payload' },
      'outputs': { 'result': 'result' },
    };
    assert.deepEqual(opts.inputs,  { 'payload': 'payload' });
    assert.deepEqual(opts.outputs, { 'result': 'result' });
  });

  void it('rejects invalid flat TState paths in input values (@ts-expect-error guard)', () => {
    // @ts-expect-error: 'unknownParentPath' is not a Path<ChildState>; TypeScript must reject this
    const _bad: TypedEmbeddedDAGOptionsType<ChildState, ChildState> = { 'inputs': { 'payload': 'unknownParentPath' } };
    void _bad;
  });

  void it('accepts valid nested parent paths in input values', () => {
    // ParentState has user.name, user.age, count; all valid Path<ParentState> values.
    const opts: TypedEmbeddedDAGOptionsType<ChildState, ParentState> = {
      'inputs': { 'payload': 'user.age' },
    };
    assert.deepEqual(opts.inputs, { 'payload': 'user.age' });
  });

  void it('rejects invalid nested parent paths in input values (@ts-expect-error guard)', () => {
    // 'user.notReal' is not a valid Path<ParentState>; TypeScript must reject this.
    // @ts-expect-error: 'user.notReal' does not exist on Path<ParentState>
    const _bad: TypedEmbeddedDAGOptionsType<ChildState, ParentState> = { 'inputs': { 'payload': 'user.notReal' } };
    void _bad;
  });
});

void describe('DAGBuilder.embeddedDAG: wire shape', () => {
  void it('inputs + outputs build the correct EmbeddedDAGNodeType wire shape', () => {
    const dag = new DAGBuilder('test', '1')
      .embeddedDAG<ChildState, ChildState>('invoke', 'child-dag',
        { 'success': 'end', 'error': 'end' },
        {
          'inputs':  { 'payload': 'payload' },
          'outputs': { 'result': 'result' },
        },
      )
      .node('end', terminal, { 'success': 'end' })
      .build();

    const embeddedPlacement = dag.nodes[0] as EmbeddedDAGNodeType;
    assert.equal(embeddedPlacement['@type'], 'EmbeddedDAGNode');
    assert.deepEqual(embeddedPlacement.stateMapping?.input,  { 'payload': 'payload' });
    assert.deepEqual(embeddedPlacement.stateMapping?.output, { 'result': 'result' });
  });

  void it('nested parent paths build the correct EmbeddedDAGNodeType wire shape', () => {
    const dag = new DAGBuilder('path-test', '1')
      .embeddedDAG<ChildState, ParentState>('invoke', 'child-dag',
        { 'success': 'end', 'error': 'end' },
        {
          'inputs':  { 'payload': 'user.age' },
          'outputs': { 'user.age': 'result' },
        },
      )
      .build();

    const embeddedPlacement = dag.nodes[0] as EmbeddedDAGNodeType;
    assert.equal(embeddedPlacement['@type'], 'EmbeddedDAGNode');
    assert.deepEqual(embeddedPlacement.stateMapping?.input,  { 'payload': 'user.age' });
    assert.deepEqual(embeddedPlacement.stateMapping?.output, { 'user.age': 'result' });
  });

  void it('inputs-only produces EmbeddedDAGNodeType with stateMapping.input and no output', () => {
    const dag = new DAGBuilder('test-inputs', '1')
      .embeddedDAG<ChildState, ChildState>('invoke', 'child-dag',
        { 'success': 'end', 'error': 'end' },
        { 'inputs': { 'result': 'result' } },
      )
      .build();

    const embeddedPlacement = dag.nodes[0] as EmbeddedDAGNodeType;
    assert.equal(embeddedPlacement['@type'], 'EmbeddedDAGNode');
    assert.deepEqual(embeddedPlacement.stateMapping?.input, { 'result': 'result' });
    assert.equal(embeddedPlacement.stateMapping?.output, undefined);
  });

  void it('outputs-only produces EmbeddedDAGNodeType with stateMapping.output and no input', () => {
    const dag = new DAGBuilder('test-outputs', '1')
      .embeddedDAG<ChildState, ChildState>('invoke', 'child-dag',
        { 'success': 'end', 'error': 'end' },
        { 'outputs': { 'result': 'result' } },
      )
      .build();

    const embeddedPlacement = dag.nodes[0] as EmbeddedDAGNodeType;
    assert.equal(embeddedPlacement['@type'], 'EmbeddedDAGNode');
    assert.equal(embeddedPlacement.stateMapping?.input, undefined);
    assert.deepEqual(embeddedPlacement.stateMapping?.output, { 'result': 'result' });
  });

  void it('omitting options produces no stateMapping on the node', () => {
    const dag = new DAGBuilder('test-no-mapping', '1')
      .embeddedDAG('invoke', 'child-dag', { 'success': 'end', 'error': 'end' })
      .build();

    const embeddedPlacement = dag.nodes[0] as EmbeddedDAGNodeType;
    assert.equal(embeddedPlacement['@type'], 'EmbeddedDAGNode');
    assert.equal(embeddedPlacement.stateMapping, undefined);
  });

  void it('empty options object produces no stateMapping', () => {
    const dag = new DAGBuilder('test-empty-opts', '1')
      .embeddedDAG<ChildState, ChildState>('invoke', 'child-dag',
        { 'success': 'end', 'error': 'end' },
        {},
      )
      .build();

    const embeddedPlacement = dag.nodes[0] as EmbeddedDAGNodeType;
    assert.equal(embeddedPlacement['@type'], 'EmbeddedDAGNode');
    assert.equal(embeddedPlacement.stateMapping, undefined);
  });
});

void describe('DAGBuilder.embeddedDAG: runtime execute with typed mapping', () => {
  void it('inputs + outputs mappings propagate state correctly across the embedded-DAG boundary', async () => {
    // Child node reads cloneState.payload and writes cloneState.result.
    class ChildNode extends ScalarNode<ChildState, 'success'> {
      readonly name = 'child-node';
      readonly outputs = ['success'] as const;
      protected async executeOne(state: ChildState): Promise<NodeOutputType<'success'>> {
        // result = length of payload (deterministic, easy to assert)
        state.result = state.payload.length;
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    const childNode = new ChildNode();

    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(childNode);
    dispatcher.registerNode(terminal);

    // Child DAG: just runs child-node and terminates.
    const childDag = new DAGBuilder('child', '1')
      .node('child-node', childNode, { 'success': 'child-done' })
      .terminal('child-done')
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
      .terminal('end')
      .build();
    dispatcher.registerDAG(parentDag);

    // Use a state subclass that declares the fields we need.
    class WorkState extends NodeStateBase {
      payload = 'hello';
      result  = 0;
    }

    const workState = new WorkState();
    const dispatcher2 = new Dagonizer<WorkState>();
    dispatcher2.registerNode(childNode as unknown as NodeInterface<WorkState, 'success'>);
    dispatcher2.registerNode(terminal as unknown as NodeInterface<WorkState, 'success'>);
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
      .node('terminal', terminal, { 'success': 'compat-child-done' })
      .terminal('compat-child-done')
      .build();
    dispatcher.registerDAG(childDag);

    // No generic; defaults to NodeStateInterface; paths are loose `string`.
    const parentDag = new DAGBuilder('compat-parent', '1')
      .embeddedDAG('run', 'compat-child',
        { 'success': 'compat-end', 'error': 'compat-end' },
        { 'outputs': { 'dest': 'src' } },
      )
      .terminal('compat-end')
      .build();
    dispatcher.registerDAG(parentDag);

    const result = await dispatcher.execute('compat-parent', new NodeStateBase());
    assert.equal(result.state.lifecycle.kind, 'completed');
  });
});
