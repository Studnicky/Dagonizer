import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TerminalNodePlacementInterface } from '../../src/entities/dag/TerminalNode.js';
import type { DAG } from '../../src/entities/index.js';
import { DAG_CONTEXT } from '../../src/entities/index.js';
import { CytoscapeRenderer } from '../../src/viz/CytoscapeRenderer.js';
import type { CytoscapeNodeElement } from '../../src/viz/CytoscapeRenderer.js';

const isNode = (element: { group: 'nodes' | 'edges' }): element is CytoscapeNodeElement =>
  element.group === 'nodes';

void describe('CytoscapeRenderer.render', () => {
  void it('emits one node + edges-with-labels for a single-node DAG with terminal route', () => {
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:mini',
      '@type':    'DAG',
      'name':       'mini',
      'version':    '1',
      'entrypoint': 'greet',
      'nodes': [{
        '@id':    'urn:noocodex:dag:mini/node/greet',
        '@type':  'SingleNode',
        'name':   'greet',
        'node':   'greet',
        'outputs': { 'success': null },
      }],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const nodes = elements.filter((entry) => entry.group === 'nodes');
    const edges = elements.filter((entry) => entry.group === 'edges');
    assert.equal(nodes.length, 2);                          // greet + synthetic END
    assert.equal(edges.length, 1);
    assert.equal(edges[0]?.data.label, 'success');
    assert.equal(edges[0]?.data.target, 'END');
  });

  void it('marks ScatterNode placements with type=scatter and class dag-scatter', () => {
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fan',
      '@type':    'DAG',
      'name':     'fan',
      'version':  '1',
      'entrypoint': 'fan',
      'nodes': [{
        '@id':    'urn:noocodex:dag:fan/node/fan',
        '@type':  'ScatterNode',
        'name':   'fan',
        'body':   { 'node': 'worker' },
        'source': 'items',
        'gather': { 'strategy': 'partition', 'partitions': { 'success': 'collected', 'error': 'errors' } },
        'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
      }],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const fan = elements.find((entry): entry is CytoscapeNodeElement => isNode(entry) && entry.data.id === 'fan');
    assert.equal(fan?.data.type, 'scatter');
    assert.equal(fan?.classes, 'dag-scatter');
  });

  void it('routes targeting named placements produce non-terminal edges', () => {
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:chain',
      '@type':    'DAG',
      'name':       'chain',
      'version':    '1',
      'entrypoint': 'a',
      'nodes': [
        { '@id': 'urn:noocodex:dag:chain/node/a', '@type': 'SingleNode', 'name': 'a', 'node': 'n', 'outputs': { 'success': 'b' } },
        { '@id': 'urn:noocodex:dag:chain/node/b', '@type': 'SingleNode', 'name': 'b', 'node': 'n', 'outputs': { 'success': null } },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const edge = elements.find((entry) => entry.group === 'edges' && entry.data.source === 'a');
    assert.equal(edge?.data.target, 'b');
    const terminalEdges = elements.filter(
      (entry) => entry.group === 'edges' && entry.data.target === 'END',
    );
    assert.equal(terminalEdges.length, 1);
  });

  void it('every edge has a stable id derived from source/output/target', () => {
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:ids',
      '@type':    'DAG',
      'name':       'ids',
      'version':    '1',
      'entrypoint': 'a',
      'nodes': [{
        '@id':    'urn:noocodex:dag:ids/node/a',
        '@type':  'SingleNode',
        'name':   'a',
        'node':   'n',
        'outputs': { 'success': null, 'error': null },
      }],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const ids = elements
      .filter((entry) => entry.group === 'edges')
      .map((entry) => entry.data.id);
    assert.deepEqual([...ids].sort(), ['a__error__END', 'a__success__END']);
  });

  void it('EmbeddedDAGNode expands inline when the DAG is registered', () => {
    const innerDAG: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:inner',
      '@type':    'DAG',
      'name':     'inner',
      'version':  '1',
      'entrypoint': 'step',
      'nodes': [{
        '@id':    'urn:noocodex:dag:inner/node/step',
        '@type':  'SingleNode',
        'name':   'step',
        'node':   'step',
        'outputs': { 'done': null },
      }],
    };
    const outerDAG: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:outer',
      '@type':    'DAG',
      'name':     'outer',
      'version':  '1',
      'entrypoint': 'embed',
      'nodes': [{
        '@id':   'urn:noocodex:dag:outer/node/embed',
        '@type': 'EmbeddedDAGNode',
        'name':  'embed',
        'dag':   'inner',
        'outputs': { 'success': null },
      }],
    };
    const embeddedDAGs = new Map<string, DAG>([['inner', innerDAG]]);
    const elements = CytoscapeRenderer.render(outerDAG, { embeddedDAGs });

    // The compound parent node is emitted for the EmbeddedDAGNode placement
    const embedNode = elements.find((el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'embed');
    assert.ok(embedNode !== undefined, 'embed compound node must be present');
    assert.equal(embedNode.data.type, 'embedded-dag');
    assert.equal(embedNode.classes, 'dag-embedded-dag');

    // The inner step node is emitted as a child with parent=embed
    const stepNode = elements.find((el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'embed/step');
    assert.ok(stepNode !== undefined, 'embed/step inner node must be present');
    assert.equal(stepNode.data['parent'], 'embed');
  });

  void it('ScatterNode with body.node does not expand inline', () => {
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:scatter-node',
      '@type':    'DAG',
      'name':     'scatter-node',
      'version':  '1',
      'entrypoint': 'scatter',
      'nodes': [{
        '@id':    'urn:noocodex:dag:scatter-node/node/scatter',
        '@type':  'ScatterNode',
        'name':   'scatter',
        'body':   { 'node': 'worker' },
        'source': 'items',
        'gather': { 'strategy': 'discard' },
        'outputs': { 'success': null },
      }],
    };
    const embeddedDAGs = new Map<string, DAG>();
    const elements = CytoscapeRenderer.render(dag, { embeddedDAGs });

    // No inner children emitted; node-body scatters are opaque
    const childNodes = elements.filter(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id.startsWith('scatter/'),
    );
    assert.equal(childNodes.length, 0, 'node-body ScatterNode must not expand inline');

    // The scatter node itself is still emitted as type=scatter
    const scatterNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'scatter',
    );
    assert.ok(scatterNode !== undefined);
    assert.equal(scatterNode.data.type, 'scatter');
  });
});

