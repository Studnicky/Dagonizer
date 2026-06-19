import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import type { OperationContractFragmentType } from '../../src/contracts/OperationContractFragment.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAGDeriver } from '../../src/derive/DAGDeriver.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { DAGError } from '../../src/errors/DAGError.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';

class GreetNode extends ScalarNode<NodeStateBase, 'success'> {
  readonly name = 'greet';
  readonly outputs = ['success'] as const;
  protected async executeOne(_state: NodeStateBase): Promise<NodeOutputType<'success'>> { return { 'errors': [], 'output': 'success' as const }; }
}

class PlanNode extends ScalarNode<NodeStateBase, 'success' | 'error'> {
  readonly name = 'plan';
  readonly outputs = ['success', 'error'] as const;
  protected async executeOne(_state: NodeStateBase): Promise<NodeOutputType<'success' | 'error'>> { return { 'errors': [], 'output': 'success' as const }; }
}

const greet = new GreetNode();
const plan = new PlanNode();

// ContractTestNode: a node carrying a configurable OperationContractFragmentType,
// used to exercise build()-time contract validation and derive() derivation.
class ContractTestNode extends ScalarNode<NodeStateBase, string> {
  readonly name: string;
  readonly outputs: readonly string[];
  override readonly contract: OperationContractFragmentType;

  constructor(name: string, outputs: readonly string[], contract: OperationContractFragmentType = { 'hardRequired': [], 'produces': [] }) {
    super();
    this.name = name;
    this.outputs = outputs;
    this.contract = contract;
  }

  protected async executeOne(): Promise<NodeOutputType<string>> {
    return { 'errors': [], 'output': this.outputs[0] ?? 'success' };
  }
}

function makeNode(
  name: string,
  outputs: readonly string[],
  contract?: OperationContractFragmentType,
): NodeInterface<NodeStateBase, string> {
  return new ContractTestNode(name, outputs, contract);
}

void describe('DAGBuilder', () => {
  void it('builds a single-node DAG in JSON-LD canonical form', () => {
    const dag = new DAGBuilder('demo', '1.0')
      .node('greet', greet, { 'success': 'end' })
      .build();

    assert.equal(dag.name, 'demo');
    assert.equal(dag.version, '1.0');
    assert.equal(dag.entrypoint, 'greet');
    assert.equal(dag.nodes.length, 1);
    // JSON-LD shape: @type discriminator, @id URN, @context at root
    assert.equal(dag['@type'], 'DAG');
    assert.ok(dag['@id'].startsWith('urn:noocodex:dag:'));
    assert.ok(dag['@context'] !== undefined);
    const first = dag.nodes[0];
    assert.equal(first?.['@type'], 'SingleNode');
    assert.ok((first?.['@id'] as string).includes('demo/node/greet'));
  });

  void it('uses explicit entrypoint when set', () => {
    const dag = new DAGBuilder('demo', '1')
      .entrypoint('plan')
      .node('greet', greet, { 'success': 'plan' })
      .node('plan', plan, { 'success': 'end', 'error': 'end' })
      .build();
    assert.equal(dag.entrypoint, 'plan');
  });

  void it('produces a config the dispatcher accepts', () => {
    const dag = new DAGBuilder('via-builder', '1')
      .node('greet', greet, { 'success': 'plan' })
      .node('plan', plan, { 'success': 'end', 'error': 'end' })
      .terminal('end')
      .build();

    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(greet);
    dispatcher.registerNode(plan);
    dispatcher.registerDAG(dag);
  });

  void it('build() without nodes throws', () => {
    assert.throws(() => new DAGBuilder('empty', '1').build());
  });

});

// ---------------------------------------------------------------------------
// build() contract validation
// ---------------------------------------------------------------------------

