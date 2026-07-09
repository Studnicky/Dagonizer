import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TerminalNodeType } from '../../src/entities/dag/TerminalNode.js';
import type { DAGType } from '../../src/entities/index.js';
import { DAG_CONTEXT } from '../../src/entities/index.js';
import { CytoscapeRenderer } from '../../src/viz/CytoscapeRenderer.js';
import type { CytoscapeNodeElementType, CytoscapeEdgeElementType } from '../../src/viz/CytoscapeRenderer.js';
import { RoleColorUtils } from '../../src/viz/internal.js';
import { TestDag } from '../_support/TestDag.js';

const placementIri = TestDag.placementIri;
const nodeIri = (dagName: string, placement: string): string => `urn:noocodex:dag:${dagName}/node/${placement}`;
const scopedNodeIri = (parentIri: string, dagName: string, placement: string): string => `${parentIri}/${nodeIri(dagName, placement)}`;

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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:mini', 'greet') },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:mini/node/greet',
          '@type':  'SingleNode',
          'name':   'greet',
          'node':   'urn:noocodec:node:greet',
          'outputs': { 'success': placementIri('urn:noocodex:dag:mini', 'done') },
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
    assert.equal(edges[0]?.data.source, nodeIri('mini', 'greet'));
    assert.equal(edges[0]?.data.target, nodeIri('mini', 'done'));
  });

  void it('marks ScatterNode placements with type=scatter and class dag-scatter', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fan',
      '@type':    'DAG',
      'name':     'fan',
      'version':  '1',
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:fan', 'fan') },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:fan/node/fan',
          '@type':  'ScatterNode',
          'name':   'fan',
          'body':   { 'node': 'urn:noocodec:node:worker' },
          'source': 'items',
          'outputs': {
            'all-success': placementIri('urn:noocodex:dag:fan', 'end'),
            'partial': placementIri('urn:noocodex:dag:fan', 'end'),
            'all-error': placementIri('urn:noocodex:dag:fan', 'end'),
            'empty': placementIri('urn:noocodex:dag:fan', 'end'),
          },
        },
        { '@id': 'urn:noocodex:dag:fan/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const fan = elements.find((entry): entry is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(entry) && entry.data.id === nodeIri('fan', 'fan'));
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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:chain', 'a') },
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:chain/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'urn:noocodec:node:n',
          'outputs': { 'success': placementIri('urn:noocodex:dag:chain', 'b') },
        },
        {
          '@id': 'urn:noocodex:dag:chain/node/b',
          '@type': 'SingleNode',
          'name': 'b',
          'node': 'urn:noocodec:node:n',
          'outputs': { 'success': placementIri('urn:noocodex:dag:chain', 'end') },
        },
        { '@id': 'urn:noocodex:dag:chain/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const edgeAtoB = elements.find((entry): entry is CytoscapeEdgeElementType => entry.group === 'edges' && entry.data.source === nodeIri('chain', 'a'));
    assert.equal(edgeAtoB?.data.target, nodeIri('chain', 'b'));
    const edgeBtoEnd = elements.find((entry): entry is CytoscapeEdgeElementType => entry.group === 'edges' && entry.data.source === nodeIri('chain', 'b'));
    assert.equal(edgeBtoEnd?.data.target, nodeIri('chain', 'end'));
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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:ids', 'a') },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ids/node/a',
          '@type':  'SingleNode',
          'name':   'a',
          'node':   'urn:noocodec:node:n',
          'outputs': { 'success': placementIri('urn:noocodex:dag:ids', 'end'), 'error': placementIri('urn:noocodex:dag:ids', 'end') },
        },
        { '@id': 'urn:noocodex:dag:ids/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const ids = elements
      .filter((entry) => entry.group === 'edges')
      .map((entry) => entry.data.id);
    assert.deepEqual([...ids].sort(), [
      `${placementIri('urn:noocodex:dag:ids', 'a')}__error__${placementIri('urn:noocodex:dag:ids', 'end')}`,
      `${placementIri('urn:noocodex:dag:ids', 'a')}__success__${placementIri('urn:noocodex:dag:ids', 'end')}`,
    ]);
  });

  void it('EmbeddedDAGNode expands inline when the DAG is registered', () => {
    const innerDAG: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:inner',
      '@type':    'DAG',
      'name':     'inner',
      'version':  '1',
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:inner', 'step') },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:inner/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'urn:noocodec:node:step',
          'outputs': { 'done': placementIri('urn:noocodex:dag:inner', 'end') },
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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:outer', 'embed') },
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:outer/node/embed',
          '@type': 'EmbeddedDAGNode',
          'name':  'embed',
          'dag':   'urn:noocodex:dag:inner',
          'outputs': { 'success': placementIri('urn:noocodex:dag:outer', 'end'), 'error': placementIri('urn:noocodex:dag:outer', 'end') },
        },
        { '@id': 'urn:noocodex:dag:outer/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const embeddedDAGs = new Map<string, DAGType>([['urn:noocodex:dag:inner', innerDAG]]);
    const elements = CytoscapeRenderer.render(outerDAG, { embeddedDAGs });

    // The compound parent node is emitted for the EmbeddedDAGNode placement
    const embedNode = elements.find((el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('outer', 'embed'));
    assert.ok(embedNode !== undefined, 'embed compound node must be present');
    assert.equal(embedNode.data.type, 'embedded-dag');
    assert.equal(embedNode.classes, 'dag-embedded-dag');

    // The inner step node is emitted as a child with parent=embed
    const stepNode = elements.find((el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === scopedNodeIri(nodeIri('outer', 'embed'), 'inner', 'step'));
    assert.ok(stepNode !== undefined, 'embed/step inner node must be present');
    assert.equal(stepNode.data['parent'], nodeIri('outer', 'embed'));
  });

  void it('rewrites incoming embedded-DAG edges to every child entrypoint', () => {
    const innerDAG: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:inner-multi-entry',
      '@type':    'DAG',
      'name':     'inner-multi-entry',
      'version':  '1',
      'entrypoints': {
        'left': placementIri('urn:noocodex:dag:inner-multi-entry', 'left-root'),
        'right': placementIri('urn:noocodex:dag:inner-multi-entry', 'right-root'),
      },
      'nodes': [
        {
          '@id':     'urn:noocodex:dag:inner-multi-entry/node/left-root',
          '@type':   'SingleNode',
          'name':    'left-root',
          'node':    'urn:noocodec:node:left',
          'outputs': { 'done': placementIri('urn:noocodex:dag:inner-multi-entry', 'end') },
        },
        {
          '@id':     'urn:noocodex:dag:inner-multi-entry/node/right-root',
          '@type':   'SingleNode',
          'name':    'right-root',
          'node':    'urn:noocodec:node:right',
          'outputs': { 'done': placementIri('urn:noocodex:dag:inner-multi-entry', 'end') },
        },
        { '@id': 'urn:noocodex:dag:inner-multi-entry/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const outerDAG: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:outer-multi-entry',
      '@type':    'DAG',
      'name':     'outer-multi-entry',
      'version':  '1',
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:outer-multi-entry', 'start') },
      'nodes': [
        {
          '@id':     'urn:noocodex:dag:outer-multi-entry/node/start',
          '@type':   'SingleNode',
          'name':    'start',
          'node':    'urn:noocodec:node:start',
          'outputs': { 'success': placementIri('urn:noocodex:dag:outer-multi-entry', 'embed') },
        },
        {
          '@id':     'urn:noocodex:dag:outer-multi-entry/node/embed',
          '@type':   'EmbeddedDAGNode',
          'name':    'embed',
          'dag':     'urn:noocodex:dag:inner-multi-entry',
          'outputs': { 'success': placementIri('urn:noocodex:dag:outer-multi-entry', 'end'), 'error': placementIri('urn:noocodex:dag:outer-multi-entry', 'end') },
        },
        { '@id': 'urn:noocodex:dag:outer-multi-entry/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const embeddedDAGs = new Map<string, DAGType>([['urn:noocodex:dag:inner-multi-entry', innerDAG]]);
    const elements = CytoscapeRenderer.render(outerDAG, { embeddedDAGs });
    const startEdges = elements
      .filter((entry): entry is CytoscapeEdgeElementType => entry.group === 'edges' && entry.data.source === nodeIri('outer-multi-entry', 'start'))
      .map((edge) => edge.data.target)
      .sort();

    assert.deepEqual(startEdges, [
      scopedNodeIri(nodeIri('outer-multi-entry', 'embed'), 'inner-multi-entry', 'left-root'),
      scopedNodeIri(nodeIri('outer-multi-entry', 'embed'), 'inner-multi-entry', 'right-root'),
    ]);
  });

  void it('ScatterNode with body.node does not expand inline', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:scatter-node',
      '@type':    'DAG',
      'name':     'scatter-node',
      'version':  '1',
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:scatter-node', 'scatter') },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:scatter-node/node/scatter',
          '@type':  'ScatterNode',
          'name':   'scatter',
          'body':   { 'node': 'urn:noocodec:node:worker' },
          'source': 'items',
          'outputs': {
            'all-success': placementIri('urn:noocodex:dag:scatter-node', 'end'),
            'partial': placementIri('urn:noocodex:dag:scatter-node', 'end'),
            'all-error': placementIri('urn:noocodex:dag:scatter-node', 'end'),
            'empty': placementIri('urn:noocodex:dag:scatter-node', 'end'),
          },
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
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('scatter-node', 'scatter'),
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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:cy-worker', 'plain') },
      'nodes': [
        {
          '@id':     'urn:noocodex:dag:cy-worker/node/plain',
          '@type':   'SingleNode',
          'name':    'plain',
          'node':    'urn:noocodec:node:noop',
          'outputs': { 'success': placementIri('urn:noocodex:dag:cy-worker', 'worker') },
        },
        {
          '@id':       'urn:noocodex:dag:cy-worker/node/worker',
          '@type':     'EmbeddedDAGNode',
          'name':      'worker',
          'dag':       'urn:noocodex:dag:inner',
          'container': 'cpu',
          'outputs':   { 'success': placementIri('urn:noocodex:dag:cy-worker', 'end'), 'error': placementIri('urn:noocodex:dag:cy-worker', 'end') },
        },
        { '@id': 'urn:noocodex:dag:cy-worker/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const cpuColors = RoleColorUtils.forRole('cpu');

    const workerNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('cy-worker', 'worker'),
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
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('cy-worker', 'plain'),
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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:cy-scatter-worker', 'fan') },
      'nodes': [
        {
          '@id':       'urn:noocodex:dag:cy-scatter-worker/node/fan',
          '@type':     'ScatterNode',
          'name':      'fan',
          'body':      { 'dag': 'urn:noocodec:dag:item-dag' },
          'source':    'items',
          'container': 'gpu',
          'outputs':   {
            'all-success': placementIri('urn:noocodex:dag:cy-scatter-worker', 'end'),
            'partial': placementIri('urn:noocodex:dag:cy-scatter-worker', 'end'),
            'all-error': placementIri('urn:noocodex:dag:cy-scatter-worker', 'end'),
            'empty': placementIri('urn:noocodex:dag:cy-scatter-worker', 'end'),
          },
        },
        { '@id': 'urn:noocodex:dag:cy-scatter-worker/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const gpuColors = RoleColorUtils.forRole('gpu');

    const fanNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('cy-scatter-worker', 'fan'),
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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:cy-scatter-node', 'fan') },
      'nodes': [
        {
          '@id':     'urn:noocodex:dag:cy-scatter-node/node/fan',
          '@type':   'ScatterNode',
          'name':    'fan',
          'body':    { 'node': 'urn:noocodec:node:worker' },
          'source':  'items',
          'outputs': {
            'all-success': placementIri('urn:noocodex:dag:cy-scatter-node', 'end'),
            'partial': placementIri('urn:noocodex:dag:cy-scatter-node', 'end'),
            'all-error': placementIri('urn:noocodex:dag:cy-scatter-node', 'end'),
            'empty': placementIri('urn:noocodex:dag:cy-scatter-node', 'end'),
          },
        },
        { '@id': 'urn:noocodex:dag:cy-scatter-node/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const fanNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('cy-scatter-node', 'fan'),
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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:cy-multi-role', 'cpu-step') },
      'nodes': [
        {
          '@id':       'urn:noocodex:dag:cy-multi-role/node/cpu-step',
          '@type':     'ScatterNode',
          'name':      'cpu-step',
          'body':      { 'dag': 'urn:noocodec:dag:item-dag' },
          'source':    'tasks',
          'container': 'cpu',
          'outputs':   {
            'all-success': placementIri('urn:noocodex:dag:cy-multi-role', 'io-step'),
            'partial': placementIri('urn:noocodex:dag:cy-multi-role', 'io-step'),
            'all-error': placementIri('urn:noocodex:dag:cy-multi-role', 'end'),
            'empty': placementIri('urn:noocodex:dag:cy-multi-role', 'end'),
          },
        },
        {
          '@id':       'urn:noocodex:dag:cy-multi-role/node/io-step',
          '@type':     'EmbeddedDAGNode',
          'name':      'io-step',
          'dag':       'urn:noocodec:dag:io-dag',
          'container': 'io',
          'outputs':   { 'success': placementIri('urn:noocodex:dag:cy-multi-role', 'end'), 'error': placementIri('urn:noocodex:dag:cy-multi-role', 'end') },
        },
        { '@id': 'urn:noocodex:dag:cy-multi-role/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const cpuColors = RoleColorUtils.forRole('cpu');
    const ioColors  = RoleColorUtils.forRole('io');

    const cpuNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('cy-multi-role', 'cpu-step'),
    );
    const ioNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('cy-multi-role', 'io-step'),
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
      '@id':      'urn:noocodex:dag:same-role',
      '@type':    'DAG',
      'name':     'same-role',
      'version':  '1',
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:same-role', 'a') },
      'nodes': [
        {
          '@id':       'urn:noocodex:dag:same-role/node/a',
          '@type':     'EmbeddedDAGNode',
          'name':      'a',
          'dag':       'urn:noocodec:dag:inner-a',
          'container': 'cpu',
          'outputs':   { 'success': placementIri('urn:noocodex:dag:same-role', 'b') },
        },
        {
          '@id':       'urn:noocodex:dag:same-role/node/b',
          '@type':     'EmbeddedDAGNode',
          'name':      'b',
          'dag':       'urn:noocodec:dag:inner-b',
          'container': 'cpu',
          'outputs':   { 'success': placementIri('urn:noocodex:dag:same-role', 'end'), 'error': placementIri('urn:noocodex:dag:same-role', 'end') },
        },
        { '@id': 'urn:noocodex:dag:same-role/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const cpuColors = RoleColorUtils.forRole('cpu');

    const nodeA = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('same-role', 'a'),
    );
    const nodeB = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('same-role', 'b'),
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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:ct', 'step') },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ct/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'urn:noocodec:node:step',
          'outputs': { 'success': placementIri('urn:noocodex:dag:ct', 'done') },
        },
        terminal,
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const doneNode = elements.find((el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('ct', 'done'));
    assert.ok(doneNode !== undefined, 'done node should exist');
    assert.equal(doneNode.data.type, 'terminal');
    assert.equal(doneNode.data['outcome'], 'completed');
    // no edges originate from the terminal node
    const edgesFromDone = elements.filter((el) => el.group === 'edges' && el.data.source === nodeIri('ct', 'done'));
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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:ct2', 'step') },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ct2/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'urn:noocodec:node:step',
          'outputs': { 'error': placementIri('urn:noocodex:dag:ct2', 'abort') },
        },
        terminal,
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const abortNode = elements.find((el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('ct2', 'abort'));
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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:ct-multi', 'step') },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ct-multi/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'urn:noocodec:node:step',
          'outputs': {
            'ok': placementIri('urn:noocodex:dag:ct-multi', 'done'),
            'error': placementIri('urn:noocodex:dag:ct-multi', 'abort'),
          },
        },
        { '@id': 'urn:noocodex:dag:ct-multi/node/done',  '@type': 'TerminalNode', 'name': 'done',  'outcome': 'completed' },
        { '@id': 'urn:noocodex:dag:ct-multi/node/abort', '@type': 'TerminalNode', 'name': 'abort', 'outcome': 'failed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const doneNode  = elements.find((el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('ct-multi', 'done'));
    const abortNode = elements.find((el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('ct-multi', 'abort'));
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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:ph', 'step') },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ph/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'urn:noocodec:node:step',
          'outputs': { 'success': placementIri('urn:noocodex:dag:ph', 'end') },
        },
        {
          '@id':   'urn:noocodex:dag:ph/node/setup',
          '@type': 'PhaseNode',
          'name':  'setup',
          'node':  'urn:noocodec:node:setup-worker',
          'phase': 'pre',
        },
        { '@id': 'urn:noocodex:dag:ph/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const setupNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('ph', 'setup'),
    );
    assert.ok(setupNode !== undefined, 'PhaseNode element must be present');
    assert.equal(setupNode.data.type, 'phase');
    assert.equal(setupNode.data['phase'], 'pre');
    assert.equal(setupNode.data['node'], 'urn:noocodec:node:setup-worker');
    assert.equal(setupNode.classes, 'dag-phase');
    // PhaseNode emits no outgoing edges
    const edgesFromSetup = elements.filter(
      (el) => el.group === 'edges' && el.data.source === nodeIri('ph', 'setup'),
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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:ph2', 'step') },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ph2/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'urn:noocodec:node:step',
          'outputs': { 'success': placementIri('urn:noocodex:dag:ph2', 'end') },
        },
        {
          '@id':   'urn:noocodex:dag:ph2/node/teardown',
          '@type': 'PhaseNode',
          'name':  'teardown',
          'node':  'urn:noocodec:node:teardown-worker',
          'phase': 'post',
        },
        { '@id': 'urn:noocodex:dag:ph2/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const teardownNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('ph2', 'teardown'),
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
  'entrypoints': { 'main': placementIri('urn:noocodex:dag:reservoir', 'buffer') },
  'nodes': [
    {
      '@id':      'urn:noocodex:dag:reservoir/node/buffer',
      '@type':    'ScatterNode',
      'name':     'buffer',
      'body':     { 'node': 'urn:noocodec:node:worker' },
      'source':   'events',
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'tenantId', 'capacity': 50, 'idleMs': 5000 } },
      'outputs':  {
        'all-success': placementIri('urn:noocodex:dag:reservoir', 'end'),
        'partial': placementIri('urn:noocodex:dag:reservoir', 'end'),
        'all-error': placementIri('urn:noocodex:dag:reservoir', 'end'),
        'empty': placementIri('urn:noocodex:dag:reservoir', 'end'),
      },
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
  'entrypoints': { 'main': placementIri('urn:noocodex:dag:reservoir-no-idle', 'batch') },
  'nodes': [
    {
      '@id':      'urn:noocodex:dag:reservoir-no-idle/node/batch',
      '@type':    'ScatterNode',
      'name':     'batch',
      'body':     { 'node': 'urn:noocodec:node:processor' },
      'source':   'records',
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'region', 'capacity': 100 } },
      'outputs':  {
        'all-success': placementIri('urn:noocodex:dag:reservoir-no-idle', 'end'),
        'partial': placementIri('urn:noocodex:dag:reservoir-no-idle', 'end'),
        'all-error': placementIri('urn:noocodex:dag:reservoir-no-idle', 'end'),
        'empty': placementIri('urn:noocodex:dag:reservoir-no-idle', 'end'),
      },
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
  'entrypoints': { 'main': placementIri('urn:noocodex:dag:plain-scatter', 'fan') },
  'nodes': [
    {
      '@id':    'urn:noocodex:dag:plain-scatter/node/fan',
      '@type':  'ScatterNode',
      'name':   'fan',
      'body':   { 'node': 'urn:noocodec:node:worker' },
      'source': 'items',
      'outputs': {
        'all-success': placementIri('urn:noocodex:dag:plain-scatter', 'end'),
        'partial': placementIri('urn:noocodex:dag:plain-scatter', 'end'),
        'all-error': placementIri('urn:noocodex:dag:plain-scatter', 'end'),
        'empty': placementIri('urn:noocodex:dag:plain-scatter', 'end'),
      },
    },
    { '@id': 'urn:noocodex:dag:plain-scatter/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
  ],
};

void describe('CytoscapeRenderer.render: reservoir glyph', () => {
  void it('reservoir-configured scatter carries dag-reservoir + dag-scatter classes, type=scatter, and a reservoir data field with exact keyField/capacity/idleMs', () => {
    const elements = CytoscapeRenderer.render(RESERVOIR_DAG, {});
    const bufferNode = elements.find(
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('reservoir', 'buffer'),
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
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('reservoir-no-idle', 'batch'),
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
      (el): el is CytoscapeNodeElementType => CytoscapeRendererGuard.isNode(el) && el.data.id === nodeIri('plain-scatter', 'fan'),
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
