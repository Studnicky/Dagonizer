/**
 * container-builder.test.ts
 *
 * Builder round-trip tests for W1 container key support:
 *   - container flows through scatter({ container: 'x' }) into the placement
 *   - container flows through embeddedDAG({ container: 'x' }) into the placement
 *   - container is absent when not provided
 *   - node() does NOT accept a container option (no field on ScatterOptionsInterface for node-only)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';


const noop: NodeInterface<NodeStateBase, 'success'> = {
  'name': 'noop',
  'outputs': ['success'],
  async execute() { return { 'output': 'success' }; },
};

void describe('Builder container key', () => {
  void it('scatter with container option emits container property on placement', () => {
    const dag = new DAGBuilder('scatter-c', '1')
      .scatter('fan-out', 'items', { 'dag': 'child-dag' }, { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' }, {
        'container': 'cpu',
        'gather': { 'strategy': 'discard' },
      })
      .build();

    const placement = dag.nodes[0];
    assert.ok(placement !== undefined);
    assert.equal(placement['@type'], 'ScatterNode');
    assert.equal((placement as Record<string, unknown>)['container'], 'cpu');
  });

  void it('scatter without container option has no container property', () => {
    const dag = new DAGBuilder('scatter-nc', '1')
      .scatter('fan-out', 'items', noop, { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' }, {
        'gather': { 'strategy': 'discard' },
      })
      .build();

    const placement = dag.nodes[0];
    assert.ok(placement !== undefined);
    assert.equal(placement['@type'], 'ScatterNode');
    assert.equal('container' in placement, false, 'container should be absent when not provided');
  });

  void it('embeddedDAG with container option emits container property on placement', () => {
    const dag = new DAGBuilder('embed-c', '1')
      .embeddedDAG('invoke', 'child-dag', { 'success': 'end', 'error': 'end' }, {
        'container': 'isolated',
      })
      .build();

    const placement = dag.nodes[0];
    assert.ok(placement !== undefined);
    assert.equal(placement['@type'], 'EmbeddedDAGNode');
    assert.equal((placement as Record<string, unknown>)['container'], 'isolated');
  });

  void it('embeddedDAG without container option has no container property', () => {
    const dag = new DAGBuilder('embed-nc', '1')
      .embeddedDAG('invoke', 'child-dag', { 'success': 'end', 'error': 'end' })
      .build();

    const placement = dag.nodes[0];
    assert.ok(placement !== undefined);
    assert.equal(placement['@type'], 'EmbeddedDAGNode');
    assert.equal('container' in placement, false, 'container should be absent when not provided');
  });

  void it('node() placement has no container property', () => {
    const dag = new DAGBuilder('node-nc', '1')
      .node('noop', noop, { 'success': 'end' })
      .build();

    const placement = dag.nodes[0];
    assert.ok(placement !== undefined);
    assert.equal(placement['@type'], 'SingleNode');
    assert.equal('container' in placement, false, 'SingleNode never has a container property');
  });
});
