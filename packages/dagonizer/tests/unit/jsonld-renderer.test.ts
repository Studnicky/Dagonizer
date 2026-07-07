import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TerminalNodeType } from '../../src/entities/dag/TerminalNode.js';
import type { DAGType } from '../../src/entities/index.js';
import { DAG_CONTEXT } from '../../src/entities/index.js';
import { DAGONIZER_VOCAB, JsonLdRenderer } from '../../src/viz/JsonLdRenderer.js';

// ── Local type-narrowing helpers ─────────────────────────────────────────────

class RouteEntry {
  private constructor() {}

  /** Narrows an `unknown` value to a single-target route entry. */
  static isTarget(v: unknown): v is { 'dag:target': string } {
    if (typeof v !== 'object' || v === null) return false;
    return typeof Reflect.get(v, 'dag:target') === 'string';
  }

  /** Narrows an `unknown` value to a labelled route entry with output and target. */
  static isLabelled(v: unknown): v is { 'dag:output': string; 'dag:target': string } {
    if (!RouteEntry.isTarget(v)) return false;
    return typeof Reflect.get(v, 'dag:output') === 'string';
  }
}

class JsonLdDagReferenceEntry {
  private constructor() {}

  static candidates(value: unknown): readonly string[] {
    if (typeof value !== 'object' || value === null) return [];
    const rawCandidates = Reflect.get(value, 'dag:candidateDag');
    return Array.isArray(rawCandidates)
      ? rawCandidates.filter((candidate): candidate is string => typeof candidate === 'string')
      : [];
  }
}

void describe('JsonLdRenderer.render', () => {
  void it('emits a stable @context + @graph for a single-node DAG', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:mini',
      '@type':    'DAG',
      'name':       'mini',
      'version':    '1',
      'entrypoints': { 'main': 'greet' },
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
    assert.deepEqual(root?.['dag:entrypoints'], { 'main': 'urn:dagonizer:mini#greet' });
  });

  void it('renders ScatterNode (body.node) with source, itemKey, execution, gather config', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:scrape',
      '@type':    'DAG',
      'name':       'scrape',
      'version':    '1',
      'entrypoints': { 'main': 'fan' },
      'nodes': [{
        '@id':         'urn:noocodex:dag:scrape/node/fan',
        '@type':       'ScatterNode',
        'name':        'fan',
        'body':        { 'node': 'worker' },
        'source':      'items',
        'itemKey':     'item',
        'execution': { 'mode': 'item', 'concurrency': 3 },
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
    assert.deepEqual(fan?.['dag:execution'], { 'mode': 'item', 'concurrency': 3 });
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
      'entrypoints': { 'main': 'a' },
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
    const rawRoutes = placement?.['dag:routes'];
    assert.ok(Array.isArray(rawRoutes) && rawRoutes.length > 0, 'dag:routes must be a non-empty array');
    const routes = rawRoutes.filter(RouteEntry.isTarget);
    assert.equal(routes[0]?.['dag:target'], 'urn:dagonizer:one#end');
  });

  void it('renders EmbeddedDAGNode with cross-DAG IRI reference', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:parent',
      '@type':    'DAG',
      'name':       'parent',
      'version':    '1',
      'entrypoints': { 'main': 'invoke' },
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

  void it('renders dynamic DagReference candidates as graph-visible DAG IRIs', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:dynamic-parent',
      '@type':    'DAG',
      'name':       'dynamic-parent',
      'version':    '1',
      'entrypoints': { 'main': 'invoke' },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:dynamic-parent/node/invoke',
          '@type':  'EmbeddedDAGNode',
          'name':   'invoke',
          'dag': {
            '@type': 'DagReference',
            'from': 'state',
            'path': 'selectedDag',
            'candidates': ['child-a', 'child-b'],
          },
          'outputs': { 'success': 'fan', 'error': 'failed' },
        },
        {
          '@id':    'urn:noocodex:dag:dynamic-parent/node/fan',
          '@type':  'ScatterNode',
          'name':   'fan',
          'source': 'items',
          'gather': { 'strategy': 'discard' },
          'body': {
            'dag': {
              '@type': 'DagReference',
              'from': 'item',
              'path': 'dagName',
              'candidates': ['child-c'],
            },
          },
          'outputs': { 'all-success': 'done', 'partial': 'done', 'all-error': 'failed', 'empty': 'done' },
        },
        { '@id': 'urn:noocodex:dag:dynamic-parent/node/done', '@type': 'TerminalNode', 'name': 'done', 'outcome': 'completed' },
        { '@id': 'urn:noocodex:dag:dynamic-parent/node/failed', '@type': 'TerminalNode', 'name': 'failed', 'outcome': 'failed' },
      ],
    };

    const doc = JsonLdRenderer.render(dag);
    const embedded = doc['@graph'].find((entry) => entry['@id'] === 'urn:dagonizer:dynamic-parent#invoke');
    const scatter = doc['@graph'].find((entry) => entry['@id'] === 'urn:dagonizer:dynamic-parent#fan');
    const scatterBody = scatter?.['dag:body'];

    assert.deepEqual(
      JsonLdDagReferenceEntry.candidates(embedded?.['dag:dag']),
      ['urn:dagonizer:child-a', 'urn:dagonizer:child-b'],
    );
    assert.deepEqual(
      typeof scatterBody === 'object' && scatterBody !== null
        ? JsonLdDagReferenceEntry.candidates(Reflect.get(scatterBody, 'dag:dag'))
        : [],
      ['urn:dagonizer:child-c'],
    );
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
      'entrypoints': { 'main': 'invoke' },
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
      'entrypoints': { 'main': 'invoke' },
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
      'entrypoints': { 'main': 'fan' },
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
      'entrypoints': { 'main': 'step' },
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
      'entrypoints': { 'main': 'step' },
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
      'entrypoints': { 'main': 'step' },
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
    const rawStepRoutes = stepEntry?.['dag:routes'];
    assert.ok(Array.isArray(rawStepRoutes), 'step dag:routes must be an array');
    const routes = rawStepRoutes.filter(RouteEntry.isLabelled);
    const successRoute = routes.find((r) => r['dag:output'] === 'success');
    const errorRoute = routes.find((r) => r['dag:output'] === 'error');
    assert.equal(successRoute?.['dag:target'], 'urn:dagonizer:jt3#done');
    assert.equal(errorRoute?.['dag:target'], 'urn:dagonizer:jt3#abort');
  });
});

