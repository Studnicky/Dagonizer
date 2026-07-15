/**
 * Tests for TypedEmbeddedDAGOptionsType typed path narrowing and the
 * generic embed() builder method.
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
import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import type { EmbeddedDAGNodeType } from '../../src/entities/dag/EmbeddedDAGNode.js';
import { Placement } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

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

const terminal = TestNode.make('urn:noocodec:node:terminal', ['success']);
const placementIri = (dagIri: string, placement: string): string => `${dagIri}/node/${placement}`;
const WIRE_TEST_DAG_IRI = 'urn:noocodec:dag:state-mapping-test';
const PATH_TEST_DAG_IRI = 'urn:noocodec:dag:state-mapping-path-test';
const INPUTS_TEST_DAG_IRI = 'urn:noocodec:dag:state-mapping-inputs';
const OUTPUTS_TEST_DAG_IRI = 'urn:noocodec:dag:state-mapping-outputs';
const NO_MAPPING_TEST_DAG_IRI = 'urn:noocodec:dag:state-mapping-no-mapping';
const EMPTY_OPTS_TEST_DAG_IRI = 'urn:noocodec:dag:state-mapping-empty-opts';
const CHILD_DAG_IRI = 'urn:noocodec:dag:state-mapping-child';
const PARENT_DAG_IRI = 'urn:noocodec:dag:state-mapping-parent';
const MAPPING_CHILD_DAG_IRI = 'urn:noocodec:dag:state-mapping-child-mapping';
const MAPPING_PARENT_DAG_IRI = 'urn:noocodec:dag:state-mapping-parent-mapping';

/** Narrows the first node in a DAG to EmbeddedDAGNodeType, failing the test if it isn't. */
class PlacementAssert {
  private constructor() {}

  static embeddedFirst(dag: DAGType): EmbeddedDAGNodeType {
    const node = dag.nodes[0];
    if (node === undefined || !Placement.isEmbeddedDAG(node)) {
      assert.fail('first node must be an EmbeddedDAGNode');
    }
    return node;
  }
}

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

