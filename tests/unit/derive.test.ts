import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import type { OperationContract } from '../../src/contracts/OperationContract.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { FlowDeriver } from '../../src/derive/FlowDeriver.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('FlowDeriver.derive', () => {
  void it('produces a linear DAG from a chain of contracts', () => {
    const contracts: OperationContract[] = [
      { 'name': 'a', 'hardRequired': ['input'], 'produces': ['x'], 'outputs': ['success'] },
      { 'name': 'b', 'hardRequired': ['x'],     'produces': ['y'], 'outputs': ['success'] },
      { 'name': 'c', 'hardRequired': ['y'],     'produces': ['z'], 'outputs': ['success'] },
    ];
    const dag = FlowDeriver.derive({
      'name': 'chain',
      'version': '1',
      'entrypoint': 'a',
      contracts,
    });
    assert.equal(dag.name, 'chain');
    assert.equal(dag.entrypoint, 'a');
    // JSON-LD canonical shape: @context, @id, @type at root
    assert.equal(dag['@type'], 'DAG');
    assert.ok(dag['@id'].startsWith('urn:noocodex:dag:'));
    assert.ok(dag['@context'] !== undefined);
    const names = dag.nodes.map((node) => node.name);
    assert.deepEqual(names, ['a', 'b', 'c']);
    const a = dag.nodes[0];
    if (a !== undefined && a['@type'] === 'SingleNode') {
      assert.equal(a.outputs['success'], 'b');
    } else {
      assert.fail('expected first node to be SingleNode');
    }
  });

  void it('groups same-depth contracts under a parallel placement', () => {
    const contracts: OperationContract[] = [
      { 'name': 'fan-a', 'hardRequired': ['input'],            'produces': ['a-data'],  'outputs': ['success'] },
      { 'name': 'fan-b', 'hardRequired': ['input'],            'produces': ['b-data'],  'outputs': ['success'] },
      { 'name': 'merge', 'hardRequired': ['a-data', 'b-data'], 'produces': ['merged'],  'outputs': ['success'] },
    ];
    const dag = FlowDeriver.derive({
      'name': 'fan',
      'version': '1',
      'entrypoint': 'fan-a',
      contracts,
    });
    const parallel = dag.nodes.find((node) => node['@type'] === 'ParallelNode');
    assert.ok(parallel !== undefined, 'parallel placement is emitted');
  });

  void it('emits fan-out placement when annotation is supplied', () => {
    const contracts: OperationContract[] = [
      { 'name': 'plan',  'hardRequired': ['input'],        'produces': ['tasks'],        'outputs': ['success'] },
      { 'name': 'scout', 'hardRequired': ['tasks'],        'produces': ['scoutResults'], 'outputs': ['success'] },
      { 'name': 'merge', 'hardRequired': ['scoutResults'], 'produces': ['merged'],       'outputs': ['success'] },
    ];
    const dag = FlowDeriver.derive({
      'name': 'scout-flow',
      'version': '1',
      'entrypoint': 'plan',
      contracts,
      'annotations': {
        'fanouts': {
          'scout': {
            'source': 'tasks',
            'itemKey': 'currentTask',
            'concurrency': 3,
            'fanInOperation': 'merge',
            'outcomes': ['all-success', 'partial', 'all-error', 'empty'],
          },
        },
      },
    });
    const fanOut = dag.nodes.find((node) => node['@type'] === 'FanOutNode');
    assert.ok(fanOut !== undefined);
    if (fanOut !== undefined && fanOut['@type'] === 'FanOutNode') {
      assert.equal(fanOut.fanIn.strategy, 'custom');
      assert.equal(fanOut.fanIn.customNode, 'merge');
      assert.equal(fanOut.concurrency, 3);
    }
  });

  void it('terminal annotation routes alternate outcomes to null', () => {
    const contracts: OperationContract[] = [
      { 'name': 'classify', 'hardRequired': ['input'],          'produces': ['classification'], 'outputs': ['success', 'off-topic'] },
      { 'name': 'plan',     'hardRequired': ['classification'], 'produces': ['plan'],           'outputs': ['success'] },
    ];
    const dag = FlowDeriver.derive({
      'name': 'gated',
      'version': '1',
      'entrypoint': 'classify',
      contracts,
      'annotations': {
        'terminals': {
          'classify': [
            { 'outcome': 'off-topic', 'target': null },
          ],
        },
      },
    });
    const classify = dag.nodes.find((node) => node.name === 'classify');
    assert.ok(classify !== undefined);
    if (classify !== undefined && classify['@type'] === 'SingleNode') {
      assert.equal(classify.outputs['off-topic'], null);
      assert.equal(classify.outputs['success'], 'plan');
    }
  });

  void it('auto-wires every declared output port to the next derived stage', () => {
    const contracts: OperationContract[] = [
      { 'name': 'fetch',     'hardRequired': ['url'],     'produces': ['raw'],    'outputs': ['success', 'cached', 'skipped', 'error', 'unknown'] },
      { 'name': 'normalize', 'hardRequired': ['raw'],     'produces': ['normal'], 'outputs': ['success'] },
    ];
    const dag = FlowDeriver.derive({
      'name': 'multi-port',
      'version': '1',
      'entrypoint': 'fetch',
      contracts,
    });
    const fetch = dag.nodes.find((node) => node.name === 'fetch');
    assert.ok(fetch !== undefined && fetch['@type'] === 'SingleNode');
    if (fetch !== undefined && fetch['@type'] === 'SingleNode') {
      // Every port routes to the next derived stage (normalize) by default.
      assert.equal(fetch.outputs['success'],  'normalize');
      assert.equal(fetch.outputs['cached'],   'normalize');
      assert.equal(fetch.outputs['skipped'],  'normalize');
      assert.equal(fetch.outputs['error'],    'normalize');
      assert.equal(fetch.outputs['unknown'],  'normalize');
    }
  });

  void it('terminal overrides individual ports without disturbing others', () => {
    const contracts: OperationContract[] = [
      { 'name': 'fetch',     'hardRequired': ['url'], 'produces': ['raw'],    'outputs': ['success', 'cached', 'error'] },
      { 'name': 'normalize', 'hardRequired': ['raw'], 'produces': ['normal'], 'outputs': ['success'] },
    ];
    const dag = FlowDeriver.derive({
      'name': 'partial-override',
      'version': '1',
      'entrypoint': 'fetch',
      contracts,
      'annotations': {
        'terminals': {
          'fetch': [{ 'outcome': 'error', 'target': null }],
        },
      },
    });
    const fetch = dag.nodes.find((node) => node.name === 'fetch');
    if (fetch !== undefined && fetch['@type'] === 'SingleNode') {
      assert.equal(fetch.outputs['success'], 'normalize');
      assert.equal(fetch.outputs['cached'],  'normalize');
      assert.equal(fetch.outputs['error'],   null);
    }
  });

  void it('throws when a terminal references a port not in the contract outputs', () => {
    const contracts: OperationContract[] = [
      { 'name': 'fetch', 'hardRequired': ['url'], 'produces': ['raw'], 'outputs': ['success', 'error'] },
    ];
    assert.throws(
      () => FlowDeriver.derive({
        'name': 'mismatched',
        'version': '1',
        'entrypoint': 'fetch',
        contracts,
        'annotations': {
          'terminals': {
            'fetch': [{ 'outcome': 'cached', 'target': null }],
          },
        },
      }),
      /port 'cached' which is not in the contract's outputs/,
    );
  });

  void it('produces a DAG that registers cleanly on a Dagonizer', () => {
    const contracts: OperationContract[] = [
      { 'name': 'first',  'hardRequired': ['input'], 'produces': ['x'], 'outputs': ['success'] },
      { 'name': 'second', 'hardRequired': ['x'],     'produces': ['y'], 'outputs': ['success'] },
    ];
    const dag = FlowDeriver.derive({
      'name': 'reg-test',
      'version': '1',
      'entrypoint': 'first',
      contracts,
    });

    const dispatcher = new Dagonizer<NodeStateBase>();
    const make = (name: string): NodeInterface<NodeStateBase, 'success'> => ({
      name,
      'outputs': ['success'],
      async execute() { return { 'output': 'success' }; },
    });
    dispatcher.registerNode(make('first'));
    dispatcher.registerNode(make('second'));

    dispatcher.registerDAG(dag);
    assert.equal(dispatcher.getDAG('reg-test'), dag);
  });
});
