import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TerminalNodeType } from '../../src/entities/dag/TerminalNode.js';
import type { DAGType } from '../../src/entities/index.js';
import { DAG_CONTEXT } from '../../src/entities/index.js';
import { CytoscapeRenderer } from '../../src/viz/CytoscapeRenderer.js';
import type { CytoscapeNodeElementType, CytoscapeEdgeElementType } from '../../src/viz/CytoscapeRenderer.js';
import { RoleColorUtils } from '../../src/viz/internal.js';

class CytoscapeRendererGuard {
  private constructor() {}

  static isNode(element: { group: 'nodes' | 'edges' }): element is CytoscapeNodeElementType {
    return element.group === 'nodes';
  }
}

void describe('CytoscapeRenderer.render', () => {
  void it('emits one node + edge-to-terminal for a single-node DAG with explicit TerminalNodeType', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:mini',
      '@type':    'DAG',
      'name':       'mini',
      'version':    '1',
      'entrypoint': 'greet',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:mini/node/greet',
          '@type':  'SingleNode',
          'name':   'greet',
          'node':   'greet',
          'outputs': { 'success': 'done' },
        },
        {
          '@id':    'urn:noocodex:dag:mini/node/done',
          '@type':  'TerminalNode',
          'name':   'done',
          'outcome': 'completed',
        },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const nodes = elements.filter((entry) => entry.group === 'nodes');
    const edges = elements.filter((entry): entry is CytoscapeEdgeElementType => entry.group === 'edges');
    assert.equal(nodes.length, 2);                          // greet + done
    assert.equal(edges.length, 1);
    assert.equal(edges[0]?.data.label, 'success');
    assert.equal(edges[0]?.data.target, 'done');
  });

  void it('marks ScatterNode placements with type=scatter and class dag-scatter', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fan',
      '@type':    'DAG',
      'name':     'fan',
      'version':  '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:fan/node/fan',
          '@type':  'ScatterNode',
          'name':   'fan',
          'body':   { 'node': 'worker' },
          'source': 'items',
          'gather': { 'strategy': 'partition', 'partitions': { 'success': 'collected', 'error': 'errors' } },
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        },
        { '@id': 'urn:noocodex:dag:fan/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const fan = elements.find((entry): entry is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(entry) && entry.data.id === 'fan');
    assert.equal(fan?.data.type, 'scatter');
    assert.equal(fan?.classes, 'dag-scatter');
  });

  void it('routes targeting named placements produce edges to those placements', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:chain',
      '@type':    'DAG',
      'name':       'chain',
      'version':    '1',
      'entrypoint': 'a',
      'nodes': [
        { '@id': 'urn:noocodex:dag:chain/node/a', '@type': 'SingleNode', 'name': 'a', 'node': 'n', 'outputs': { 'success': 'b' } },
        { '@id': 'urn:noocodex:dag:chain/node/b', '@type': 'SingleNode', 'name': 'b', 'node': 'n', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:chain/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const edgeAtoB = elements.find((entry): entry is CytoscapeEdgeElementType => entry.group === 'edges' && entry.data.source === 'a');
    assert.equal(edgeAtoB?.data.target, 'b');
    const edgeBtoEnd = elements.find((entry): entry is CytoscapeEdgeElementType => entry.group === 'edges' && entry.data.source === 'b');
    assert.equal(edgeBtoEnd?.data.target, 'end');
    // no synthetic END (there are no null routes)
    const endNodes = elements.filter((el) => CytoscapeRendererGuard.isNode(el) && el.data.id === 'END');
    assert.equal(endNodes.length, 0, 'no synthetic END node when null routes are absent');
  });

  void it('every edge has a stable id derived from source/output/target', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:ids',
      '@type':    'DAG',
      'name':       'ids',
      'version':    '1',
      'entrypoint': 'a',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ids/node/a',
          '@type':  'SingleNode',
          'name':   'a',
          'node':   'n',
          'outputs': { 'success': 'end', 'error': 'end' },
        },
        { '@id': 'urn:noocodex:dag:ids/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const ids = elements
      .filter((entry) => entry.group === 'edges')
      .map((entry) => entry.data.id);
    assert.deepEqual([...ids].sort(), ['a__error__end', 'a__success__end']);
  });

  void it('EmbeddedDAGNode expands inline when the DAG is registered', () => {
    const innerDAG: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:inner',
      '@type':    'DAG',
      'name':     'inner',
      'version':  '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:inner/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'done': 'end' },
        },
        { '@id': 'urn:noocodex:dag:inner/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const outerDAG: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:outer',
      '@type':    'DAG',
      'name':     'outer',
      'version':  '1',
      'entrypoint': 'embed',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:outer/node/embed',
          '@type': 'EmbeddedDAGNode',
          'name':  'embed',
          'dag':   'inner',
          'outputs': { 'success': 'end', 'error': 'end' },
        },
        { '@id': 'urn:noocodex:dag:outer/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const embeddedDAGs = new Map<string, DAGType>([['inner', innerDAG]]);
    const elements = CytoscapeRenderer.render(outerDAG, { embeddedDAGs });

    // The compound parent node is emitted for the EmbeddedDAGNode placement
    const embedNode = elements.find((el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'embed');
    assert.ok(embedNode !== undefined, 'embed compound node must be present');
    assert.equal(embedNode.data.type, 'embedded-dag');
    assert.equal(embedNode.classes, 'dag-embedded-dag');

    // The inner step node is emitted as a child with parent=embed
    const stepNode = elements.find((el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'embed/step');
    assert.ok(stepNode !== undefined, 'embed/step inner node must be present');
    assert.equal(stepNode.data['parent'], 'embed');
  });

  void it('ScatterNode with body.node does not expand inline', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:scatter-node',
      '@type':    'DAG',
      'name':     'scatter-node',
      'version':  '1',
      'entrypoint': 'scatter',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:scatter-node/node/scatter',
          '@type':  'ScatterNode',
          'name':   'scatter',
          'body':   { 'node': 'worker' },
          'source': 'items',
          'gather': { 'strategy': 'discard' },
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        },
        { '@id': 'urn:noocodex:dag:scatter-node/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const embeddedDAGs = new Map<string, DAGType>();
    const elements = CytoscapeRenderer.render(dag, { embeddedDAGs });

    // No inner children emitted; node-body scatters are opaque
    const childNodes = elements.filter(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id.startsWith('scatter/'),
    );
    assert.equal(childNodes.length, 0, 'node-body ScatterNode must not expand inline');

    // The scatter node itself is still emitted as type=scatter
    const scatterNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'scatter',
    );
    assert.ok(scatterNode !== undefined);
    assert.equal(scatterNode.data.type, 'scatter');
  });
});

