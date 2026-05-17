import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DAG } from '../../src/entities/index.js';
import { CytoscapeRenderer } from '../../src/viz/CytoscapeRenderer.js';
import type { CytoscapeNodeElement } from '../../src/viz/CytoscapeRenderer.js';

const isNode = (element: { group: 'nodes' | 'edges' }): element is CytoscapeNodeElement =>
  element.group === 'nodes';

void describe('CytoscapeRenderer.render', () => {
  void it('emits one node + edges-with-labels for a single-node DAG with terminal route', () => {
    const dag: DAG = {
      'name': 'mini',
      'version': '1',
      'entrypoint': 'greet',
      'nodes': [{ 'type': 'single', 'name': 'greet', 'node': 'greet', 'outputs': { 'success': null } }],
    };
    const elements = CytoscapeRenderer.render(dag);
    const nodes = elements.filter((entry) => entry.group === 'nodes');
    const edges = elements.filter((entry) => entry.group === 'edges');
    assert.equal(nodes.length, 2);                          // greet + synthetic END
    assert.equal(edges.length, 1);
    assert.equal(edges[0]?.data.label, 'success');
    assert.equal(edges[0]?.data.target, 'END');
  });

  void it('marks fan-out placements with type=fan-out', () => {
    const dag: DAG = {
      'name': 'fan',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [{
        'type': 'fan-out',
        'name': 'fan',
        'node': 'worker',
        'source': 'items',
        'fanIn': { 'strategy': 'append', 'target': 'collected' },
        'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
      }],
    };
    const elements = CytoscapeRenderer.render(dag);
    const fan = elements.find((entry): entry is CytoscapeNodeElement => isNode(entry) && entry.data.id === 'fan');
    assert.equal(fan?.data.type, 'fan-out');
    assert.equal(fan?.classes, 'dag-fan-out');
  });

  void it('parallel placements carry children + combine in data', () => {
    const dag: DAG = {
      'name': 'par',
      'version': '1',
      'entrypoint': 'group',
      'nodes': [{
        'type': 'parallel',
        'name': 'group',
        'nodes': ['a', 'b'],
        'combine': 'collect',
        'outputs': { 'success': null, 'error': null },
      }],
    };
    const elements = CytoscapeRenderer.render(dag);
    const group = elements.find((entry): entry is CytoscapeNodeElement => isNode(entry) && entry.data.id === 'group');
    assert.equal(group?.data.type, 'parallel');
    assert.deepEqual(group?.data['children'], ['a', 'b']);
    assert.equal(group?.data['combine'], 'collect');
  });

  void it('routes targeting named placements produce non-terminal edges', () => {
    const dag: DAG = {
      'name': 'chain',
      'version': '1',
      'entrypoint': 'a',
      'nodes': [
        { 'type': 'single', 'name': 'a', 'node': 'n', 'outputs': { 'success': 'b' } },
        { 'type': 'single', 'name': 'b', 'node': 'n', 'outputs': { 'success': null } },
      ],
    };
    const elements = CytoscapeRenderer.render(dag);
    const edge = elements.find((entry) => entry.group === 'edges' && entry.data.source === 'a');
    assert.equal(edge?.data.target, 'b');
    const terminalEdges = elements.filter(
      (entry) => entry.group === 'edges' && entry.data.target === 'END',
    );
    assert.equal(terminalEdges.length, 1);
  });

  void it('every edge has a stable id derived from source/output/target', () => {
    const dag: DAG = {
      'name': 'ids',
      'version': '1',
      'entrypoint': 'a',
      'nodes': [{ 'type': 'single', 'name': 'a', 'node': 'n', 'outputs': { 'success': null, 'error': null } }],
    };
    const elements = CytoscapeRenderer.render(dag);
    const ids = elements
      .filter((entry) => entry.group === 'edges')
      .map((entry) => entry.data.id);
    assert.deepEqual([...ids].sort(), ['a__error__END', 'a__success__END']);
  });
});
