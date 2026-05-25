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
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fan',
      '@type':    'DAG',
      'name':       'fan',
      'version':    '1',
      'entrypoint': 'fan',
      'nodes': [{
        '@id':    'urn:noocodex:dag:fan/node/fan',
        '@type':  'FanOutNode',
        'name':   'fan',
        'node':   'worker',
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
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:par',
      '@type':    'DAG',
      'name':       'par',
      'version':    '1',
      'entrypoint': 'group',
      'nodes': [{
        '@id':     'urn:noocodex:dag:par/node/group',
        '@type':   'ParallelNode',
        'name':    'group',
        'nodes':   ['a', 'b'],
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
    const elements = CytoscapeRenderer.render(dag);
    const ids = elements
      .filter((entry) => entry.group === 'edges')
      .map((entry) => entry.data.id);
    assert.deepEqual([...ids].sort(), ['a__error__END', 'a__success__END']);
  });
});

void describe('CytoscapeRenderer.render — TerminalNode', () => {
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
    const elements = CytoscapeRenderer.render(dag);
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
    const elements = CytoscapeRenderer.render(dag);
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
    const elements = CytoscapeRenderer.render(dag);
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
    const elements = CytoscapeRenderer.render(dag);
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

void describe('CytoscapeRenderer.titleCase', () => {
  void it("converts 'extract-query' to 'Extract Query'", () => {
    assert.equal(CytoscapeRenderer.titleCase('extract-query'), 'Extract Query');
  });

  void it("converts 'book-search-fanout/openlibrary-scout' to 'Book Search Fanout / Openlibrary Scout'", () => {
    assert.equal(
      CytoscapeRenderer.titleCase('book-search-fanout/openlibrary-scout'),
      'Book Search Fanout / Openlibrary Scout',
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