void describe('DAGBuilder.embed: wire shape', () => {
  void it('inputs + outputs build the correct EmbeddedDAGNodeType wire shape', () => {
    const dag = new DAGBuilder(WIRE_TEST_DAG_IRI, '1', { 'name': 'test' })
      .embed<ChildState, ChildState>(placementIri(WIRE_TEST_DAG_IRI, 'invoke'), 'urn:noocodec:dag:child-dag',
        { 'success': placementIri(WIRE_TEST_DAG_IRI, 'end'), 'error': placementIri(WIRE_TEST_DAG_IRI, 'end') },
        {
          'inputs':  { 'payload': 'payload' },
          'outputs': { 'result': 'result' },
          'name': 'invoke',
        },
      )
      .node(placementIri(WIRE_TEST_DAG_IRI, 'end'), terminal, { 'success': placementIri(WIRE_TEST_DAG_IRI, 'end') }, { 'name': 'end' })
      .build();

    const embeddedPlacement = PlacementAssert.embeddedFirst(dag);
    assert.equal(embeddedPlacement['@type'], 'EmbeddedDAGNode');
    assert.deepEqual(embeddedPlacement.stateMapping?.input,  { 'payload': 'payload' });
    assert.deepEqual(embeddedPlacement.stateMapping?.output, { 'result': 'result' });
  });

  void it('nested parent paths build the correct EmbeddedDAGNodeType wire shape', () => {
    const dag = new DAGBuilder(PATH_TEST_DAG_IRI, '1', { 'name': 'path-test' })
      .embed<ChildState, ParentState>(placementIri(PATH_TEST_DAG_IRI, 'invoke'), 'urn:noocodec:dag:child-dag',
        { 'success': placementIri(PATH_TEST_DAG_IRI, 'end'), 'error': placementIri(PATH_TEST_DAG_IRI, 'end') },
        {
          'inputs':  { 'payload': 'user.age' },
          'outputs': { 'user.age': 'result' },
          'name': 'invoke',
        },
      )
      .terminal(placementIri(PATH_TEST_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    const embeddedPlacement = PlacementAssert.embeddedFirst(dag);
    assert.equal(embeddedPlacement['@type'], 'EmbeddedDAGNode');
    assert.deepEqual(embeddedPlacement.stateMapping?.input,  { 'payload': 'user.age' });
    assert.deepEqual(embeddedPlacement.stateMapping?.output, { 'user.age': 'result' });
  });

  void it('inputs-only produces EmbeddedDAGNodeType with stateMapping.input and no output', () => {
    const dag = new DAGBuilder(INPUTS_TEST_DAG_IRI, '1', { 'name': 'test-inputs' })
      .embed<ChildState, ChildState>(placementIri(INPUTS_TEST_DAG_IRI, 'invoke'), 'urn:noocodec:dag:child-dag',
        { 'success': placementIri(INPUTS_TEST_DAG_IRI, 'end'), 'error': placementIri(INPUTS_TEST_DAG_IRI, 'end') },
        { 'inputs': { 'result': 'result' }, 'name': 'invoke' },
      )
      .terminal(placementIri(INPUTS_TEST_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    const embeddedPlacement = PlacementAssert.embeddedFirst(dag);
    assert.equal(embeddedPlacement['@type'], 'EmbeddedDAGNode');
    assert.deepEqual(embeddedPlacement.stateMapping?.input, { 'result': 'result' });
    assert.equal(embeddedPlacement.stateMapping?.output, undefined);
  });

  void it('outputs-only produces EmbeddedDAGNodeType with stateMapping.output and no input', () => {
    const dag = new DAGBuilder(OUTPUTS_TEST_DAG_IRI, '1', { 'name': 'test-outputs' })
      .embed<ChildState, ChildState>(placementIri(OUTPUTS_TEST_DAG_IRI, 'invoke'), 'urn:noocodec:dag:child-dag',
        { 'success': placementIri(OUTPUTS_TEST_DAG_IRI, 'end'), 'error': placementIri(OUTPUTS_TEST_DAG_IRI, 'end') },
        { 'outputs': { 'result': 'result' }, 'name': 'invoke' },
      )
      .terminal(placementIri(OUTPUTS_TEST_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    const embeddedPlacement = PlacementAssert.embeddedFirst(dag);
    assert.equal(embeddedPlacement['@type'], 'EmbeddedDAGNode');
    assert.equal(embeddedPlacement.stateMapping?.input, undefined);
    assert.deepEqual(embeddedPlacement.stateMapping?.output, { 'result': 'result' });
  });

  void it('omitting options produces no stateMapping on the node', () => {
    const dag = new DAGBuilder(NO_MAPPING_TEST_DAG_IRI, '1', { 'name': 'test-no-mapping' })
      .embed(placementIri(NO_MAPPING_TEST_DAG_IRI, 'invoke'), 'urn:noocodec:dag:child-dag', {
        'success': placementIri(NO_MAPPING_TEST_DAG_IRI, 'end'),
        'error': placementIri(NO_MAPPING_TEST_DAG_IRI, 'end'),
      }, { 'name': 'invoke' })
      .terminal(placementIri(NO_MAPPING_TEST_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    const embeddedPlacement = PlacementAssert.embeddedFirst(dag);
    assert.equal(embeddedPlacement['@type'], 'EmbeddedDAGNode');
    assert.equal(embeddedPlacement.stateMapping, undefined);
  });

  void it('empty options object produces no stateMapping', () => {
    const dag = new DAGBuilder(EMPTY_OPTS_TEST_DAG_IRI, '1', { 'name': 'test-empty-opts' })
      .embed<ChildState, ChildState>(placementIri(EMPTY_OPTS_TEST_DAG_IRI, 'invoke'), 'urn:noocodec:dag:child-dag',
        { 'success': placementIri(EMPTY_OPTS_TEST_DAG_IRI, 'end'), 'error': placementIri(EMPTY_OPTS_TEST_DAG_IRI, 'end') },
        { 'name': 'invoke' },
      )
      .terminal(placementIri(EMPTY_OPTS_TEST_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    const embeddedPlacement = PlacementAssert.embeddedFirst(dag);
    assert.equal(embeddedPlacement['@type'], 'EmbeddedDAGNode');
    assert.equal(embeddedPlacement.stateMapping, undefined);
  });
});

void describe('DAGBuilder.embed: runtime execute with typed mapping', () => {
  void it('inputs + outputs mappings propagate state correctly across the embedded-DAG boundary', async () => {
    // State carrying the fields both child and parent access.
    class WorkState extends NodeStateBase {
      payload = 'hello';
      result  = 0;
    }

    // Child node reads state.payload and writes state.result.
    class WorkChildNode extends MonadicNode<WorkState, 'success'> {
      readonly name = 'child-node';
      readonly '@id' = 'urn:noocodec:node:child-node';
      readonly outputs = ['success'] as const;
      override get outputSchema(): Record<'success', SchemaObjectType> {
        return { 'success': { 'type': 'object' } };
      }
      override async execute(batch: Batch<WorkState>): Promise<Map<'success', Batch<WorkState>>> {
        for (const item of batch) {
          item.state.result = item.state.payload.length;
        }
        return new Map([['success', batch]]);
      }
    }
    const childNode = new WorkChildNode();
    const terminalNode = TestNode.make<WorkState>('urn:noocodec:node:terminal', ['success']);

    const dispatcher = new Dagonizer<WorkState>();
    dispatcher.registerNode(childNode);
    dispatcher.registerNode(terminalNode);

    // Child DAG: just runs child-node and terminates.
    const childDag = new DAGBuilder(CHILD_DAG_IRI, '1', { 'name': 'child' })
      .node(placementIri(CHILD_DAG_IRI, 'child-node'), childNode, { 'success': placementIri(CHILD_DAG_IRI, 'child-done') }, { 'name': 'child-node' })
      .terminal(placementIri(CHILD_DAG_IRI, 'child-done'), { 'name': 'child-done' })
      .build();
    dispatcher.registerDAG(childDag);

    // Parent DAG:
    //   inputs:  { payload: 'payload' } → child.payload ← parent.payload
    //   outputs: { result: 'result' }   → parent.result ← child.result
    const parentDag = new DAGBuilder(PARENT_DAG_IRI, '1', { 'name': 'parent' })
      .embed<WorkState, WorkState>(placementIri(PARENT_DAG_IRI, 'invoke'), CHILD_DAG_IRI,
        { 'success': placementIri(PARENT_DAG_IRI, 'end'), 'error': placementIri(PARENT_DAG_IRI, 'end') },
        {
          'inputs':  { 'payload': 'payload' },
          'outputs': { 'result': 'result' },
          'name': 'invoke',
        },
      )
      .terminal(placementIri(PARENT_DAG_IRI, 'end'), { 'name': 'end' })
      .build();
    dispatcher.registerDAG(parentDag);

    const workState = new WorkState();
    const result = await dispatcher.execute(PARENT_DAG_IRI, workState);
    assert.equal(result.state.lifecycle.variant, 'completed');
    // payload = 'hello' (5 chars), so result = 5 after embedded-DAG
    assert.equal(workState.result, 5);
  });

  void it('untyped embed (no generic) accepts string mappings', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(terminal);

    const childDag = new DAGBuilder(MAPPING_CHILD_DAG_IRI, '1', { 'name': 'mapping-child' })
      .node(placementIri(MAPPING_CHILD_DAG_IRI, 'terminal'), terminal, { 'success': placementIri(MAPPING_CHILD_DAG_IRI, 'mapping-child-done') }, { 'name': 'terminal' })
      .terminal(placementIri(MAPPING_CHILD_DAG_IRI, 'mapping-child-done'), { 'name': 'mapping-child-done' })
      .build();
    dispatcher.registerDAG(childDag);

    // No generic; defaults to NodeStateInterface; paths are loose `string`.
    const parentDag = new DAGBuilder(MAPPING_PARENT_DAG_IRI, '1', { 'name': 'mapping-parent' })
      .embed(placementIri(MAPPING_PARENT_DAG_IRI, 'run'), MAPPING_CHILD_DAG_IRI,
        {
          'success': placementIri(MAPPING_PARENT_DAG_IRI, 'mapping-end'),
          'error': placementIri(MAPPING_PARENT_DAG_IRI, 'mapping-end'),
        },
        { 'outputs': { 'dest': 'src' }, 'name': 'run' },
      )
      .terminal(placementIri(MAPPING_PARENT_DAG_IRI, 'mapping-end'), { 'name': 'mapping-end' })
      .build();
    dispatcher.registerDAG(parentDag);

    const result = await dispatcher.execute(MAPPING_PARENT_DAG_IRI, new NodeStateBase());
    assert.equal(result.state.lifecycle.variant, 'completed');
  });
});
