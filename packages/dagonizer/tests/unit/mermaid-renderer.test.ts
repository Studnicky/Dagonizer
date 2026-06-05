import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TerminalNodePlacementInterface } from '../../src/entities/dag/TerminalNode.js';
import type { DAG } from '../../src/entities/index.js';
import { DAG_CONTEXT } from '../../src/entities/index.js';
import { MermaidRenderer } from '../../src/viz/MermaidRenderer.js';

void describe('MermaidRenderer.render', () => {
  void it('renders a single-node DAG with terminal', () => {
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
    const out = MermaidRenderer.render(dag);
    assert.match(out, /flowchart LR/u);
    assert.match(out, /greet\[greet\]/u);
    assert.match(out, /greet -->\|success\| END/u);
    assert.match(out, /END\(\[end\]\)/u);
  });

  void it('renders a ScatterNode as a trapezoid', () => {
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fan',
      '@type':    'DAG',
      'name':       'fan',
      'version':    '1',
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
    const out = MermaidRenderer.render(dag);
    // ScatterNode renders as trapezoid: name[/label/]
    assert.match(out, /fan\[\/fan\/\]/u);
    assert.match(out, /fan -->\|all-success\| END/u);
  });

  void it('wraps a parallel placement in a subgraph', () => {
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
    const out = MermaidRenderer.render(dag);
    assert.match(out, /subgraph group/u);
    assert.match(out, /a\[a\]/u);
    assert.match(out, /b\[b\]/u);
    assert.match(out, /end/u);
  });

  void it('renders an EmbeddedDAGNode as a subroutine', () => {
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:deep',
      '@type':    'DAG',
      'name':       'deep',
      'version':    '1',
      'entrypoint': 'enrich',
      'nodes': [{
        '@id':  'urn:noocodex:dag:deep/node/enrich',
        '@type': 'EmbeddedDAGNode',
        'name':  'enrich',
        'dag':   'inner',
        'outputs': { 'success': 'next', 'error': 'next' },
      }],
    };
    const out = MermaidRenderer.render(dag);
    // EmbeddedDAGNode renders as a subroutine shape: name[[label]]
    assert.match(out, /enrich\[\[enrich\]\]/u);
  });
});

void describe('MermaidRenderer.render: PhaseNode', () => {
  void it('renders a pre-phase PhaseNode as a stadium shape and emits no outgoing edges', () => {
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
    const out = MermaidRenderer.render(dag);
    // stadium shape: name([label (phase)])
    assert.match(out, /setup\(\[setup \(pre\)\]\)/u);
    // PhaseNode emits no outgoing edges
    const edgeLines = out.split('\n').filter((line) => line.includes('-->') && line.includes('setup'));
    assert.equal(edgeLines.length, 0);
    // does not crash; returns valid flowchart
    assert.match(out, /flowchart LR/u);
  });

  void it('renders a post-phase PhaseNode with phase suffix in label', () => {
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
    const out = MermaidRenderer.render(dag);
    assert.match(out, /teardown\(\[teardown \(post\)\]\)/u);
  });
});

void describe('MermaidRenderer.render: TerminalNode', () => {
  void it('renders a completed TerminalNode as a double-circle with outcome suffix', () => {
    const terminal: TerminalNodePlacementInterface = {
      '@id':     'urn:noocodex:dag:t/node/done',
      '@type':   'TerminalNode',
      'name':    'done',
      'outcome': 'completed',
    };
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:t',
      '@type':    'DAG',
      'name':       't',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:t/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'success': 'done' },
        },
        terminal,
      ],
    };
    const out = MermaidRenderer.render(dag);
    // double-circle shape: (((label)))
    assert.match(out, /done\(\(\(.*\)\)\)/u);
    // outcome suffix present in label
    assert.match(out, /completed/u);
    // no synthetic END node (no null routes)
    assert.doesNotMatch(out, /END\(\[end\]\)/u);
  });

  void it('renders a failed TerminalNode as an asymmetric flag with outcome suffix', () => {
    const terminal: TerminalNodePlacementInterface = {
      '@id':     'urn:noocodex:dag:t2/node/abort',
      '@type':   'TerminalNode',
      'name':    'abort',
      'outcome': 'failed',
    };
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:t2',
      '@type':    'DAG',
      'name':       't2',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:t2/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'error': 'abort' },
        },
        terminal,
      ],
    };
    const out = MermaidRenderer.render(dag);
    // asymmetric flag shape: name>label]
    assert.match(out, /abort>/u);
    assert.match(out, /\(failed\)/u);
    // no synthetic END
    assert.doesNotMatch(out, /END\(\[end\]\)/u);
  });

  void it('TerminalNode emits no outbound edges', () => {
    const terminal: TerminalNodePlacementInterface = {
      '@id':     'urn:noocodex:dag:t3/node/done',
      '@type':   'TerminalNode',
      'name':    'done',
      'outcome': 'completed',
    };
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:t3',
      '@type':    'DAG',
      'name':       't3',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:t3/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'success': 'done' },
        },
        terminal,
      ],
    };
    const out = MermaidRenderer.render(dag);
    // only one edge exists: step --> done
    const edgeLines = out.split('\n').filter((line) => line.includes('-->'));
    assert.equal(edgeLines.length, 1);
    const firstEdge = edgeLines[0] ?? '';
    assert.match(firstEdge, /step -->\|success\| done/u);
  });

  void it('coexists with a null route: synthetic END and explicit TerminalNode both present', () => {
    const terminal: TerminalNodePlacementInterface = {
      '@id':     'urn:noocodex:dag:t4/node/done',
      '@type':   'TerminalNode',
      'name':    'done',
      'outcome': 'completed',
    };
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:t4',
      '@type':    'DAG',
      'name':       't4',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:t4/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'success': 'done', 'error': null },
        },
        terminal,
      ],
    };
    const out = MermaidRenderer.render(dag);
    // explicit TerminalNode is present as double-circle
    assert.match(out, /done\(\(\(.*\)\)\)/u);
    // synthetic END is also present (because of the null route on 'error')
    assert.match(out, /END\(\[end\]\)/u);
    // the null route goes to END, the named route goes to done
    assert.match(out, /step -->\|error\| END/u);
    assert.match(out, /step -->\|success\| done/u);
  });
});