void describe('CytoscapeRenderer.render: containment coloring', () => {
  void it('contained EmbeddedDAGNode carries data.container, color data, and dag-contained class; in-process does not', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:cy-worker',
      '@type':    'DAG',
      'name':       'cy-worker',
      'version':    '1',
      'entrypoint': 'plain',
      'nodes': [
        {
          '@id':     'urn:noocodex:dag:cy-worker/node/plain',
          '@type':   'SingleNode',
          'name':    'plain',
          'node':    'noop',
          'outputs': { 'success': 'worker' },
        },
        {
          '@id':       'urn:noocodex:dag:cy-worker/node/worker',
          '@type':     'EmbeddedDAGNode',
          'name':      'worker',
          'dag':       'inner',
          'container': 'cpu',
          'outputs':   { 'success': 'end', 'error': 'end' },
        },
        { '@id': 'urn:noocodex:dag:cy-worker/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const cpuColors = RoleColorUtils.forRole('cpu');

    const workerNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'worker',
    );
    assert.ok(workerNode !== undefined, 'worker node must be present');
    assert.equal(workerNode.data['container'], 'cpu', 'data.container must equal the role');
    assert.equal(workerNode.data['containerColor'],  cpuColors.fill,   'data.containerColor must match role fill');
    assert.equal(workerNode.data['containerStroke'], cpuColors.stroke, 'data.containerStroke must match role stroke');
    assert.equal(workerNode.data['containerText'],   cpuColors.text,   'data.containerText must match role text');
    assert.ok(
      typeof workerNode.classes === 'string' && workerNode.classes.includes('dag-contained'),
      'dag-contained class must be present',
    );
    // shape class is also present alongside dag-contained
    assert.ok(
      typeof workerNode.classes === 'string' && workerNode.classes.includes('dag-embedded-dag'),
      'dag-embedded-dag class must still be present',
    );

    const plainNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'plain',
    );
    assert.ok(plainNode !== undefined, 'plain node must be present');
    assert.equal(plainNode.data['container'],       undefined, 'in-process node must not have data.container');
    assert.equal(plainNode.data['containerColor'],  undefined, 'in-process node must not have data.containerColor');
    assert.equal(plainNode.data['containerStroke'], undefined, 'in-process node must not have data.containerStroke');
    assert.equal(plainNode.data['containerText'],   undefined, 'in-process node must not have data.containerText');
    assert.ok(
      typeof plainNode.classes === 'string' && !plainNode.classes.includes('dag-contained'),
      'in-process node must not have dag-contained class',
    );
  });

  void it('contained dag-body ScatterNode carries data.container, color data, and dag-contained class', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:cy-scatter-worker',
      '@type':    'DAG',
      'name':       'cy-scatter-worker',
      'version':    '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id':       'urn:noocodex:dag:cy-scatter-worker/node/fan',
          '@type':     'ScatterNode',
          'name':      'fan',
          'body':      { 'dag': 'item-dag' },
          'source':    'items',
          'gather':    { 'strategy': 'discard' },
          'container': 'gpu',
          'outputs':   { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        },
        { '@id': 'urn:noocodex:dag:cy-scatter-worker/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const gpuColors = RoleColorUtils.forRole('gpu');

    const fanNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'fan',
    );
    assert.ok(fanNode !== undefined, 'fan node must be present');
    assert.equal(fanNode.data.type, 'scatter');
    assert.equal(fanNode.data['container'],       'gpu');
    assert.equal(fanNode.data['containerColor'],  gpuColors.fill);
    assert.equal(fanNode.data['containerStroke'], gpuColors.stroke);
    assert.equal(fanNode.data['containerText'],   gpuColors.text);
    assert.ok(
      typeof fanNode.classes === 'string' && fanNode.classes.includes('dag-contained'),
    );
    assert.ok(
      typeof fanNode.classes === 'string' && fanNode.classes.includes('dag-scatter'),
    );
  });

  void it('node-body ScatterNode does not carry data.container or color data', () => {
    // container on a node-body scatter is a validation error, but the renderer
    // must not crash and must still emit the containment fields faithfully when
    // the JSON has the field (schema validation is a separate concern).
    // Here we test the normal case: a node-body scatter WITHOUT container.
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:cy-scatter-node',
      '@type':    'DAG',
      'name':       'cy-scatter-node',
      'version':    '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id':     'urn:noocodex:dag:cy-scatter-node/node/fan',
          '@type':   'ScatterNode',
          'name':    'fan',
          'body':    { 'node': 'worker' },
          'source':  'items',
          'gather':  { 'strategy': 'discard' },
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        },
        { '@id': 'urn:noocodex:dag:cy-scatter-node/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const fanNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'fan',
    );
    assert.ok(fanNode !== undefined);
    assert.equal(fanNode.data['container'],       undefined);
    assert.equal(fanNode.data['containerColor'],  undefined);
    assert.equal(fanNode.data['containerStroke'], undefined);
    assert.equal(fanNode.data['containerText'],   undefined);
    assert.ok(
      typeof fanNode.classes === 'string' && !fanNode.classes.includes('dag-contained'),
    );
  });

  void it('two placements with DIFFERENT roles get DIFFERENT containerColor values', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:cy-multi-role',
      '@type':    'DAG',
      'name':     'cy-multi-role',
      'version':  '1',
      'entrypoint': 'cpu-step',
      'nodes': [
        {
          '@id':       'urn:noocodex:dag:cy-multi-role/node/cpu-step',
          '@type':     'ScatterNode',
          'name':      'cpu-step',
          'body':      { 'dag': 'item-dag' },
          'source':    'tasks',
          'gather':    { 'strategy': 'discard' },
          'container': 'cpu',
          'outputs':   { 'all-success': 'io-step', 'partial': 'io-step', 'all-error': 'end', 'empty': 'end' },
        },
        {
          '@id':       'urn:noocodex:dag:cy-multi-role/node/io-step',
          '@type':     'EmbeddedDAGNode',
          'name':      'io-step',
          'dag':       'io-dag',
          'container': 'io',
          'outputs':   { 'success': 'end', 'error': 'end' },
        },
        { '@id': 'urn:noocodex:dag:cy-multi-role/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const cpuColors = RoleColorUtils.forRole('cpu');
    const ioColors  = RoleColorUtils.forRole('io');

    const cpuNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'cpu-step',
    );
    const ioNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'io-step',
    );

    assert.ok(cpuNode !== undefined, 'cpu-step node must be present');
    assert.ok(ioNode !== undefined,  'io-step node must be present');

    assert.equal(cpuNode.data['containerColor'], cpuColors.fill);
    assert.equal(ioNode.data['containerColor'],  ioColors.fill);
    // Different roles → different colors
    assert.notEqual(cpuNode.data['containerColor'], ioNode.data['containerColor']);
  });

  void it('two placements with the SAME role get the SAME containerColor value (grouping)', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:cy-same-role',
      '@type':    'DAG',
      'name':     'cy-same-role',
      'version':  '1',
      'entrypoint': 'a',
      'nodes': [
        {
          '@id':       'urn:noocodex:dag:cy-same-role/node/a',
          '@type':     'EmbeddedDAGNode',
          'name':      'a',
          'dag':       'inner-a',
          'container': 'cpu',
          'outputs':   { 'success': 'b' },
        },
        {
          '@id':       'urn:noocodex:dag:cy-same-role/node/b',
          '@type':     'EmbeddedDAGNode',
          'name':      'b',
          'dag':       'inner-b',
          'container': 'cpu',
          'outputs':   { 'success': 'end', 'error': 'end' },
        },
        { '@id': 'urn:noocodex:dag:cy-same-role/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const cpuColors = RoleColorUtils.forRole('cpu');

    const nodeA = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'a',
    );
    const nodeB = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'b',
    );

    assert.ok(nodeA !== undefined);
    assert.ok(nodeB !== undefined);
    // Both get the same color
    assert.equal(nodeA.data['containerColor'], cpuColors.fill);
    assert.equal(nodeB.data['containerColor'], cpuColors.fill);
    assert.equal(nodeA.data['containerColor'], nodeB.data['containerColor']);
  });
});

