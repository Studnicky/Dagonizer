import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DAG } from '../../src/entities/index.js';
import { MermaidRenderer } from '../../src/viz/MermaidRenderer.js';

void describe('MermaidRenderer.render', () => {
  void it('renders a single-node DAG with terminal', () => {
    const dag: DAG = {
      'name': 'mini',
      'version': '1',
      'entrypoint': 'greet',
      'nodes': [{ 'type': 'single', 'name': 'greet', 'node': 'greet', 'outputs': { 'success': null } }],
    };
    const out = MermaidRenderer.render(dag);
    assert.match(out, /flowchart LR/u);
    assert.match(out, /greet\[greet\]/u);
    assert.match(out, /greet -->\|success\| END/u);
    assert.match(out, /END\(\[end\]\)/u);
  });

  void it('renders a fan-out node as a hexagon', () => {
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
    const out = MermaidRenderer.render(dag);
    assert.match(out, /fan\{\{fan\}\}/u);
    assert.match(out, /fan -->\|all-success\| END/u);
  });

  void it('wraps a parallel placement in a subgraph', () => {
    const dag: DAG = {
      'name': 'par',
      'version': '1',
      'entrypoint': 'group',
      'nodes': [{
        'type': 'parallel',
        'name': 'group',
        'nodes': ['a', 'b'],
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

  void it('renders sub-dag as stadium shape', () => {
    const dag: DAG = {
      'name': 'sub',
      'version': '1',
      'entrypoint': 'enrich',
      'nodes': [{
        'type': 'sub-dag',
        'name': 'enrich',
        'dag': 'inner',
        'outputs': { 'success': null, 'error': null },
      }],
    };
    const out = MermaidRenderer.render(dag);
    assert.match(out, /enrich\(\[enrich\]\)/u);
  });
});