void describe('DAGBuilder.build() contract validation', () => {
  void it('returns a valid DAG when producer → consumer contracts match correctly', () => {
    const produce = makeNode('produce', ['success'], { 'hardRequired': ['input'], 'produces': ['result'] });
    // 'consume' is the terminal node: it consumes 'result' and produces nothing,
    // so the chain has no dead write.
    const consume = makeNode('consume', ['success'], { 'hardRequired': ['result'], 'produces': [] });

    const dag = new DAGBuilder('valid-chain', '1.0')
      .node('produce', produce, { 'success': 'consume' })
      .node('consume', consume, { 'success': 'end' })
      .build();

    assert.equal(dag.name, 'valid-chain');
    assert.equal(dag.entrypoint, 'produce');
    assert.equal(dag.nodes.length, 2);
  });

  void it('throws DAGError when a downstream node hardRequires a path that no upstream node produces', () => {
    const a = makeNode('a', ['success'], { 'hardRequired': ['input'], 'produces': ['x'] });
    const b = makeNode('b', ['success'], { 'hardRequired': ['missing'], 'produces': ['done'] });

    assert.throws(
      () => new DAGBuilder('bad-chain', '1.0')
        .node('a', a, { 'success': 'b' })
        .node('b', b, { 'success': 'end' })
        .build(),
      (err: unknown) => {
        assert.ok(err instanceof DAGError, `expected DAGError, got ${String(err)}`);
        assert.ok(err.message.includes("hardRequires 'missing'"), `message: ${err.message}`);
        return true;
      },
    );
  });

  void it('throws DAGError when a node produces a path no downstream consumer needs', () => {
    const a = makeNode('a', ['success'], { 'hardRequired': ['input'], 'produces': ['used', 'dead'] });
    const b = makeNode('b', ['success'], { 'hardRequired': ['used'],  'produces': [] });

    // 'dead' is produced by 'a' but no node hardRequires it → dead write → throw.
    assert.throws(
      () => new DAGBuilder('dead-write', '1.0')
        .node('a', a, { 'success': 'b' })
        .node('b', b, { 'success': 'end' })
        .build(),
      (err: unknown) => {
        assert.ok(err instanceof DAGError, `expected DAGError, got ${String(err)}`);
        assert.ok(err.message.includes("'dead'"), `message: ${err.message}`);
        assert.ok(err.message.includes('produces'), `message: ${err.message}`);
        assert.ok(err.message.includes('no node in the registry hardRequires it'), `message: ${err.message}`);
        return true;
      },
    );
  });

});

// ---------------------------------------------------------------------------
// DAGBuilder.derive()
// ---------------------------------------------------------------------------

void describe('DAGBuilder.derive()', () => {
  void it('produces the same DAG as the equivalent DAGDeriver.derive({ nodes }) call', () => {
    const nodes: NodeInterface<NodeStateBase, string>[] = [
      makeNode('fetch', ['success'], { 'hardRequired': ['url'],    'produces': ['raw'] }),
      makeNode('parse', ['success'], { 'hardRequired': ['raw'],    'produces': ['record'] }),
      // 'save' is the terminal node: consumes 'record', produces nothing.
      makeNode('save',  ['success'], { 'hardRequired': ['record'], 'produces': [] }),
    ];
    const annotations = {
      'terminals': {
        'save': [{ 'outcome': 'success', 'emit': { 'name': 'pipeline-end', 'outcome': 'completed' as const } }],
      },
    };

    const fromBuilder = DAGBuilder.derive('pipeline', '1.0', 'fetch', nodes, { annotations });

    const fromDeriver = DAGDeriver.derive({
      'name': 'pipeline',
      'version': '1.0',
      'entrypoint': 'fetch',
      nodes,
      annotations,
    });

    // Structural deep-equal: both should produce identical DAG documents.
    assert.deepEqual(fromBuilder, fromDeriver);
  });

  void it('throws a DAGError when nodes is empty (no contracts to derive from)', () => {
    assert.throws(
      () => DAGBuilder.derive('empty', '1', 'a', []),
      (err: unknown) => {
        assert.ok(err instanceof DAGError, `expected DAGError, got ${String(err)}`);
        return true;
      },
    );
  });

  void it('skips contract-less nodes during derivation (matches deriver behavior)', () => {
    const nodes: NodeInterface<NodeStateBase, string>[] = [
      makeNode('a', ['success'], { 'hardRequired': ['input'], 'produces': ['x'] }),
      // 'b' is the terminal node: consumes 'x', produces nothing.
      makeNode('b', ['success'], { 'hardRequired': ['x'],     'produces': [] }),
      // no contract; should be silently skipped
      makeNode('helper', ['success']),
    ];
    const annotations = {
      'terminals': {
        'b': [{ 'outcome': 'success', 'emit': { 'name': 'skip-end', 'outcome': 'completed' as const } }],
      },
    };

    const dag = DAGBuilder.derive('skip-no-contract', '1', 'a', nodes, { annotations });

    const names = dag.nodes.map((n) => n.name);
    assert.ok(!names.includes('helper'), `'helper' should be skipped; got: ${JSON.stringify(names)}`);
    assert.ok(names.includes('a'),       `'a' must be in topology`);
    assert.ok(names.includes('b'),       `'b' must be in topology`);
  });
});