void describe('CytoscapeRenderer.render: TerminalNodeType', () => {
  void it('renders a completed TerminalNodeType with type=terminal and outcome=completed', () => {
    const terminal: TerminalNodeType = {
      '@id':     'urn:noocodex:dag:ct/node/done',
      '@type':   'TerminalNode',
      'name':    'done',
      'outcome': 'completed',
    };
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:ct',
      '@type':    'DAG',
      'name':       'ct',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ct/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'success': 'done' },
        },
        terminal,
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const doneNode = elements.find((el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'done');
    assert.ok(doneNode !== undefined, 'done node should exist');
    assert.equal(doneNode.data.type, 'terminal');
    assert.equal(doneNode.data['outcome'], 'completed');
    // no edges originate from the terminal node
    const edgesFromDone = elements.filter((el) => el.group === 'edges' && el.data.source === 'done');
    assert.equal(edgesFromDone.length, 0);
    // no synthetic END (no null routes)
    const endNode = elements.find((el) => CytoscapeRendererGuard.isNode(el) && el.data.id === 'END');
    assert.ok(endNode === undefined, 'no synthetic END node — null routes are gone');
  });

  void it('renders a failed TerminalNodeType with outcome=failed', () => {
    const terminal: TerminalNodeType = {
      '@id':     'urn:noocodex:dag:ct2/node/abort',
      '@type':   'TerminalNode',
      'name':    'abort',
      'outcome': 'failed',
    };
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:ct2',
      '@type':    'DAG',
      'name':       'ct2',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ct2/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'error': 'abort' },
        },
        terminal,
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const abortNode = elements.find((el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'abort');
    assert.ok(abortNode !== undefined);
    assert.equal(abortNode.data.type, 'terminal');
    assert.equal(abortNode.data['outcome'], 'failed');
  });

  void it('renders multiple TerminalNodes in the same DAG — both completed and failed', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:ct-multi',
      '@type':    'DAG',
      'name':       'ct-multi',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ct-multi/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'ok': 'done', 'error': 'abort' },
        },
        { '@id': 'urn:noocodex:dag:ct-multi/node/done',  '@type': 'TerminalNode', 'name': 'done',  'outcome': 'completed' },
        { '@id': 'urn:noocodex:dag:ct-multi/node/abort', '@type': 'TerminalNode', 'name': 'abort', 'outcome': 'failed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const doneNode  = elements.find((el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'done');
    const abortNode = elements.find((el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'abort');
    assert.ok(doneNode !== undefined, 'done node must be present');
    assert.ok(abortNode !== undefined, 'abort node must be present');
    assert.equal(doneNode.data['outcome'], 'completed');
    assert.equal(abortNode.data['outcome'], 'failed');
    // they are distinct elements
    assert.notEqual(doneNode.data.id, abortNode.data.id);
    // no synthetic END
    const endNode = elements.find((el) => CytoscapeRendererGuard.isNode(el) && el.data.id === 'END');
    assert.ok(endNode === undefined, 'no synthetic END node');
  });
});

