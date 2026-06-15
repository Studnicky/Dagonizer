import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import type { OperationContract } from '../../src/contracts/OperationContract.js';
import type { OperationContractFragment } from '../../src/contracts/OperationContractFragment.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAGDeriver } from '../../src/derive/DAGDeriver.js';
import type { DAGDeriverEmbeddedDAG } from '../../src/derive/DAGDeriverAnnotations.js';
import type { NodeOutputInterface } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';

// `DAGDeriver.derive` takes `nodes` with co-located contracts (single source of
// truth); there is no standalone `contracts` input. Wrap each contract spec in
// a node whose `contract` carries the topology fields; `execute` is a no-op
// (derive reads only the contract, never runs the node).
// A ScalarNode that carries a co-located `contract` (the topology fields
// DAGDeriver reads). `execute` is never called by derive — it reads only the
// contract — but the node still descends from the taxonomy like every other.
class ContractNode<TState extends NodeStateInterface> extends ScalarNode<TState, string> {
  readonly name: string;
  readonly outputs: readonly string[];
  override readonly contract: OperationContractFragment;
  readonly #defaultOutput: string;

  constructor(c: OperationContract) {
    super();
    this.name = c.name;
    this.outputs = c.outputs;
    this.contract = { 'hardRequired': c.hardRequired, 'produces': c.produces };
    this.#defaultOutput = c.outputs[0] as string;
  }

  protected override async executeOne(): Promise<NodeOutputInterface<string>> {
    return { 'errors': [], 'output': this.#defaultOutput };
  }
}

const contractNode = <TState extends NodeStateInterface>(c: OperationContract): NodeInterface<TState> => new ContractNode<TState>(c);

/**
 * Reusable ScalarNode for derive tests. Always routes to `defaultOutput`
 * (first output when not specified). Replaces the inline `make`/`makeWith`
 * arrow-function helpers in every test describe block.
 */
class DerivePassthroughNode<TOut extends string> extends ScalarNode<NodeStateBase, TOut> {
  readonly name: string;
  readonly outputs: readonly [TOut, ...TOut[]];
  private readonly defaultOutput: TOut;

  constructor(name: string, outputs: readonly [TOut, ...TOut[]], defaultOutput?: TOut) {
    super();
    this.name = name;
    this.outputs = outputs;
    this.defaultOutput = defaultOutput ?? outputs[0];
  }