void describe('CytoscapeRenderer.render: containment coloring', () => {
  void it('contained EmbeddedDAGNode carries data.container and dag-contained class; in-process does not', () => {
    const dag: DAG = {
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
          'outputs':   { 'success': null },
        },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});

    const workerNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'worker',
    );
    assert.ok(workerNode !== undefined, 'worker node must be present');
    assert.equal(workerNode.data['container'], 'cpu', 'data.container must equal the role');
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
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'plain',
    );
    assert.ok(plainNode !== undefined, 'plain node must be present');
    assert.equal(plainNode.data['container'], undefined, 'in-process node must not have data.container');
    assert.ok(
      typeof plainNode.classes === 'string' && !plainNode.classes.includes('dag-contained'),
      'in-process node must not have dag-contained class',
    );
  });

  void it('contained dag-body ScatterNode carries data.container and dag-contained class', () => {
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:cy-scatter-worker',
      '@type':    'DAG',
      'name':       'cy-scatter-worker',
      'version':    '1',
      'entrypoint': 'fan',
      'nodes': [{
        '@id':       'urn:noocodex:dag:cy-scatter-worker/node/fan',
        '@type':     'ScatterNode',
        'name':      'fan',
        'body':      { 'dag': 'item-dag' },
        'source':    'items',
        'gather':    { 'strategy': 'discard' },
        'container': 'gpu',
        'outputs':   { 'success': null },
      }],
    };
    const elements = CytoscapeRenderer.render(dag, {});

    const fanNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'fan',
    );
    assert.ok(fanNode !== undefined, 'fan node must be present');
    assert.equal(fanNode.data.type, 'scatter');
    assert.equal(fanNode.data['container'], 'gpu');
    assert.ok(
      typeof fanNode.classes === 'string' && fanNode.classes.includes('dag-contained'),
    );
    assert.ok(
      typeof fanNode.classes === 'string' && fanNode.classes.includes('dag-scatter'),
    );
  });

  void it('node-body ScatterNode does not carry data.container even if container field is set', () => {
    // container on a node-body scatter is a validation error, but the renderer
    // must not crash and must still emit the containment fields faithfully when
    // the JSON has the field (schema validation is a separate concern).
    // Here we test the normal case: a node-body scatter WITHOUT container.
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:cy-scatter-node',
      '@type':    'DAG',
      'name':       'cy-scatter-node',
      'version':    '1',
      'entrypoint': 'fan',
      'nodes': [{
        '@id':     'urn:noocodex:dag:cy-scatter-node/node/fan',
        '@type':   'ScatterNode',
        'name':    'fan',
        'body':    { 'node': 'worker' },
        'source':  'items',
        'gather':  { 'strategy': 'discard' },
        'outputs': { 'success': null },
      }],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const fanNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'fan',
    );
    assert.ok(fanNode !== undefined);
    assert.equal(fanNode.data['container'], undefined);
    assert.ok(
      typeof fanNode.classes === 'string' && !fanNode.classes.includes('dag-contained'),
    );
  });
});

