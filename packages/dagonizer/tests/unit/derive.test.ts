import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import type { OperationContract } from '../../src/contracts/OperationContract.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAGDeriver } from '../../src/derive/DAGDeriver.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('DAGDeriver.derive', () => {
  void it('produces a linear DAG from a chain of contracts', () => {
    const contracts: OperationContract[] = [
      { 'name': 'a', 'hardRequired': ['input'], 'produces': ['x'], 'outputs': ['success'] },
      { 'name': 'b', 'hardRequired': ['x'],     'produces': ['y'], 'outputs': ['success'] },
      { 'name': 'c', 'hardRequired': ['y'],     'produces': ['z'], 'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
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
    const dag = DAGDeriver.derive({
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
    const dag = DAGDeriver.derive({
      'name': 'scout-flow',
      'version': '1',
      'entrypoint': 'plan',
      contracts,
      'annotations': {
        'fanouts': {
          'scout': {
            'source':         'tasks',
            'itemKey':        'currentTask',
            'node':           'scout',
            'concurrency':    3,
            'strategy':       'custom',
            'fanInOperation': 'merge',
            'outcomes':       ['all-success', 'partial', 'all-error', 'empty'],
          },
        },
      },
    });
    const fanOut = dag.nodes.find((node) => node['@type'] === 'FanOutNode');
    assert.ok(fanOut !== undefined);
    if (fanOut !== undefined && fanOut['@type'] === 'FanOutNode') {
      assert.equal(fanOut.fanIn.strategy, 'custom');
      if (fanOut.fanIn.strategy === 'custom') {
        assert.equal(fanOut.fanIn.customNode, 'merge');
      }
      assert.equal(fanOut.concurrency, 3);
    }
  });

  void it('renders fan-out with partition strategy', () => {
    const contracts: OperationContract[] = [
      { 'name': 'plan',  'hardRequired': ['input'],  'produces': ['tasks'],   'outputs': ['success'] },
      { 'name': 'scout', 'hardRequired': ['tasks'],  'produces': ['results'], 'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'partition-flow',
      'version': '1',
      'entrypoint': 'plan',
      contracts,
      'annotations': {
        'fanouts': {
          'scout': {
            'source':   'tasks',
            'itemKey':  'currentTask',
            'node':     'scout',
            'strategy': 'partition',
            'partitions': { 'success': 'state.passed', 'error': 'state.failed' },
            'outcomes': ['success', 'error', 'empty'],
          },
        },
      },
    });
    const fanOut = dag.nodes.find((node) => node['@type'] === 'FanOutNode');
    assert.ok(fanOut !== undefined && fanOut['@type'] === 'FanOutNode');
    if (fanOut !== undefined && fanOut['@type'] === 'FanOutNode') {
      assert.equal(fanOut.fanIn.strategy, 'partition');
      if (fanOut.fanIn.strategy === 'partition') {
        assert.deepEqual(fanOut.fanIn.partitions, { 'success': 'state.passed', 'error': 'state.failed' });
      }
    }
  });

  void it('renders fan-out with append strategy', () => {
    const contracts: OperationContract[] = [
      { 'name': 'plan',  'hardRequired': ['input'], 'produces': ['tasks'],   'outputs': ['success'] },
      { 'name': 'scout', 'hardRequired': ['tasks'], 'produces': ['results'], 'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'append-flow',
      'version': '1',
      'entrypoint': 'plan',
      contracts,
      'annotations': {
        'fanouts': {
          'scout': {
            'source':   'tasks',
            'itemKey':  'currentTask',
            'node':     'scout',
            'strategy': 'append',
            'target':   'state.allResults',
            'outcomes': ['success', 'error'],
          },
        },
      },
    });
    const fanOut = dag.nodes.find((node) => node['@type'] === 'FanOutNode');
    if (fanOut !== undefined && fanOut['@type'] === 'FanOutNode') {
      assert.equal(fanOut.fanIn.strategy, 'append');
      if (fanOut.fanIn.strategy === 'append') {
        assert.equal(fanOut.fanIn.target, 'state.allResults');
      }
    }
  });

  void it('throws when partitions map references an outcome not in outcomes', () => {
    const contracts: OperationContract[] = [
      { 'name': 'plan',  'hardRequired': ['input'], 'produces': ['tasks'],   'outputs': ['success'] },
      { 'name': 'scout', 'hardRequired': ['tasks'], 'produces': ['results'], 'outputs': ['success'] },
    ];
    assert.throws(
      () => DAGDeriver.derive({
        'name': 'mismatched-partition',
        'version': '1',
        'entrypoint': 'plan',
        contracts,
        'annotations': {
          'fanouts': {
            'scout': {
              'source':   'tasks',
              'itemKey':  'currentTask',
              'node':     'scout',
              'strategy': 'partition',
              'partitions': { 'unknown-outcome': 'state.somewhere' },
              'outcomes': ['success', 'error'],
            },
          },
        },
      }),
      /partitions\['unknown-outcome'\] is not listed in outcomes/,
    );
  });

  void it('terminal annotation routes alternate outcomes to null', () => {
    const contracts: OperationContract[] = [
      { 'name': 'classify', 'hardRequired': ['input'],          'produces': ['classification'], 'outputs': ['success', 'off-topic'] },
      { 'name': 'plan',     'hardRequired': ['classification'], 'produces': ['plan'],           'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
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
    const dag = DAGDeriver.derive({
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
    const dag = DAGDeriver.derive({
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
      () => DAGDeriver.derive({
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

  void it('subDAGs annotation renders a DeepDAGNode placement', () => {
    const contracts: OperationContract[] = [
      { 'name': 'prepare', 'hardRequired': ['input'],   'produces': ['payload'], 'outputs': ['success'] },
      { 'name': 'invoke',  'hardRequired': ['payload'], 'produces': ['result'],  'outputs': ['success', 'error'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'subdag-render',
      'version': '1',
      'entrypoint': 'prepare',
      contracts,
      'annotations': {
        'subDAGs': {
          'invoke': {
            'dag':    'plugin:parse',
            'outputs': ['success', 'error'],
          },
        },
      },
    });
    const invoke = dag.nodes.find((node) => node.name === 'invoke');
    assert.ok(invoke !== undefined, 'invoke placement is emitted');
    if (invoke !== undefined && invoke['@type'] === 'DeepDAGNode') {
      assert.equal(invoke.dag, 'plugin:parse');
      assert.equal(invoke.outputs['success'], null);  // no successor
      assert.equal(invoke.outputs['error'],   null);
    } else {
      assert.fail('expected invoke placement to be DeepDAGNode');
    }
  });

  void it('subDAGs forwards stateMapping verbatim to the rendered placement', () => {
    const contracts: OperationContract[] = [
      { 'name': 'invoke', 'hardRequired': ['input'], 'produces': ['result'], 'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'subdag-mapping',
      'version': '1',
      'entrypoint': 'invoke',
      contracts,
      'annotations': {
        'subDAGs': {
          'invoke': {
            'dag':     'child-dag',
            'outputs': ['success'],
            'stateMapping': {
              'input':  { 'childInput':  'parent.input' },
              'output': { 'parent.result': 'childResult' },
            },
          },
        },
      },
    });
    const invoke = dag.nodes.find((node) => node.name === 'invoke');
    assert.ok(invoke !== undefined && invoke['@type'] === 'DeepDAGNode');
    if (invoke !== undefined && invoke['@type'] === 'DeepDAGNode') {
      assert.deepEqual(invoke.stateMapping, {
        'input':  { 'childInput':  'parent.input' },
        'output': { 'parent.result': 'childResult' },
      });
    }
  });

  void it('subDAGs auto-wires every declared port and honors terminal overrides', () => {
    const contracts: OperationContract[] = [
      { 'name': 'invoke', 'hardRequired': ['input'],  'produces': ['result'], 'outputs': ['success', 'cached', 'error'] },
      { 'name': 'finish', 'hardRequired': ['result'], 'produces': ['done'],   'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'subdag-routing',
      'version': '1',
      'entrypoint': 'invoke',
      contracts,
      'annotations': {
        'subDAGs': {
          'invoke': {
            'dag':     'child-dag',
            'outputs': ['success', 'cached', 'error'],
          },
        },
        'terminals': {
          'invoke': [{ 'outcome': 'error', 'target': null }],
        },
      },
    });
    const invoke = dag.nodes.find((node) => node.name === 'invoke');
    if (invoke !== undefined && invoke['@type'] === 'DeepDAGNode') {
      assert.equal(invoke.outputs['success'], 'finish');  // auto-wired to next stage
      assert.equal(invoke.outputs['cached'],  'finish');  // auto-wired to next stage
      assert.equal(invoke.outputs['error'],   null);      // terminal override
    } else {
      assert.fail('expected invoke placement to be DeepDAGNode');
    }
  });

  void it('throws when a terminal references a port not in the subDAG outputs', () => {
    const contracts: OperationContract[] = [
      { 'name': 'invoke', 'hardRequired': ['input'], 'produces': ['result'], 'outputs': ['success', 'error'] },
    ];
    assert.throws(
      () => DAGDeriver.derive({
        'name': 'subdag-mismatch',
        'version': '1',
        'entrypoint': 'invoke',
        contracts,
        'annotations': {
          'subDAGs': {
            'invoke': {
              'dag':     'child-dag',
              'outputs': ['success', 'error'],
            },
          },
          'terminals': {
            'invoke': [{ 'outcome': 'cached', 'target': null }],
          },
        },
      }),
      /port 'cached' which is not in the subDAG 'child-dag' declared outputs/,
    );
  });

  void it('parallels annotation renders explicit ParallelNode with chosen combine strategy', () => {
    const contracts: OperationContract[] = [
      { 'name': 'a', 'hardRequired': ['input'], 'produces': ['x'], 'outputs': ['success'] },
      { 'name': 'b', 'hardRequired': ['input'], 'produces': ['y'], 'outputs': ['success'] },
      { 'name': 'c', 'hardRequired': ['x', 'y'], 'produces': ['z'], 'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'explicit-parallel',
      'version': '1',
      'entrypoint': 'a',
      contracts,
      'annotations': {
        'parallels': {
          'fan-stage': {
            'members': ['a', 'b'],
            'combine': 'all-success',
          },
        },
      },
    });
    const explicit = dag.nodes.find((node) => node.name === 'fan-stage');
    assert.ok(explicit !== undefined && explicit['@type'] === 'ParallelNode');
    if (explicit !== undefined && explicit['@type'] === 'ParallelNode') {
      assert.deepEqual([...explicit.nodes], ['a', 'b']);
      assert.equal(explicit.combine, 'all-success');
    }
    // Auto-grouped placement with the auto name `depth_0` should NOT exist
    // since both depth-0 members are claimed by the explicit group.
    const auto = dag.nodes.find((node) => node.name === 'depth_0');
    assert.equal(auto, undefined, 'no auto-grouped depth_0 when members are in explicit parallels');
  });

  void it('throws when a parallels group is empty', () => {
    const contracts: OperationContract[] = [
      { 'name': 'a', 'hardRequired': ['input'], 'produces': ['x'], 'outputs': ['success'] },
    ];
    assert.throws(
      () => DAGDeriver.derive({
        'name': 'empty-parallel',
        'version': '1',
        'entrypoint': 'a',
        contracts,
        'annotations': { 'parallels': { 'g': { 'members': [], 'combine': 'collect' } } },
      }),
      /parallels\['g'\] declares zero members/,
    );
  });

  void it('throws when an operation appears in multiple parallels', () => {
    const contracts: OperationContract[] = [
      { 'name': 'a', 'hardRequired': ['input'], 'produces': ['x'], 'outputs': ['success'] },
      { 'name': 'b', 'hardRequired': ['input'], 'produces': ['y'], 'outputs': ['success'] },
    ];
    assert.throws(
      () => DAGDeriver.derive({
        'name': 'overlapping',
        'version': '1',
        'entrypoint': 'a',
        contracts,
        'annotations': {
          'parallels': {
            'group-1': { 'members': ['a', 'b'], 'combine': 'collect' },
            'group-2': { 'members': ['b'],      'combine': 'collect' },
          },
        },
      }),
      /appears in multiple parallels/,
    );
  });

  void it('throws when an operation appears in both fanouts and subDAGs', () => {
    const contracts: OperationContract[] = [
      { 'name': 'plan',  'hardRequired': ['input'], 'produces': ['tasks'],       'outputs': ['success'] },
      { 'name': 'scout', 'hardRequired': ['tasks'], 'produces': ['scoutResult'], 'outputs': ['success'] },
      { 'name': 'merge', 'hardRequired': ['scoutResult'], 'produces': ['merged'], 'outputs': ['success'] },
    ];
    assert.throws(
      () => DAGDeriver.derive({
        'name': 'ambiguous',
        'version': '1',
        'entrypoint': 'plan',
        contracts,
        'annotations': {
          'fanouts': {
            'scout': {
              'source':         'tasks',
              'itemKey':        'currentTask',
              'node':           'scout',
              'strategy':       'custom',
              'fanInOperation': 'merge',
              'outcomes':       ['all-success'],
            },
          },
          'subDAGs': {
            'scout': {
              'dag':     'scout-dag',
              'outputs': ['success'],
            },
          },
        },
      }),
      /appears in both annotations.fanouts and annotations.subDAGs/,
    );
  });

  void it('end-to-end: dispatcher executes a DeepDAGNode emitted by DAGDeriver', async () => {
    // Parent flow: prepare → invoke-child (deep-DAG) → finalize.
    // Deep-DAG placements cannot terminate the run — the parent DAG
    // owns END — so the deep-DAG step must be followed by another
    // parent placement that routes to null.
    const contracts: OperationContract[] = [
      { 'name': 'prepare',      'hardRequired': ['input'],        'produces': ['intermediate'], 'outputs': ['success'] },
      { 'name': 'invoke-child', 'hardRequired': ['intermediate'], 'produces': ['childResult'],  'outputs': ['success'] },
      { 'name': 'finalize',     'hardRequired': ['childResult'],  'produces': ['final'],        'outputs': ['success'] },
    ];
    const parentDAG = DAGDeriver.derive({
      'name': 'parent',
      'version': '1',
      'entrypoint': 'prepare',
      contracts,
      'annotations': {
        'subDAGs': {
          'invoke-child': {
            'dag':     'child',
            'outputs': ['success'],
          },
        },
      },
    });
    const childDAG = DAGDeriver.derive({
      'name': 'child',
      'version': '1',
      'entrypoint': 'child-step',
      'contracts': [
        { 'name': 'child-step', 'hardRequired': ['input'], 'produces': ['final'], 'outputs': ['success'] },
      ],
    });

    const dispatcher = new Dagonizer<NodeStateBase>();
    const make = (name: string): NodeInterface<NodeStateBase, 'success'> => ({
      name,
      'outputs': ['success'],
      async execute() { return { 'output': 'success' }; },
    });
    dispatcher.registerNode(make('prepare'));
    dispatcher.registerNode(make('invoke-child'));
    dispatcher.registerNode(make('finalize'));
    dispatcher.registerNode(make('child-step'));
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    const result = await dispatcher.execute('parent', new NodeStateBase());
    assert.equal(result.state.lifecycle.kind, 'completed');
    assert.ok(result.executedNodes.includes('invoke-child'));
    assert.ok(result.executedNodes.includes('finalize'));
  });

  void it('produces a DAG that registers cleanly on a Dagonizer', () => {
    const contracts: OperationContract[] = [
      { 'name': 'first',  'hardRequired': ['input'], 'produces': ['x'], 'outputs': ['success'] },
      { 'name': 'second', 'hardRequired': ['x'],     'produces': ['y'], 'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
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

void describe('DAGDeriver — terminals with emit variant', () => {
  // Helper: make a node that always returns its first output.
  const make = <TOut extends string>(
    name: string,
    outputs: readonly [TOut, ...TOut[]],
  ): NodeInterface<NodeStateBase, TOut> => ({
    name,
    outputs,
    async execute() { return { 'output': outputs[0] }; },
  });

  // Helper: make a node that always returns a specific output.
  const makeWith = <TOut extends string>(
    name: string,
    outputs: readonly [TOut, ...TOut[]],
    output: TOut,
  ): NodeInterface<NodeStateBase, TOut> => ({
    name,
    outputs,
    async execute() { return { 'output': output }; },
  });

  void it('basic emit: synthesizes a TerminalNode placement and routes the output port to it', () => {
    const contracts: OperationContract[] = [
      { 'name': 'classify', 'hardRequired': ['input'], 'produces': ['classification'], 'outputs': ['success', 'fail'] },
      { 'name': 'plan',     'hardRequired': ['classification'], 'produces': ['plan'],   'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'emit-basic',
      'version': '1',
      'entrypoint': 'classify',
      contracts,
      'annotations': {
        'terminals': {
          'classify': [
            { 'outcome': 'fail', 'emit': { 'name': 'end-fail', 'outcome': 'failed' } },
          ],
        },
      },
    });

    // A TerminalNode placement named 'end-fail' with outcome 'failed' is present.
    const terminal = dag.nodes.find((n) => n.name === 'end-fail');
    assert.ok(terminal !== undefined, 'end-fail placement is emitted');
    assert.equal(terminal['@type'], 'TerminalNode');
    if (terminal['@type'] === 'TerminalNode') {
      assert.equal(terminal.outcome, 'failed');
      assert.ok(terminal['@id'].endsWith('/node/end-fail'));
    }

    // The classify placement routes 'fail' to 'end-fail'.
    const classify = dag.nodes.find((n) => n.name === 'classify');
    assert.ok(classify !== undefined && classify['@type'] === 'SingleNode');
    if (classify !== undefined && classify['@type'] === 'SingleNode') {
      assert.equal(classify.outputs['fail'], 'end-fail');
      assert.equal(classify.outputs['success'], 'plan');
    }
  });

  void it('shared terminal: two operations with same emit name produce exactly one TerminalNode', () => {
    const contracts: OperationContract[] = [
      { 'name': 'step-a', 'hardRequired': ['input'], 'produces': ['x'], 'outputs': ['success', 'fail'] },
      { 'name': 'step-b', 'hardRequired': ['x'],     'produces': ['y'], 'outputs': ['success', 'fail'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'emit-shared',
      'version': '1',
      'entrypoint': 'step-a',
      contracts,
      'annotations': {
        'terminals': {
          'step-a': [{ 'outcome': 'fail', 'emit': { 'name': 'end-fail', 'outcome': 'failed' } }],
          'step-b': [{ 'outcome': 'fail', 'emit': { 'name': 'end-fail', 'outcome': 'failed' } }],
        },
      },
    });

    const terminals = dag.nodes.filter((n) => n.name === 'end-fail');
    assert.equal(terminals.length, 1, 'exactly one end-fail TerminalNode in the DAG');

    const nodeA = dag.nodes.find((n) => n.name === 'step-a');
    const nodeB = dag.nodes.find((n) => n.name === 'step-b');
    assert.ok(nodeA !== undefined && nodeA['@type'] === 'SingleNode');
    assert.ok(nodeB !== undefined && nodeB['@type'] === 'SingleNode');
    if (nodeA !== undefined && nodeA['@type'] === 'SingleNode') {
      assert.equal(nodeA.outputs['fail'], 'end-fail');
    }
    if (nodeB !== undefined && nodeB['@type'] === 'SingleNode') {
      assert.equal(nodeB.outputs['fail'], 'end-fail');
    }
  });

  void it('outcome conflict: two emit entries with same name but different outcomes throw DAGError', () => {
    const contracts: OperationContract[] = [
      { 'name': 'step-a', 'hardRequired': ['input'], 'produces': ['x'], 'outputs': ['success', 'fail'] },
      { 'name': 'step-b', 'hardRequired': ['x'],     'produces': ['y'], 'outputs': ['success', 'fail'] },
    ];
    assert.throws(
      () => DAGDeriver.derive({
        'name': 'emit-conflict',
        'version': '1',
        'entrypoint': 'step-a',
        contracts,
        'annotations': {
          'terminals': {
            'step-a': [{ 'outcome': 'fail', 'emit': { 'name': 'end-end', 'outcome': 'completed' } }],
            'step-b': [{ 'outcome': 'fail', 'emit': { 'name': 'end-end', 'outcome': 'failed' } }],
          },
        },
      }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('end-end'), `message includes placement name: ${err.message}`);
        assert.ok(
          err.message.includes('completed') && err.message.includes('failed'),
          `message includes both conflicting outcomes: ${err.message}`,
        );
        return true;
      },
    );
  });

  void it('name collision with operation: emit name matching an existing operation throws DAGError', () => {
    const contracts: OperationContract[] = [
      { 'name': 'classify', 'hardRequired': ['input'],          'produces': ['classification'], 'outputs': ['success', 'fail'] },
      { 'name': 'cleanup',  'hardRequired': ['classification'], 'produces': ['done'],           'outputs': ['success'] },
    ];
    assert.throws(
      () => DAGDeriver.derive({
        'name': 'emit-collision',
        'version': '1',
        'entrypoint': 'classify',
        contracts,
        'annotations': {
          'terminals': {
            'classify': [{ 'outcome': 'fail', 'emit': { 'name': 'cleanup', 'outcome': 'failed' } }],
          },
        },
      }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('cleanup'), `message identifies collision name: ${err.message}`);
        return true;
      },
    );
  });

  void it('execution: triggering the failing path marks state.lifecycle.kind as failed', async () => {
    const contracts: OperationContract[] = [
      { 'name': 'classify', 'hardRequired': ['input'], 'produces': ['classification'], 'outputs': ['success', 'fail'] },
      { 'name': 'plan',     'hardRequired': ['classification'], 'produces': ['plan'],  'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'emit-exec',
      'version': '1',
      'entrypoint': 'classify',
      contracts,
      'annotations': {
        'terminals': {
          'classify': [{ 'outcome': 'fail', 'emit': { 'name': 'end-fail', 'outcome': 'failed' } }],
        },
      },
    });

    const dispatcher = new Dagonizer<NodeStateBase>();
    // classify always routes 'fail' output → TerminalNode(failed)
    dispatcher.registerNode(makeWith('classify', ['success', 'fail'], 'fail'));
    dispatcher.registerNode(make('plan', ['success']));
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('emit-exec', new NodeStateBase());
    assert.equal(result.state.lifecycle.kind, 'failed');
    assert.ok(result.executedNodes.includes('end-fail'));
    assert.ok(!result.executedNodes.includes('plan'));
  });

  void it('mixing variants: target and emit coexist on the same operation without conflict', () => {
    const contracts: OperationContract[] = [
      { 'name': 'classify', 'hardRequired': ['input'], 'produces': ['classification'], 'outputs': ['success', 'fail', 'retry'] },
      { 'name': 'plan',     'hardRequired': ['classification'], 'produces': ['plan'],  'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'emit-mix',
      'version': '1',
      'entrypoint': 'classify',
      contracts,
      'annotations': {
        'terminals': {
          'classify': [
            { 'outcome': 'fail',  'target': null },
            { 'outcome': 'retry', 'emit': { 'name': 'end-retry-exhausted', 'outcome': 'failed' } },
          ],
        },
      },
    });

    // target variant: 'fail' routes to null
    const classify = dag.nodes.find((n) => n.name === 'classify');
    assert.ok(classify !== undefined && classify['@type'] === 'SingleNode');
    if (classify !== undefined && classify['@type'] === 'SingleNode') {
      assert.equal(classify.outputs['fail'],  null);
      assert.equal(classify.outputs['retry'], 'end-retry-exhausted');
      assert.equal(classify.outputs['success'], 'plan');
    }

    // emit variant: TerminalNode placement synthesized for retry exhaustion
    const terminal = dag.nodes.find((n) => n.name === 'end-retry-exhausted');
    assert.ok(terminal !== undefined, 'end-retry-exhausted placement is emitted');
    assert.equal(terminal['@type'], 'TerminalNode');
    if (terminal['@type'] === 'TerminalNode') {
      assert.equal(terminal.outcome, 'failed');
    }
  });
});