  protected async executeOne(): Promise<NodeOutputInterface<TOut>> {
    return { 'errors': [], 'output': this.defaultOutput };
  }
}

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
      "nodes": contracts.map(contractNode),
      'annotations': {
        'terminals': {
          'c': [{ 'outcome': 'success', 'emit': { 'name': 'chain-end', 'outcome': 'completed' } }],
        },
      },
    });
    assert.equal(dag.name, 'chain');
    assert.equal(dag.entrypoint, 'a');
    // JSON-LD canonical shape: @context, @id, @type at root
    assert.equal(dag['@type'], 'DAG');
    assert.ok(dag['@id'].startsWith('urn:noocodex:dag:'));
    assert.ok(dag['@context'] !== undefined);
    const names = dag.nodes.map((node) => node.name);
    assert.deepEqual(names, ['a', 'b', 'c', 'chain-end']);
    const a = dag.nodes[0];
    if (a !== undefined && a['@type'] === 'SingleNode') {
      assert.equal(a.outputs['success'], 'b');
    } else {
      assert.fail('expected first node to be SingleNode');
    }
  });

  void it('emits scatter placement when annotation is supplied', () => {
    const contracts: OperationContract[] = [
      { 'name': 'plan',  'hardRequired': ['input'],        'produces': ['tasks'],        'outputs': ['success'] },
      { 'name': 'scout', 'hardRequired': ['tasks'],        'produces': ['scoutResults'], 'outputs': ['success'] },
      { 'name': 'merge', 'hardRequired': ['scoutResults'], 'produces': ['merged'],       'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'scout-flow',
      'version': '1',
      'entrypoint': 'plan',
      "nodes": contracts.map(contractNode),
      'annotations': {
        'scatters': {
          'scout': {
            'source':     'tasks',
            'itemKey':    'currentTask',
            'node':       'scout',
            'concurrency': 3,
            'strategy':   'custom',
            'customNode': 'merge',
            'outcomes':   ['all-success', 'partial', 'all-error', 'empty'],
          },
        },
        'terminals': {
          'scout': [
            { 'outcome': 'all-success', 'emit': { 'name': 'scout-flow-end', 'outcome': 'completed' } },
            { 'outcome': 'partial',     'emit': { 'name': 'scout-flow-end', 'outcome': 'completed' } },
            { 'outcome': 'all-error',   'emit': { 'name': 'scout-flow-end', 'outcome': 'completed' } },
            { 'outcome': 'empty',       'emit': { 'name': 'scout-flow-end', 'outcome': 'completed' } },
          ],
        },
      },
    });
    const scatter = dag.nodes.find((node) => node['@type'] === 'ScatterNode');
    assert.ok(scatter !== undefined);
    if (scatter !== undefined && scatter['@type'] === 'ScatterNode') {
      assert.ok('node' in scatter.body, 'body is a node body');
      if ('node' in scatter.body) {
        assert.equal(scatter.body.node, 'scout');
      }
      assert.equal(scatter.source, 'tasks');
      assert.equal(scatter.itemKey, 'currentTask');
      assert.equal(scatter.concurrency, 3);
      assert.ok(scatter.gather !== undefined);
      if (scatter.gather !== undefined) {
        assert.equal(scatter.gather.strategy, 'custom');
        if (scatter.gather.strategy === 'custom') {
          assert.equal(scatter.gather.customNode, 'merge');
        }
      }
    }
  });

  void it('renders scatter with partition strategy', () => {
    const contracts: OperationContract[] = [
      { 'name': 'plan',  'hardRequired': ['input'],  'produces': ['tasks'],   'outputs': ['success'] },
      { 'name': 'scout', 'hardRequired': ['tasks'],  'produces': ['results'], 'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'partition-flow',
      'version': '1',
      'entrypoint': 'plan',
      "nodes": contracts.map(contractNode),
      'annotations': {
        'scatters': {
          'scout': {
            'source':      'tasks',
            'itemKey':     'currentTask',
            'node':        'scout',
            'concurrency': 0,
            'strategy':    'partition',
            'partitions':  { 'success': 'state.passed', 'error': 'state.failed' },
            'outcomes':    ['success', 'error', 'empty'],
          },
        },
        'terminals': {
          'scout': [
            { 'outcome': 'success', 'emit': { 'name': 'partition-end', 'outcome': 'completed' } },
            { 'outcome': 'error',   'emit': { 'name': 'partition-end', 'outcome': 'completed' } },
            { 'outcome': 'empty',   'emit': { 'name': 'partition-end', 'outcome': 'completed' } },
          ],
        },
      },
    });
    const scatter = dag.nodes.find((node) => node['@type'] === 'ScatterNode');
    assert.ok(scatter !== undefined && scatter['@type'] === 'ScatterNode');
    if (scatter !== undefined && scatter['@type'] === 'ScatterNode') {
      assert.ok(scatter.gather !== undefined);
      if (scatter.gather !== undefined) {
        assert.equal(scatter.gather.strategy, 'partition');
        if (scatter.gather.strategy === 'partition') {
          assert.deepEqual(scatter.gather.partitions, { 'success': 'state.passed', 'error': 'state.failed' });
        }
      }
    }
  });

  void it('renders scatter with append strategy', () => {
    const contracts: OperationContract[] = [
      { 'name': 'plan',  'hardRequired': ['input'], 'produces': ['tasks'],   'outputs': ['success'] },
      { 'name': 'scout', 'hardRequired': ['tasks'], 'produces': ['results'], 'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'append-flow',
      'version': '1',
      'entrypoint': 'plan',
      "nodes": contracts.map(contractNode),
      'annotations': {
        'scatters': {
          'scout': {
            'source':      'tasks',
            'itemKey':     'currentTask',
            'node':        'scout',
            'concurrency': 0,
            'strategy':    'append',
            'target':      'state.allResults',
            'outcomes':    ['success', 'error'],
          },
        },
        'terminals': {
          'scout': [
            { 'outcome': 'success', 'emit': { 'name': 'append-end', 'outcome': 'completed' } },
            { 'outcome': 'error',   'emit': { 'name': 'append-end', 'outcome': 'completed' } },
          ],
        },
      },
    });
    const scatter = dag.nodes.find((node) => node['@type'] === 'ScatterNode');
    assert.ok(scatter !== undefined && scatter['@type'] === 'ScatterNode');
    if (scatter !== undefined && scatter['@type'] === 'ScatterNode') {
      assert.ok(scatter.gather !== undefined);
      if (scatter.gather !== undefined) {
        assert.equal(scatter.gather.strategy, 'append');
        if (scatter.gather.strategy === 'append') {
          assert.equal(scatter.gather.target, 'state.allResults');
        }
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
        "nodes": contracts.map(contractNode),
        'annotations': {
          'scatters': {
            'scout': {
              'source':      'tasks',
              'itemKey':     'currentTask',
              'node':        'scout',
              'concurrency': 0,
              'strategy':    'partition',
              'partitions':  { 'unknown-outcome': 'state.somewhere' },
              'outcomes':    ['success', 'error'],
            },
          },
        },
      }),
      /partitions\['unknown-outcome'\] is not listed in outcomes/,
    );
  });

  void it('terminal annotation routes an alternate outcome to an emitted terminal', () => {
    const contracts: OperationContract[] = [
      { 'name': 'classify', 'hardRequired': ['input'],          'produces': ['classification'], 'outputs': ['success', 'off-topic'] },
      { 'name': 'plan',     'hardRequired': ['classification'], 'produces': ['plan'],           'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'gated',
      'version': '1',
      'entrypoint': 'classify',
      "nodes": contracts.map(contractNode),
      'annotations': {
        'terminals': {
          'classify': [
            { 'outcome': 'off-topic', 'emit': { 'name': 'off-topic-end', 'outcome': 'completed' } },
          ],
          'plan': [
            { 'outcome': 'success', 'emit': { 'name': 'gated-end', 'outcome': 'completed' } },
          ],
        },
      },
    });
    const classify = dag.nodes.find((node) => node.name === 'classify');
    assert.ok(classify !== undefined);
    if (classify !== undefined && classify['@type'] === 'SingleNode') {
      assert.equal(classify.outputs['off-topic'], 'off-topic-end');
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
      "nodes": contracts.map(contractNode),
      'annotations': {
        'terminals': {
          'normalize': [{ 'outcome': 'success', 'emit': { 'name': 'multi-port-end', 'outcome': 'completed' } }],
        },
      },
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
      "nodes": contracts.map(contractNode),
      'annotations': {
        'terminals': {
          'fetch':     [{ 'outcome': 'error',   'emit': { 'name': 'fetch-error-end', 'outcome': 'completed' } }],
          'normalize': [{ 'outcome': 'success', 'emit': { 'name': 'partial-end',     'outcome': 'completed' } }],
        },
      },
    });
    const fetch = dag.nodes.find((node) => node.name === 'fetch');
    if (fetch !== undefined && fetch['@type'] === 'SingleNode') {
      assert.equal(fetch.outputs['success'], 'normalize');
      assert.equal(fetch.outputs['cached'],  'normalize');
      assert.equal(fetch.outputs['error'],   'fetch-error-end');
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
        "nodes": contracts.map(contractNode),
        'annotations': {
          'terminals': {
            'fetch': [{ 'outcome': 'cached', 'emit': { 'name': 'fetch-cached-end', 'outcome': 'completed' } }],
          },
        },
      }),
      /port 'cached' which is not in the contract's outputs/,
    );
  });

  void it('embeddedDAGs annotation renders an EmbeddedDAGNode placement', () => {
    const contracts: OperationContract[] = [
      { 'name': 'prepare', 'hardRequired': ['input'],   'produces': ['payload'], 'outputs': ['success'] },
      { 'name': 'invoke',  'hardRequired': ['payload'], 'produces': ['result'],  'outputs': ['success', 'error'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'embeddeddag-render',
      'version': '1',
      'entrypoint': 'prepare',
      "nodes": contracts.map(contractNode),
      'annotations': {
        'embeddedDAGs': {
          'invoke': {
            'dag':    'plugin:parse',
            'outputs': ['success', 'error'],
          },
        },
        'terminals': {
          'invoke': [
            { 'outcome': 'success', 'emit': { 'name': 'invoke-end', 'outcome': 'completed' } },
            { 'outcome': 'error',   'emit': { 'name': 'invoke-end', 'outcome': 'completed' } },
          ],
        },
      },
    });
    const invoke = dag.nodes.find((node) => node.name === 'invoke');
    assert.ok(invoke !== undefined, 'invoke placement is emitted');
    if (invoke !== undefined && invoke['@type'] === 'EmbeddedDAGNode') {
      assert.equal(invoke.dag, 'plugin:parse');
      // Explicit TerminalNode routes declared via annotations.terminals.
      assert.equal(invoke.outputs['success'], 'invoke-end');
      assert.equal(invoke.outputs['error'],   'invoke-end');
    } else {
      assert.fail('expected invoke placement to be EmbeddedDAGNode');
    }
  });

  void it('embeddedDAGs stateMapping renders as stateMapping on the EmbeddedDAGNode', () => {
    // Child state with the fields referenced in the stateMapping below.
    class EmbeddedDAGChildState extends NodeStateBase {
      childInput  = '';
      childResult = '';
    }

    const contracts: OperationContract[] = [
      { 'name': 'invoke', 'hardRequired': ['input'], 'produces': ['result'], 'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'embeddeddag-mapping',
      'version': '1',
      'entrypoint': 'invoke',
      "nodes": contracts.map(contractNode),
      'annotations': {
        'embeddedDAGs': {
          'invoke': {
            'dag':     'child-dag',
            'outputs': ['success'],
            'stateMapping': {
              'input':  { 'childInput':  'parent.input' },
              'output': { 'parent.result': 'childResult' },
            },
          } satisfies DAGDeriverEmbeddedDAG<EmbeddedDAGChildState>,
        },
        'terminals': {
          'invoke': [{ 'outcome': 'success', 'emit': { 'name': 'mapping-end', 'outcome': 'completed' } }],
        },
      },
    });
    const invoke = dag.nodes.find((node) => node.name === 'invoke');
    assert.ok(invoke !== undefined && invoke['@type'] === 'EmbeddedDAGNode');
    if (invoke !== undefined && invoke['@type'] === 'EmbeddedDAGNode') {
      assert.deepEqual(invoke.stateMapping, {
        'input':  { 'childInput':  'parent.input' },
        'output': { 'parent.result': 'childResult' },
      });
    }
  });

  void it('embeddedDAGs auto-wires every declared port and honors terminal overrides', () => {
    const contracts: OperationContract[] = [
      { 'name': 'invoke', 'hardRequired': ['input'],  'produces': ['result'], 'outputs': ['success', 'cached', 'error'] },
      { 'name': 'finish', 'hardRequired': ['result'], 'produces': ['done'],   'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'embeddeddag-routing',
      'version': '1',
      'entrypoint': 'invoke',
      "nodes": contracts.map(contractNode),
      'annotations': {
        'embeddedDAGs': {
          'invoke': {
            'dag':     'child-dag',
            'outputs': ['success', 'cached', 'error'],
          },
        },
        'terminals': {
          'invoke': [{ 'outcome': 'error',   'emit': { 'name': 'invoke-error-end', 'outcome': 'completed' } }],
          'finish': [{ 'outcome': 'success', 'emit': { 'name': 'routing-end',      'outcome': 'completed' } }],
        },
      },
    });
    const invoke = dag.nodes.find((node) => node.name === 'invoke');
    if (invoke !== undefined && invoke['@type'] === 'EmbeddedDAGNode') {
      assert.equal(invoke.outputs['success'], 'finish');             // auto-wired to next stage
      assert.equal(invoke.outputs['cached'],  'finish');             // auto-wired to next stage
      assert.equal(invoke.outputs['error'],   'invoke-error-end');   // terminal override → emitted terminal
    } else {
      assert.fail('expected invoke placement to be EmbeddedDAGNode');
    }
  });

  void it('throws when a terminal references a port not in the embeddedDAG outputs', () => {
    const contracts: OperationContract[] = [
      { 'name': 'invoke', 'hardRequired': ['input'], 'produces': ['result'], 'outputs': ['success', 'error'] },
    ];
    assert.throws(
      () => DAGDeriver.derive({
        'name': 'embeddeddag-mismatch',
        'version': '1',
        'entrypoint': 'invoke',
        "nodes": contracts.map(contractNode),
        'annotations': {
          'embeddedDAGs': {
            'invoke': {
              'dag':     'child-dag',
              'outputs': ['success', 'error'],
            },
          },
          'terminals': {
            'invoke': [{ 'outcome': 'cached', 'emit': { 'name': 'invoke-cached-end', 'outcome': 'completed' } }],
          },
        },
      }),
      /port 'cached' which is not in the embeddedDAG 'child-dag' declared outputs/,
    );
  });

  void it('throws when an operation appears in both scatters and embeddedDAGs', () => {
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
        "nodes": contracts.map(contractNode),
        'annotations': {
          'scatters': {
            'scout': {
              'source':      'tasks',
              'itemKey':     'currentTask',
              'node':        'scout',
              'concurrency': 0,
              'strategy':    'custom',
              'customNode':  'merge',
              'outcomes':    ['all-success'],
            },
          },
          'embeddedDAGs': {
            'scout': {
              'dag':     'scout-dag',
              'outputs': ['success'],
            },
          },
        },
      }),
      /appears in both annotations.scatters and annotations.embeddedDAGs/,
    );
  });

  void it('end-to-end: dispatcher executes a EmbeddedDAGNode emitted by DAGDeriver', async () => {
    // Parent flow: prepare → invoke-child (embedded-DAG) → finalize.
    // Embedded-DAG placements cannot terminate the run; the parent DAG
    // owns END, so the embedded-DAG step must be followed by another
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
      "nodes": contracts.map(contractNode),
      'annotations': {
        'embeddedDAGs': {
          'invoke-child': {
            'dag':     'child',
            'outputs': ['success'],
          },
        },
        'terminals': {
          'finalize': [{ 'outcome': 'success', 'emit': { 'name': 'parent-end', 'outcome': 'completed' } }],
        },
      },
    });
    const childDAG = DAGDeriver.derive({
      'name': 'child',
      'version': '1',
      'entrypoint': 'child-step',
      "nodes": [
        { 'name': 'child-step', 'hardRequired': ['input'], 'produces': ['final'], 'outputs': ['success'] },
      ].map(contractNode),
      'annotations': {
        'terminals': {
          'child-step': [{ 'outcome': 'success', 'emit': { 'name': 'child-end', 'outcome': 'completed' } }],
        },
      },
    });

    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(new DerivePassthroughNode('prepare',      ['success']));
    dispatcher.registerNode(new DerivePassthroughNode('invoke-child', ['success']));
    dispatcher.registerNode(new DerivePassthroughNode('finalize',     ['success']));
    dispatcher.registerNode(new DerivePassthroughNode('child-step',   ['success']));
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
      "nodes": contracts.map(contractNode),
      'annotations': {
        'terminals': {
          'second': [{ 'outcome': 'success', 'emit': { 'name': 'reg-end', 'outcome': 'completed' } }],
        },
      },
    });

    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(new DerivePassthroughNode('first',  ['success']));
    dispatcher.registerNode(new DerivePassthroughNode('second', ['success']));

    dispatcher.registerDAG(dag);
    assert.equal(dispatcher.getDAG('reg-test'), dag);
  });

  void it('throws DAGError when an output port has no successor and no terminal annotation', () => {
    const contracts: OperationContract[] = [
      { 'name': 'fetch', 'hardRequired': ['url'], 'produces': ['raw'], 'outputs': ['success', 'error'] },
    ];
    assert.throws(
      () => DAGDeriver.derive({
        'name': 'unrouted-port',
        'version': '1',
        'entrypoint': 'fetch',
        "nodes": contracts.map(contractNode),
        // No annotations.terminals for fetch — both ports are unrouted.
      }),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'throws an Error');
        assert.ok(
          err.message.includes("'fetch'") && err.message.includes("'success'"),
          `message names the placement and port: ${err.message}`,
        );
        assert.ok(
          err.message.includes('explicit TerminalNode'),
          `message directs the author to declare a terminal: ${err.message}`,
        );
        return true;
      },
    );
  });

  void it('throws DAGError when a scatter outcome has no successor and no terminal annotation', () => {
    const contracts: OperationContract[] = [
      { 'name': 'plan',  'hardRequired': ['input'], 'produces': ['tasks'],   'outputs': ['success'] },
      { 'name': 'scout', 'hardRequired': ['tasks'], 'produces': ['results'], 'outputs': ['success'] },
    ];
    assert.throws(
      () => DAGDeriver.derive({
        'name': 'unrouted-scatter',
        'version': '1',
        'entrypoint': 'plan',
        "nodes": contracts.map(contractNode),
        'annotations': {
          'scatters': {
            'scout': {
              'source':      'tasks',
              'itemKey':     'currentTask',
              'node':        'scout',
              'concurrency': 0,
              'strategy':    'append',
              'target':      'state.results',
              'outcomes':    ['success', 'error'],
            },
          },
          // No terminals for scout — outcomes are unrouted.
        },
      }),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'throws an Error');
        assert.ok(
          err.message.includes("scatter 'scout'") && err.message.includes("'success'"),
          `message names the scatter and outcome: ${err.message}`,
        );
        assert.ok(
          err.message.includes('explicit TerminalNode'),
          `message directs the author to declare a terminal: ${err.message}`,
        );
        return true;
      },
    );
  });
});