void describe('CytoscapeRenderer.render: PhaseNode', () => {
  void it('renders a pre-phase PhaseNode with data.type===phase and data.phase/node populated', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:ph',
      '@type':    'DAG',
      'name':       'ph',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ph/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'success': 'end' },
        },
        {
          '@id':   'urn:noocodex:dag:ph/node/setup',
          '@type': 'PhaseNode',
          'name':  'setup',
          'node':  'setup-worker',
          'phase': 'pre',
        },
        { '@id': 'urn:noocodex:dag:ph/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const setupNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'setup',
    );
    assert.ok(setupNode !== undefined, 'PhaseNode element must be present');
    assert.equal(setupNode.data.type, 'phase');
    assert.equal(setupNode.data['phase'], 'pre');
    assert.equal(setupNode.data['node'], 'setup-worker');
    assert.equal(setupNode.classes, 'dag-phase');
    // PhaseNode emits no outgoing edges
    const edgesFromSetup = elements.filter(
      (el) => el.group === 'edges' && el.data.source === 'setup',
    );
    assert.equal(edgesFromSetup.length, 0);
  });

  void it('renders a post-phase PhaseNode with data.phase===post', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:ph2',
      '@type':    'DAG',
      'name':       'ph2',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ph2/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'success': 'end' },
        },
        {
          '@id':   'urn:noocodex:dag:ph2/node/teardown',
          '@type': 'PhaseNode',
          'name':  'teardown',
          'node':  'teardown-worker',
          'phase': 'post',
        },
        { '@id': 'urn:noocodex:dag:ph2/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const teardownNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'teardown',
    );
    assert.ok(teardownNode !== undefined, 'post-phase PhaseNode element must be present');
    assert.equal(teardownNode.data.type, 'phase');
    assert.equal(teardownNode.data['phase'], 'post');
  });
});