void describe('JsonLdRenderer.renderReachable', () => {
  void it('renders the entry DAG and reachable embedded DAGs in one graph', () => {
    const childDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:child',
      '@type':    'DAG',
      'name':     'child',
      'version':  '1',
      'entrypoints': { 'main': 'child-end' },
      'nodes': [
        {
          '@id':     'urn:noocodex:dag:child/node/child-end',
          '@type':   'TerminalNode',
          'name':    'child-end',
          'outcome': 'completed',
        },
      ],
    };
    const parentDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:parent',
      '@type':    'DAG',
      'name':     'parent',
      'version':  '1',
      'entrypoints': { 'main': 'invoke' },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:parent/node/invoke',
          '@type':  'EmbeddedDAGNode',
          'name':   'invoke',
          'dag':    'child',
          'outputs': { 'success': 'done', 'error': 'done' },
        },
        {
          '@id':     'urn:noocodex:dag:parent/node/done',
          '@type':   'TerminalNode',
          'name':    'done',
          'outcome': 'completed',
        },
      ],
    };

    const doc = JsonLdRenderer.renderReachable(parentDag, new Map([['child', childDag]]));
    const ids = doc['@graph'].map((entry) => entry['@id']);

    assert.ok(ids.includes('urn:dagonizer:parent'));
    assert.ok(ids.includes('urn:dagonizer:child'));
    assert.ok(ids.includes('urn:dagonizer:parent#invoke'));
    assert.ok(ids.includes('urn:dagonizer:child#child-end'));
  });

  void it('renders reachable dynamic candidate DAGs from every entrypoint root', () => {
    const leftDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:left-child',
      '@type':    'DAG',
      'name':     'left-child',
      'version':  '1',
      'entrypoints': { 'main': 'done' },
      'nodes': [{ '@id': 'urn:noocodex:dag:left-child/node/done', '@type': 'TerminalNode', 'name': 'done', 'outcome': 'completed' }],
    };
    const rightDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:right-child',
      '@type':    'DAG',
      'name':     'right-child',
      'version':  '1',
      'entrypoints': { 'main': 'done' },
      'nodes': [{ '@id': 'urn:noocodex:dag:right-child/node/done', '@type': 'TerminalNode', 'name': 'done', 'outcome': 'completed' }],
    };
    const deadDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:dead-child',
      '@type':    'DAG',
      'name':     'dead-child',
      'version':  '1',
      'entrypoints': { 'main': 'done' },
      'nodes': [{ '@id': 'urn:noocodex:dag:dead-child/node/done', '@type': 'TerminalNode', 'name': 'done', 'outcome': 'completed' }],
    };
    const parentDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:multi-root-parent',
      '@type':    'DAG',
      'name':     'multi-root-parent',
      'version':  '1',
      'entrypoints': { 'left': 'left-root', 'right': 'right-root' },
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:multi-root-parent/node/left-root',
          '@type': 'EmbeddedDAGNode',
          'name': 'left-root',
          'dag': 'left-child',
          'outputs': { 'success': 'left-done', 'error': 'failed' },
        },
        {
          '@id': 'urn:noocodex:dag:multi-root-parent/node/right-root',
          '@type': 'EmbeddedDAGNode',
          'name': 'right-root',
          'dag': {
            '@type': 'DagReference',
            'from': 'state',
            'path': 'selectedDag',
            'candidates': ['right-child'],
          },
          'outputs': { 'success': 'right-done', 'error': 'failed' },
        },
        {
          '@id': 'urn:noocodex:dag:multi-root-parent/node/dead-root',
          '@type': 'EmbeddedDAGNode',
          'name': 'dead-root',
          'dag': 'dead-child',
          'outputs': { 'success': 'left-done', 'error': 'failed' },
        },
        { '@id': 'urn:noocodex:dag:multi-root-parent/node/left-done', '@type': 'TerminalNode', 'name': 'left-done', 'outcome': 'completed' },
        { '@id': 'urn:noocodex:dag:multi-root-parent/node/right-done', '@type': 'TerminalNode', 'name': 'right-done', 'outcome': 'completed' },
        { '@id': 'urn:noocodex:dag:multi-root-parent/node/failed', '@type': 'TerminalNode', 'name': 'failed', 'outcome': 'failed' },
      ],
    };

    const doc = JsonLdRenderer.renderReachable(parentDag, new Map([
      ['left-child', leftDag],
      ['right-child', rightDag],
      ['dead-child', deadDag],
    ]));
    const ids = doc['@graph'].map((entry) => entry['@id']);

    assert.ok(ids.includes('urn:dagonizer:left-child'));
    assert.ok(ids.includes('urn:dagonizer:right-child'));
    assert.equal(ids.includes('urn:dagonizer:dead-child'), false);
  });
});