void describe('DAGDeriver: terminals with emit variant', () => {
  // Helpers backed by DerivePassthroughNode (defined at file top level).
  const make = <TOut extends string>(
    name: string,
    outputs: readonly [TOut, ...TOut[]],
  ): DerivePassthroughNode<TOut> => new DerivePassthroughNode(name, outputs);

  const makeWith = <TOut extends string>(
    name: string,
    outputs: readonly [TOut, ...TOut[]],
    output: TOut,
  ): DerivePassthroughNode<TOut> => new DerivePassthroughNode(name, outputs, output);

  void it('basic emit: synthesizes a TerminalNode placement and routes the output port to it', () => {
    const contracts: OperationContract[] = [
      { 'name': 'classify', 'hardRequired': ['input'], 'produces': ['classification'], 'outputs': ['success', 'fail'] },
      { 'name': 'plan',     'hardRequired': ['classification'], 'produces': ['plan'],   'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'emit-basic',
      'version': '1',
      'entrypoint': 'classify',
      "nodes": contracts.map(contractNode),
      'annotations': {
        'terminals': {
          'classify': [
            { 'outcome': 'fail', 'emit': { 'name': 'end-fail', 'outcome': 'failed' } },
          ],
          'plan': [{ 'outcome': 'success', 'emit': { 'name': 'basic-end', 'outcome': 'completed' } }],
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
      "nodes": contracts.map(contractNode),
      'annotations': {
        'terminals': {
          'step-a': [{ 'outcome': 'fail',    'emit': { 'name': 'end-fail',   'outcome': 'failed'    } }],
          'step-b': [
            { 'outcome': 'fail',    'emit': { 'name': 'end-fail',   'outcome': 'failed'    } },
            { 'outcome': 'success', 'emit': { 'name': 'shared-end', 'outcome': 'completed' } },
          ],
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
        "nodes": contracts.map(contractNode),
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
        "nodes": contracts.map(contractNode),
        'annotations': {
          'terminals': {
            'classify': [{ 'outcome': 'fail', 'emit': { 'name': 'cleanup', 'outcome': 'failed' } }],
            'cleanup':  [{ 'outcome': 'success', 'emit': { 'name': 'collision-end', 'outcome': 'completed' } }],
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
      "nodes": contracts.map(contractNode),
      'annotations': {
        'terminals': {
          'classify': [{ 'outcome': 'fail', 'emit': { 'name': 'end-fail', 'outcome': 'failed' } }],
          'plan':     [{ 'outcome': 'success', 'emit': { 'name': 'exec-end', 'outcome': 'completed' } }],
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

  void it('multiple emit terminals (completed and failed) coexist on one operation', () => {
    const contracts: OperationContract[] = [
      { 'name': 'classify', 'hardRequired': ['input'], 'produces': ['classification'], 'outputs': ['success', 'fail', 'retry'] },
      { 'name': 'plan',     'hardRequired': ['classification'], 'produces': ['plan'],  'outputs': ['success'] },
    ];
    const dag = DAGDeriver.derive({
      'name': 'emit-mix',
      'version': '1',
      'entrypoint': 'classify',
      "nodes": contracts.map(contractNode),
      'annotations': {
        'terminals': {
          'classify': [
            { 'outcome': 'fail',  'emit': { 'name': 'end-fail', 'outcome': 'completed' } },
            { 'outcome': 'retry', 'emit': { 'name': 'end-retry-exhausted', 'outcome': 'failed' } },
          ],
          'plan': [{ 'outcome': 'success', 'emit': { 'name': 'mix-end', 'outcome': 'completed' } }],
        },
      },
    });

    // both outcomes end via emitted terminals (completed and failed)
    const classify = dag.nodes.find((n) => n.name === 'classify');
    assert.ok(classify !== undefined && classify['@type'] === 'SingleNode');
    if (classify !== undefined && classify['@type'] === 'SingleNode') {
      assert.equal(classify.outputs['fail'],  'end-fail');
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

void describe('DAGDeriverEmbeddedDAG<TChildState>: typed stateMapping', () => {
  /** Concrete child state with known domain fields. */
  class MyChildState extends NodeStateBase {
    payload: string = '';
    result:  number = 0;
  }

  void it('positive: typed embeddedDAG annotation compiles and produces correct EmbeddedDAGNode stateMapping', () => {
    const contracts: OperationContract[] = [
      { 'name': 'invoke', 'hardRequired': ['input'], 'produces': ['result'], 'outputs': ['success', 'error'] },
    ];

    // Typed annotation: 'payload' and 'result' must be keys of MyChildState.
    const typedEmbeddedDAG: DAGDeriverEmbeddedDAG<MyChildState> = {
      'dag':     'child-dag',
      'outputs': ['success', 'error'],
      'stateMapping': {
        'input':  { 'payload': 'parent.seed' },
        'output': { 'parent.result': 'result' },
      },
    };

    const dag = DAGDeriver.derive({
      'name':       'typed-embeddeddag',
      'version':    '1',
      'entrypoint': 'invoke',
      "nodes": contracts.map(contractNode),
      'annotations': {
        'embeddedDAGs': { 'invoke': typedEmbeddedDAG },
        'terminals': {
          'invoke': [
            { 'outcome': 'success', 'emit': { 'name': 'typed-end', 'outcome': 'completed' } },
            { 'outcome': 'error',   'emit': { 'name': 'typed-end', 'outcome': 'completed' } },
          ],
        },
      },
    });

    const invoke = dag.nodes.find((n) => n.name === 'invoke');
    assert.ok(invoke !== undefined && invoke['@type'] === 'EmbeddedDAGNode');
    if (invoke !== undefined && invoke['@type'] === 'EmbeddedDAGNode') {
      assert.deepEqual(invoke.stateMapping, {
        'input':  { 'payload': 'parent.seed' },
        'output': { 'parent.result': 'result' },
      });
    }
  });

  void it('untyped: omitting the generic defaults to NodeStateInterface (loose string paths)', () => {
    // DAGDeriverEmbeddedDAG without a generic; same as the pre-existing usage.
    const contracts: OperationContract[] = [
      { 'name': 'invoke', 'hardRequired': ['input'], 'produces': ['result'], 'outputs': ['success'] },
    ];

    const annotation: DAGDeriverEmbeddedDAG = {
      'dag':     'any-child-dag',
      'outputs': ['success'],
      'stateMapping': {
        'input':  { 'anyKey': 'parent.path' },
        'output': { 'parent.result': 'anyKey' },
      },
    };

    const dag = DAGDeriver.derive({
      'name':       'compat-embeddeddag',
      'version':    '1',
      'entrypoint': 'invoke',
      "nodes": contracts.map(contractNode),
      'annotations': {
        'embeddedDAGs': { 'invoke': annotation },
        'terminals': {
          'invoke': [{ 'outcome': 'success', 'emit': { 'name': 'compat-end', 'outcome': 'completed' } }],
        },
      },
    });

    const invoke = dag.nodes.find((n) => n.name === 'invoke');
    assert.ok(invoke !== undefined && invoke['@type'] === 'EmbeddedDAGNode');
    if (invoke !== undefined && invoke['@type'] === 'EmbeddedDAGNode') {
      assert.deepEqual(invoke.stateMapping, {
        'input':  { 'anyKey': 'parent.path' },
        'output': { 'parent.result': 'anyKey' },
      });
    }
  });

  void it('@ts-expect-error: wrong child-state key in input mapping produces a compile-time error', () => {
    // The typed annotation catches unknown child-state keys at compile time.
    // Assign to the stateMapping type directly so @ts-expect-error targets the erroring line.
    // @ts-expect-error: 'nonExistentKey' is not a key of MyChildState
    const _bad: DAGDeriverEmbeddedDAG<MyChildState>['stateMapping'] = { 'input': { 'nonExistentKey': 'parent.seed' } };
    void _bad;
  });
});