void describe('CytoscapeRenderer.titleCase', () => {
  void it("converts 'extract-query' to 'Extract Query'", () => {
    assert.equal(CytoscapeRenderer.titleCase('extract-query'), 'Extract Query');
  });

  void it("converts 'similar-search/openlibrary-scout' to 'Similar Search / Openlibrary Scout'", () => {
    assert.equal(
      CytoscapeRenderer.titleCase('similar-search/openlibrary-scout'),
      'Similar Search / Openlibrary Scout',
    );
  });

  void it("converts 'no-results' to 'No Results'", () => {
    assert.equal(CytoscapeRenderer.titleCase('no-results'), 'No Results');
  });

  void it('returns empty string unchanged', () => {
    assert.equal(CytoscapeRenderer.titleCase(''), '');
  });

  void it('capitalises a single word with no hyphens', () => {
    assert.equal(CytoscapeRenderer.titleCase('greet'), 'Greet');
  });
});

// ── Reservoir-glyph fixtures ────────────────────────────────────────────────

/** ScatterNode with a reservoir config (keyField + capacity + idleMs). */
const RESERVOIR_DAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:reservoir',
  '@type':    'DAG',
  'name':       'reservoir',
  'version':    '1',
  'entrypoint': 'buffer',
  'nodes': [
    {
      '@id':      'urn:noocodex:dag:reservoir/node/buffer',
      '@type':    'ScatterNode',
      'name':     'buffer',
      'body':     { 'node': 'worker' },
      'source':   'events',
      'gather':   { 'strategy': 'discard' },
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'tenantId', 'capacity': 50, 'idleMs': 5000 } },
      'outputs':  { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
    },
    { '@id': 'urn:noocodex:dag:reservoir/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
  ],
};

