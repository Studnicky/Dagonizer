import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TerminalNodeType } from '../../src/entities/dag/TerminalNode.js';
import type { DAGType } from '../../src/entities/index.js';
import { DAG_CONTEXT } from '../../src/entities/index.js';
import { DAGONIZER_VOCAB, JsonLdRenderer } from '../../src/viz/JsonLdRenderer.js';

void describe('JsonLdRenderer.render', () => {
  void it('emits a stable @context + @graph for a single-node DAG', () => {
    const dag: DAGType = {
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
        'outputs': { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:mini/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const doc = JsonLdRenderer.render(dag);
    assert.equal(doc['@context']['dag'], DAGONIZER_VOCAB);
    assert.equal(doc['@graph'].length, 3);
    const root = doc['@graph'][0];
    assert.equal(root?.['@id'], 'urn:dagonizer:mini');
    assert.equal(root?.['@type'], 'dag:DAG');
    assert.equal(root?.['dag:entrypoint'], 'urn:dagonizer:mini#greet');
  });

  void it('renders ScatterNode (body.node) with source, itemKey, concurrency, gather config', () => {
    const dag: DAGType = {
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
        'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
      },
        { '@id': 'urn:noocodex:dag:scrape/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
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

  void it('routes serialize as IRI targets', () => {
    const dag: DAGType = {
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
        'outputs': { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:one/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const doc = JsonLdRenderer.render(dag);
    const placement = doc['@graph'].find((entry) => entry['@type'] === 'dag:SingleNode');
    const routes = (placement?.['dag:routes'] ?? []) as ReadonlyArray<{ 'dag:target': string }>;
    assert.equal(routes[0]?.['dag:target'], 'urn:dagonizer:one#end');
  });

  void it('renders EmbeddedDAGNode with cross-DAG IRI reference', () => {
    const dag: DAGType = {
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
      },
        { '@id': 'urn:noocodex:dag:parent/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const doc = JsonLdRenderer.render(dag);
    const sub = doc['@graph'].find((entry) => entry['@type'] === 'dag:EmbeddedDAGNode');
    assert.ok(sub !== undefined, 'dag:EmbeddedDAGNode entry must be present');
    // the embedded DAG serializes as a cross-DAG IRI reference
    assert.equal(sub?.['dag:dag'], 'urn:dagonizer:child');
    assert.deepEqual(sub?.['dag:stateMapping'], { 'input': { 'input': 'x' }, 'output': { 'b': 'y' } });
  });
});

void describe('JsonLdRenderer.render: containment', () => {
  void it('EmbeddedDAGNode with container emits dag:container in the @graph entry', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:jld-worker',
      '@type':    'DAG',
      'name':       'jld-worker',
      'version':    '1',
      'entrypoint': 'invoke',
      'nodes': [{
        '@id':       'urn:noocodex:dag:jld-worker/node/invoke',
        '@type':     'EmbeddedDAGNode',
        'name':      'invoke',
        'dag':       'cpu-dag',
        'container': 'cpu',
        'outputs':   { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:jld-worker/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const doc = JsonLdRenderer.render(dag);
    const entry = doc['@graph'].find((e) => e['@type'] === 'dag:EmbeddedDAGNode');
    assert.ok(entry !== undefined, 'dag:EmbeddedDAGNode entry must be present');
    assert.equal(entry['dag:container'], 'cpu', 'dag:container must reflect the container role');
  });

  void it('EmbeddedDAGNode without container omits dag:container from the @graph entry', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:jld-inprocess',
      '@type':    'DAG',
      'name':       'jld-inprocess',
      'version':    '1',
      'entrypoint': 'invoke',
      'nodes': [{
        '@id':     'urn:noocodex:dag:jld-inprocess/node/invoke',
        '@type':   'EmbeddedDAGNode',
        'name':    'invoke',
        'dag':     'child',
        'outputs': { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:jld-inprocess/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const doc = JsonLdRenderer.render(dag);
    const entry = doc['@graph'].find((e) => e['@type'] === 'dag:EmbeddedDAGNode');
    assert.ok(entry !== undefined);
    assert.equal(entry['dag:container'], undefined, 'in-process placement must not emit dag:container');
  });

  void it('ScatterNode with dag body and container emits dag:container', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:jld-scatter-worker',
      '@type':    'DAG',
      'name':       'jld-scatter-worker',
      'version':    '1',
      'entrypoint': 'fan',
      'nodes': [{
        '@id':       'urn:noocodex:dag:jld-scatter-worker/node/fan',
        '@type':     'ScatterNode',
        'name':      'fan',
        'body':      { 'dag': 'item-dag' },
        'source':    'items',
        'gather':    { 'strategy': 'discard' },
        'container': 'gpu',
        'outputs':   { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:jld-scatter-worker/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const doc = JsonLdRenderer.render(dag);
    const entry = doc['@graph'].find((e) => e['@type'] === 'dag:ScatterNode');
    assert.ok(entry !== undefined, 'dag:ScatterNode entry must be present');
    assert.equal(entry['dag:container'], 'gpu');
  });
});

void describe('JsonLdRenderer.render: TerminalNodeType', () => {
  void it('renders a completed TerminalNodeType with @type dag:TerminalNodeType and dag:outcome', () => {
    const terminalDone: TerminalNodeType = {
      '@id':     'urn:noocodex:dag:jt/node/done',
      '@type':   'TerminalNode',
      'name':    'done',
      'outcome': 'completed',
    };
    const dag: DAGType = {
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
        terminalDone,
      ],
    };
    const doc = JsonLdRenderer.render(dag);
    const entry = doc['@graph'].find((e) => e['@type'] === 'dag:TerminalNode');
    assert.ok(entry !== undefined, 'TerminalNodeType entry should be in @graph');
    assert.equal(entry['@id'], 'urn:dagonizer:jt#done');
    assert.equal(entry['dag:outcome'], 'completed');
    // no dag:routes field on terminal placements
    assert.equal(entry['dag:routes'], undefined);
  });

  void it('renders a failed TerminalNodeType with dag:outcome=failed', () => {
    const terminalAbort: TerminalNodeType = {
      '@id':     'urn:noocodex:dag:jt2/node/abort',
      '@type':   'TerminalNode',
      'name':    'abort',
      'outcome': 'failed',
    };
    const dag: DAGType = {
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
        terminalAbort,
      ],
    };
    const doc = JsonLdRenderer.render(dag);
    const entry = doc['@graph'].find((e) => e['@type'] === 'dag:TerminalNode');
    assert.ok(entry !== undefined);
    assert.equal(entry['dag:outcome'], 'failed');
    assert.equal(entry['dag:routes'], undefined);
  });

  void it('two TerminalNodes in the same DAG both appear in @graph with no dag:routes', () => {
    const dag: DAGType = {
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
          'outputs': { 'success': 'done', 'error': 'abort' },
        },
        { '@id': 'urn:noocodex:dag:jt3/node/done',  '@type': 'TerminalNode', 'name': 'done',  'outcome': 'completed' },
        { '@id': 'urn:noocodex:dag:jt3/node/abort', '@type': 'TerminalNode', 'name': 'abort', 'outcome': 'failed' },
      ],
    };
    const doc = JsonLdRenderer.render(dag);
    // Both TerminalNodeType entries appear in @graph
    const termEntries = doc['@graph'].filter((e) => e['@type'] === 'dag:TerminalNode');
    assert.equal(termEntries.length, 2, 'both TerminalNodes must be in @graph');
    // Neither emits dag:routes
    for (const entry of termEntries) {
      assert.equal(entry['dag:routes'], undefined);
    }
    // Outcomes are correct
    const doneEntry = termEntries.find((e) => e['@id'] === 'urn:dagonizer:jt3#done');
    const abortEntry = termEntries.find((e) => e['@id'] === 'urn:dagonizer:jt3#abort');
    assert.equal(doneEntry?.['dag:outcome'], 'completed');
    assert.equal(abortEntry?.['dag:outcome'], 'failed');
    // Routes from step point to IRI targets (not null)
    const stepEntry = doc['@graph'].find((e) => e['@type'] === 'dag:SingleNode');
    const routes = (stepEntry?.['dag:routes'] ?? []) as ReadonlyArray<{ 'dag:output': string; 'dag:target': string }>;
    const successRoute = routes.find((r) => r['dag:output'] === 'success');
    const errorRoute = routes.find((r) => r['dag:output'] === 'error');
    assert.equal(successRoute?.['dag:target'], 'urn:dagonizer:jt3#done');
    assert.equal(errorRoute?.['dag:target'], 'urn:dagonizer:jt3#abort');
  });
});
