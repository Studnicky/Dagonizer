import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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

  void it('renders fan-out with itemKey, concurrency, fanIn config', () => {
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:scrape',
      '@type':    'DAG',
      'name':       'scrape',
      'version':    '1',
      'entrypoint': 'fan',
      'nodes': [{
        '@id':         'urn:noocodex:dag:scrape/node/fan',
        '@type':       'FanOutNode',
        'name':        'fan',
        'node':        'worker',
        'source':      'items',
        'itemKey':     'item',
        'concurrency': 3,
        'fanIn': { 'strategy': 'append', 'target': 'collected' },
        'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
      }],
    };
    const doc = JsonLdRenderer.render(dag);
    const fan = doc['@graph'].find((entry) => entry['@type'] === 'dag:FanOutNode');
    assert.ok(fan !== undefined);
    assert.equal(fan?.['dag:itemKey'], 'item');
    assert.equal(fan?.['dag:concurrency'], 3);
    assert.deepEqual(fan?.['dag:fanIn'], { 'strategy': 'append', 'target': 'collected' });
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

  void it('renders parallel placements with combine + children', () => {
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
        'combine': 'all-success',
        'outputs': { 'success': null, 'error': null },
      }],
    };
    const doc = JsonLdRenderer.render(dag);
    const group = doc['@graph'].find((entry) => entry['@type'] === 'dag:ParallelNode');
    assert.equal(group?.['dag:combine'], 'all-success');
    assert.deepEqual(group?.['dag:children'], ['urn:dagonizer:par#a', 'urn:dagonizer:par#b']);
  });

  void it('renders deep-dag with cross-DAG reference', () => {
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:parent',
      '@type':    'DAG',
      'name':       'parent',
      'version':    '1',
      'entrypoint': 'invoke',
      'nodes': [{
        '@id':    'urn:noocodex:dag:parent/node/invoke',
        '@type':  'DeepDAGNode',
        'name':   'invoke',
        'dag':    'child',
        'stateMapping': { 'input': { 'a': 'x' }, 'output': { 'y': 'b' } },
        'outputs': { 'success': 'next', 'error': 'next' },
      }],
    };
    const doc = JsonLdRenderer.render(dag);
    const sub = doc['@graph'].find((entry) => entry['@type'] === 'dag:DeepDAGNode');
    assert.equal(sub?.['dag:dag'], 'urn:dagonizer:child');
    assert.deepEqual(sub?.['dag:stateMapping'], { 'input': { 'a': 'x' }, 'output': { 'y': 'b' } });
  });
});