/** ScatterNode with reservoir but no idleMs (capacity-only flush). */
const RESERVOIR_NO_IDLEMS_DAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:reservoir-no-idle',
  '@type':    'DAG',
  'name':       'reservoir-no-idle',
  'version':    '1',
  'entrypoint': 'batch',
  'nodes': [
    {
      '@id':      'urn:noocodex:dag:reservoir-no-idle/node/batch',
      '@type':    'ScatterNode',
      'name':     'batch',
      'body':     { 'node': 'processor' },
      'source':   'records',
      'gather':   { 'strategy': 'discard' },
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'region', 'capacity': 100 } },
      'outputs':  { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
    },
    { '@id': 'urn:noocodex:dag:reservoir-no-idle/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
  ],
};

/** Plain ScatterNode — no reservoir field. Parity guard fixture. */
const PLAIN_SCATTER_DAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:plain-scatter',
  '@type':    'DAG',
  'name':       'plain-scatter',
  'version':    '1',
  'entrypoint': 'fan',
  'nodes': [
    {
      '@id':    'urn:noocodex:dag:plain-scatter/node/fan',
      '@type':  'ScatterNode',
      'name':   'fan',
      'body':   { 'node': 'worker' },
      'source': 'items',
      'gather': { 'strategy': 'discard' },
      'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
    },
    { '@id': 'urn:noocodex:dag:plain-scatter/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
  ],
};

void describe('CytoscapeRenderer.render: reservoir glyph', () => {
  void it('reservoir-configured scatter carries dag-reservoir + dag-scatter classes, type=scatter, and a reservoir data field with exact keyField/capacity/idleMs', () => {
    const elements = CytoscapeRenderer.render(RESERVOIR_DAG, {});
    const bufferNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'buffer',
    );
    assert.ok(bufferNode !== undefined, 'buffer node must be present');
    assert.ok(
      bufferNode.classes.includes('dag-reservoir'),
      `expected dag-reservoir in classes "${bufferNode.classes}"`,
    );
    assert.ok(
      bufferNode.classes.includes('dag-scatter'),
      `expected dag-scatter in classes "${bufferNode.classes}"`,
    );
    assert.equal(bufferNode.data.type, 'scatter');
    const res = bufferNode.data['reservoir'];
    assert.ok(res !== undefined, 'reservoir data field must be present');
    assert.equal(res.keyField, 'tenantId');
    assert.equal(res.capacity, 50);
    assert.equal(res.idleMs, 5000);
  });

  void it('reservoir data field without idleMs has idleMs undefined', () => {
    const elements = CytoscapeRenderer.render(RESERVOIR_NO_IDLEMS_DAG, {});
    const batchNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'batch',
    );
    assert.ok(batchNode !== undefined, 'batch node must be present');
    const res = batchNode.data['reservoir'];
    assert.ok(res !== undefined, 'reservoir data field must be present');
    assert.equal(res.keyField, 'region');
    assert.equal(res.capacity, 100);
    assert.equal(res.idleMs, undefined);
  });

  // ── Parity guard ──────────────────────────────────────────────────────────

  void it('plain (non-reservoir) scatter has no dag-reservoir class, no reservoir data field, classes exactly dag-scatter, and type=scatter', () => {
    const elements = CytoscapeRenderer.render(PLAIN_SCATTER_DAG, {});
    const fanNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === 'fan',
    );
    assert.ok(fanNode !== undefined, 'fan node must be present');
    assert.ok(
      !fanNode.classes.includes('dag-reservoir'),
      `dag-reservoir must not be in classes "${fanNode.classes}"`,
    );
    assert.equal(fanNode.data['reservoir'], undefined);
    assert.equal(fanNode.classes, 'dag-scatter');
    assert.equal(fanNode.data.type, 'scatter');
  });
});
