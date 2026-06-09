import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TerminalNodePlacementInterface } from '../../src/entities/dag/TerminalNode.js';
import type { DAG } from '../../src/entities/index.js';
import { DAG_CONTEXT } from '../../src/entities/index.js';
import { DAGONIZER_VOCAB, JsonLdRenderer } from '../../src/viz/JsonLdRenderer.js';

void describe('JsonLdRenderer.render', () => {
  void it('emits a stable @context + @graph for a single-node DAG', () => {
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
    const doc = JsonLdRenderer.render(dag);
    assert.equal(doc['@context']['dag'], DAGONIZER_VOCAB);
    assert.equal(doc['@graph'].length, 2);
    const root = doc['@graph'][0];
    assert.equal(root?.['@id'], 'urn:dagonizer:mini');
    assert.equal(root?.['@type'], 'dag:DAG');
    assert.equal(root?.['dag:entrypoint'], 'urn:dagonizer:mini#greet');
  });

  void it('renders ScatterNode (body.node) with source, itemKey, concurrency, gather config', () => {
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:scrape',
      '@type':    'DAG',
      'name':       'scrape',
      'version':    '1',
      'entrypoint': 'fan',
      'nodes': [{
        '@id':         'urn:noocodex:dag:scrape/node/fan',
        '@type':       'ScatterNode',
        'name':        'fan',
        'body':        { 'node': 'worker' },
        'source':      'items',
        'itemKey':     'item',
        'concurrency': 3,
        'gather':      { 'strategy': 'append', 'target': 'collected' },
        'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
      }],
    };
    const doc = JsonLdRenderer.render(dag);
    const fan = doc['@graph'].find((entry) => entry['@type'] === 'dag:ScatterNode');
    assert.ok(fan !== undefined, 'dag:ScatterNode entry must be present');
    // body serializes as { dag:node: 'worker' } for a node-body scatter
    assert.deepEqual(fan?.['dag:body'], { 'dag:node': 'worker' });
    assert.equal(fan?.['dag:itemKey'], 'item');
    assert.equal(fan?.['dag:concurrency'], 3);
    assert.deepEqual(fan?.['dag:gather'], { 'strategy': 'append', 'target': 'collected' });
    assert.equal(fan?.['dag:source'], 'items');
  });

  void it('routes targeting null serialize as null targets', () => {
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:one',
      '@type':    'DAG',
      'name':       'one',
      'version':    '1',
      'entrypoint': 'a',
      'nodes': [{
        '@id':    'urn:noocodex:dag:one/node/a',
        '@type':  'SingleNode',
        'name':   'a',
        'node':   'n',
        'outputs': { 'success': null },
      }],
    };
    const doc = JsonLdRenderer.render(dag);
    const placement = doc['@graph'].find((entry) => entry['@type'] === 'dag:SingleNode');
    const routes = (placement?.['dag:routes'] ?? []) as ReadonlyArray<{ 'dag:target': string | null }>;
    assert.equal(routes[0]?.['dag:target'], null);
  });

  void it('renders EmbeddedDAGNode with cross-DAG IRI reference', () => {
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:parent',
      '@type':    'DAG',
      'name':       'parent',
      'version':    '1',
      'entrypoint': 'invoke',
      'nodes': [{
        '@id':          'urn:noocodex:dag:parent/node/invoke',
        '@type':        'EmbeddedDAGNode',
        'name':         'invoke',
        'dag':          'child',
        'stateMapping': { 'input': { 'input': 'x' }, 'output': { 'b': 'y' } },
        'outputs': { 'success': 'next', 'error': 'next' },
      }],
    };
    const doc = JsonLdRenderer.render(dag);
    const sub = doc['@graph'].find((entry) => entry['@type'] === 'dag:EmbeddedDAGNode');
    assert.ok(sub !== undefined, 'dag:EmbeddedDAGNode entry must be present');
    // the embedded DAG serializes as a cross-DAG IRI reference
    assert.equal(sub?.['dag:dag'], 'urn:dagonizer:child');
    assert.deepEqual(sub?.['dag:stateMapping'], { 'input': { 'input': 'x' }, 'output': { 'b': 'y' } });
  });
});

void describe('JsonLdRenderer.render: TerminalNode', () => {
  void it('renders a completed TerminalNode with @type dag:TerminalNode and dag:outcome', () => {
    const terminal: TerminalNodePlacementInterface = {
      '@id':     'urn:noocodex:dag:jt/node/done',
      '@type':   'TerminalNode',
      'name':    'done',
      'outcome': 'completed',
    };
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:jt',
      '@type':    'DAG',
      'name':       'jt',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:jt/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'success': 'done' },
        },
        terminal,
      ],
    };
    const doc = JsonLdRenderer.render(dag);
    const entry = doc['@graph'].find((e) => e['@type'] === 'dag:TerminalNode');
    assert.ok(entry !== undefined, 'TerminalNode entry should be in @graph');
    assert.equal(entry['@id'], 'urn:dagonizer:jt#done');
    assert.equal(entry['dag:outcome'], 'completed');
    // no dag:routes field on terminal placements
    assert.equal(entry['dag:routes'], undefined);
  });

  void it('renders a failed TerminalNode with dag:outcome=failed', () => {
    const terminal: TerminalNodePlacementInterface = {
      '@id':     'urn:noocodex:dag:jt2/node/abort',
      '@type':   'TerminalNode',
      'name':    'abort',
      'outcome': 'failed',
    };
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:jt2',
      '@type':    'DAG',
      'name':       'jt2',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:jt2/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'error': 'abort' },
        },
        terminal,
      ],
    };
    const doc = JsonLdRenderer.render(dag);
    const entry = doc['@graph'].find((e) => e['@type'] === 'dag:TerminalNode');
    assert.ok(entry !== undefined);
    assert.equal(entry['dag:outcome'], 'failed');
    assert.equal(entry['dag:routes'], undefined);
  });

  void it('coexists: null route emits dag:routes with null target; explicit TerminalNode emits no dag:routes', () => {
    const terminal: TerminalNodePlacementInterface = {
      '@id':     'urn:noocodex:dag:jt3/node/done',
      '@type':   'TerminalNode',
      'name':    'done',
      'outcome': 'completed',
    };
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:jt3',
      '@type':    'DAG',
      'name':       'jt3',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:jt3/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'success': 'done', 'error': null },
        },
        terminal,
      ],
    };
    const doc = JsonLdRenderer.render(dag);
    // SingleNode has dag:routes with the null target
    const stepEntry = doc['@graph'].find((e) => e['@type'] === 'dag:SingleNode');
    const routes = (stepEntry?.['dag:routes'] ?? []) as ReadonlyArray<{ 'dag:output': string; 'dag:target': string | null }>;
    const errorRoute = routes.find((r) => r['dag:output'] === 'error');
    assert.equal(errorRoute?.['dag:target'], null);
    // TerminalNode has no dag:routes
    const termEntry = doc['@graph'].find((e) => e['@type'] === 'dag:TerminalNode');
    assert.ok(termEntry !== undefined);
    assert.equal(termEntry['dag:routes'], undefined);
    assert.equal(termEntry['dag:outcome'], 'completed');
  });
});