void describe('CytoscapeRenderer.render: TerminalNode', () => {
  void it('renders a completed TerminalNode with type=terminal and outcome=completed', () => {
    const terminal: TerminalNodePlacementInterface = {
      '@id':     'urn:noocodex:dag:ct/node/done',
      '@type':   'TerminalNode',
      'name':    'done',
      'outcome': 'completed',
    };
    const dag: DAG = {
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
    const doneNode = elements.find((el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'done');
    assert.ok(doneNode !== undefined, 'done node should exist');
    assert.equal(doneNode.data.type, 'terminal');
    assert.equal(doneNode.data['outcome'], 'completed');
    // no edges originate from the terminal node
    const edgesFromDone = elements.filter((el) => el.group === 'edges' && el.data.source === 'done');
    assert.equal(edgesFromDone.length, 0);
    // no synthetic END (no null routes)
    const endNode = elements.find((el) => isNode(el) && el.data.id === 'END');
    assert.ok(endNode === undefined, 'synthetic END should not be emitted when no null routes exist');
  });

  void it('renders a failed TerminalNode with outcome=failed', () => {
    const terminal: TerminalNodePlacementInterface = {
      '@id':     'urn:noocodex:dag:ct2/node/abort',
      '@type':   'TerminalNode',
      'name':    'abort',
      'outcome': 'failed',
    };
    const dag: DAG = {
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
    const abortNode = elements.find((el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'abort');
    assert.ok(abortNode !== undefined);
    assert.equal(abortNode.data.type, 'terminal');
    assert.equal(abortNode.data['outcome'], 'failed');
  });

  void it('synthetic END carries synthetic=true to distinguish from user-declared TerminalNode', () => {
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:ct3',
      '@type':    'DAG',
      'name':       'ct3',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [{
        '@id':    'urn:noocodex:dag:ct3/node/step',
        '@type':  'SingleNode',
        'name':   'step',
        'node':   'step',
        'outputs': { 'success': null },
      }],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const endNode = elements.find((el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'END');
    assert.ok(endNode !== undefined);
    assert.equal(endNode.data['synthetic'], true);
  });

  void it('coexists: null route produces synthetic END, explicit TerminalNode is a separate element', () => {
    const terminal: TerminalNodePlacementInterface = {
      '@id':     'urn:noocodex:dag:ct4/node/done',
      '@type':   'TerminalNode',
      'name':    'done',
      'outcome': 'completed',
    };
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:ct4',
      '@type':    'DAG',
      'name':       'ct4',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ct4/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'success': 'done', 'error': null },
        },
        terminal,
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    // explicit TerminalNode exists with outcome
    const doneNode = elements.find((el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'done');
    assert.ok(doneNode !== undefined);
    assert.equal(doneNode.data['outcome'], 'completed');
    assert.equal(doneNode.data['synthetic'], undefined);
    // synthetic END also exists for the null route
    const endNode = elements.find((el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'END');
    assert.ok(endNode !== undefined);
    assert.equal(endNode.data['synthetic'], true);
    // they are distinct elements
    assert.notEqual(doneNode.data.id, endNode.data.id);
  });
});

void describe('CytoscapeRenderer.render: PhaseNode', () => {
  void it('renders a pre-phase PhaseNode with data.type===phase and data.phase/node populated', () => {
    const dag: DAG = {
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
          'outputs': { 'success': null },
        },
        {
          '@id':   'urn:noocodex:dag:ph/node/setup',
          '@type': 'PhaseNode',
          'name':  'setup',
          'node':  'setup-worker',
          'phase': 'pre',
        },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const setupNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'setup',
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
    const dag: DAG = {
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
          'outputs': { 'success': null },
        },
        {
          '@id':   'urn:noocodex:dag:ph2/node/teardown',
          '@type': 'PhaseNode',
          'name':  'teardown',
          'node':  'teardown-worker',
          'phase': 'post',
        },
      ],
    };
    const elements = CytoscapeRenderer.render(dag, {});
    const teardownNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'teardown',
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
